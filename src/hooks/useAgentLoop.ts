/**
 * useAgentLoop — the frontend orchestrator for agentic chat.
 *
 * Flow:
 *   user message
 *     → Ollama /api/chat with `tools` param
 *     → response has tool_calls?  → yes: execute → append tool result → loop
 *                                   → no:  final text answer, done
 *
 * Safety:
 *   - max 8 iterations per turn
 *   - max 30 s per single tool call (timeout)
 *   - duplicate-call short-circuit (same tool + args twice → nudge LLM)
 *   - write tools pause on ApprovalCard (Promise resolves on Approve/Deny/Modify)
 *   - user Stop button aborts whole turn via AbortController
 *   - all tool calls persisted to `chat_tool_calls` for audit
 */

import { useCallback, useRef, useState } from "react";
import {
  agentDockerInspect,
  agentDockerListContainers,
  agentDockerLogs,
  agentDockerNetworks,
  agentDockerStats,
  agentDockerVolumes,
  agentExecRead,
  agentListDirectory,
  agentReadFile,
  type AgentToolResult,
} from "../api";
import { buildSystemPrompt } from "../context/pagePrompt";
import type { PageContextValue } from "../context/PageContext";
import type { ChatMessage, ChatToolCall } from "./useChatSession";
import {
  OLLAMA_BASE_URL,
  AI_MAX_ITERATIONS,
  AI_TOOL_TIMEOUT_MS,
  AI_ROLLING_WINDOW,
} from "../config";

// ── Tool schemas advertised to the LLM ───────────────────────────────────────

interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string; default?: unknown }>;
      required?: string[];
    };
  };
}

export const AGENT_TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "docker_list_containers",
      description:
        "List all Docker containers on the host (running and stopped). Returns JSON lines with id, name, image, state, status, ports, networks.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_logs",
      description:
        "Read recent logs from a Docker container. Use this whenever the user asks about errors, restarts, or container behavior.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Container name or id" },
          tail: { type: "integer", description: "Number of trailing lines (default 200)" },
          since: {
            type: "string",
            description: "Time window like '1h', '10m', '2024-01-01T00:00:00'",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_inspect",
      description:
        "Full docker inspect for a container — env, mounts, network config, restart policy. Use when you need config details, not just state.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_stats",
      description:
        "Live CPU / memory / net / block IO for all running containers. One-shot (no streaming).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_networks",
      description: "List Docker networks.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_volumes",
      description: "List Docker volumes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file on the remote VM via cat.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files in a directory on the remote VM (ls -la).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec_read",
      description:
        "Run a READ-ONLY shell command on the remote VM (e.g. df -h, free -m, ps aux, cat, grep, ls). This agent has NO write access — any command that would modify state (rm, mv, restart, install, edit, sudo, docker start/stop/rm, etc.) will be refused. Use this for information gathering only.",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
      },
    },
  },
];

// Read-only mode: no write tools are advertised or executable.

// ── Types ─────────────────────────────────────────────────────────────────────

interface OllamaToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

interface OllamaAssistantMessage {
  role: "assistant";
  content?: string | null;
  tool_calls?: OllamaToolCall[];
}

interface OllamaChatResponse {
  message?: OllamaAssistantMessage;
  done?: boolean;
  error?: string;
}

/** A shape suitable for sending back to Ollama's /api/chat. */
interface OllamaConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LiveToolCall {
  id: string;
  toolName: string;
  argsSummary: string;
  status: "running" | "done" | "error";
  durationMs: number | null;
  resultPreview: string | null;
}

export type ApprovalDecision =
  | { kind: "approve"; cmd: string }
  | { kind: "modify"; cmd: string }
  | { kind: "deny"; reason?: string };

export interface PendingApproval {
  toolCallId: string;
  cmd: string;
  rationale?: string;
  resolve: (decision: ApprovalDecision) => void;
}

interface UseAgentLoopParams {
  activeModel: string | null;
  pageContext: PageContextValue;
  priorMessages: ChatMessage[];
  onAssistantMessage: (msg: ChatMessage) => Promise<void> | void;
  saveToolCall: (call: ChatToolCall) => Promise<void>;
  setStreaming: (b: boolean) => void;
  setStreamingContent: (s: string) => void;
  setError: (s: string | null) => void;
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
}

// ── The hook ──────────────────────────────────────────────────────────────────

export function useAgentLoop(params: UseAgentLoopParams) {
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [liveToolCalls, setLiveToolCalls] = useState<LiveToolCall[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const pendingApprovalRef = useRef<PendingApproval | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    // If there's a pending approval, resolve as deny so the loop unwinds cleanly.
    if (pendingApprovalRef.current) {
      pendingApprovalRef.current.resolve({ kind: "deny", reason: "aborted by user" });
      pendingApprovalRef.current = null;
      setPendingApproval(null);
    }
  }, []);

  const resolveApproval = useCallback((decision: ApprovalDecision) => {
    const pending = pendingApprovalRef.current;
    if (!pending) return;
    pending.resolve(decision);
    pendingApprovalRef.current = null;
    setPendingApproval(null);
  }, []);

  const runTurn = useCallback(
    async (userText: string, session: { id: string }): Promise<void> => {
      if (!params.activeModel) {
        params.setError("No model selected.");
        return;
      }

      params.setError(null);
      params.setStreaming(true);
      params.setStreamingContent("");
      // Reset live tool calls at the start of each turn so the streaming
      // bubble shows only what happened this turn.
      setLiveToolCalls([]);

      const abort = new AbortController();
      abortRef.current = abort;

      const ctx = params.pageContext;
      const baseSystemPrompt =
        buildSystemPrompt(ctx) +
        "\n\n" +
        `You are Harbor AI operating in AGENT MODE with READ-ONLY tool access.\n\n` +
        `HOW TO ANSWER:\n` +
        `- ALWAYS use tools to gather facts before answering. Do NOT answer from memory when a tool would give the real answer.\n` +
        `- For "what's running", "which containers", "check X" — call docker_list_containers / docker_stats / docker_logs / exec_read FIRST, then summarize what you found.\n` +
        `- Only make factual claims about container names, ports, paths, logs, or system state if a tool call returned that data. Never invent.\n` +
        `- Be concise. Stop calling tools as soon as you have enough info, and give a final answer citing what you learned.\n` +
        `- If a tool errors, adjust your approach — do not repeat the same failing call twice.\n\n` +
        `WHEN A TOOL RETURNS RESULTS — HOW TO WRITE YOUR ANSWER:\n\n` +
        `DO:\n` +
        `- Answer the user's actual question first, using the data you got.\n` +
        `- Give a compact, human-friendly summary. Example: "You have 5 running containers: kafka-1 (kafdrop), zookeeper-1, pg-main (postgres 15), redis, api. 7 are stopped."\n` +
        `- Cite specifics when relevant: "kafka-1 has been up 2 months on port 9000."\n` +
        `- Group by what matters (running vs stopped, healthy vs unhealthy, by compose project).\n\n` +
        `DO NOT:\n` +
        `- Describe the shape of the tool output. NEVER say "The output is an array of objects with properties like ID, Image, Labels…" or "Here is a breakdown of the structure".\n` +
        `- List JSON field names. The user does not care about the schema.\n` +
        `- Say "Interesting points about the response" or "The provided output appears to be…". This is meta-commentary the user did not ask for.\n` +
        `- Repeat the raw tool output. The user already sees it in the tool call row above your answer.\n\n` +
        `If a tool returned no data or an error, say so in one sentence and either try a different tool or ask the user for clarification.\n\n` +
        `IMPORTANT — READ-ONLY:\n` +
        `- You have NO write access. You cannot restart / start / stop / remove / install / edit anything.\n` +
        `- Never propose destructive commands, even in text. If the user asks to "restart / delete / install / modify", tell them the exact command they would need to run themselves and explain what it does — do not run it.`;

      // Build initial conversation.
      const prior = params.priorMessages.slice(-AI_ROLLING_WINDOW);
      const conversation: OllamaConversationMessage[] = [
        { role: "system", content: baseSystemPrompt },
        ...prior
          .filter((m) => m.role !== "system")
          .map<OllamaConversationMessage>((m) => ({
            role: m.role === "auto" ? "user" : m.role,
            content: m.content,
          })),
        { role: "user", content: userText },
      ];

      // Track duplicate tool calls per turn (name + args JSON).
      const seenCalls = new Map<string, number>();
      // Buffer of tool results for the SourcesFooter — added to the final assistant msg.
      const turnToolCalls: { name: string; args: unknown; result: AgentToolResult }[] = [];
      // The message_id all tool calls in this turn are attributed to.
      const messageId = newId("msg-");
      let iterationCount = 0;
      let finalContent = "";
      let hadError: string | null = null;
      const turnStarted = Date.now();

      try {
        for (;;) {
          if (iterationCount >= AI_MAX_ITERATIONS) {
            finalContent +=
              (finalContent ? "\n\n" : "") +
              `⚠ Hit the ${String(AI_MAX_ITERATIONS)}-iteration cap. Here is what I found so far.`;
            break;
          }
          iterationCount += 1;

          // Call Ollama with tools.
          const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: params.activeModel,
              stream: false, // agent turns are not user-facing streamed; we'll show phases
              messages: conversation,
              tools: AGENT_TOOL_SCHEMAS,
            }),
            signal: abort.signal,
          });
          if (!res.ok) {
            hadError = `Ollama /api/chat failed (${String(res.status)})`;
            break;
          }
          const json = (await res.json()) as OllamaChatResponse;
          if (json.error) {
            hadError = json.error;
            break;
          }
          const assistant = json.message;
          if (!assistant) {
            hadError = "Empty response from model";
            break;
          }

          const toolCalls = assistant.tool_calls ?? [];
          const text = assistant.content ?? "";
          if (text) {
            finalContent += (finalContent ? "\n\n" : "") + text;
            params.setStreamingContent(finalContent);
          }

          // No tool calls → we're done.
          if (toolCalls.length === 0) break;

          // Push assistant turn (with tool_calls) into conversation before results.
          conversation.push({
            role: "assistant",
            content: text,
            tool_calls: toolCalls,
          });

          // Execute each tool call in order.
          for (const call of toolCalls) {
            if (abort.signal.aborted) throw new DOMException("aborted", "AbortError");

            const name = call.function.name;
            const args = normaliseArgs(call.function.arguments);
            const callKey = `${name}::${JSON.stringify(args)}`;
            const seenTimes = seenCalls.get(callKey) ?? 0;
            const toolCallId = call.id ?? newId("tc-");

            // Duplicate short-circuit
            if (seenTimes >= 2) {
              conversation.push({
                role: "tool",
                tool_call_id: toolCallId,
                name,
                content: JSON.stringify({
                  ok: false,
                  error:
                    "You already ran this tool with the same args twice. Try different args or answer with what you have.",
                }),
              });
              continue;
            }
            seenCalls.set(callKey, seenTimes + 1);

            const effectiveCmd: string | undefined = undefined;
            const approvalState = "auto";

            // Actually invoke the tool.
            const started = Date.now();
            const liveArgs = effectiveCmd ? { cmd: effectiveCmd } : args;
            const liveArgsSummary = summariseArgsForLive(liveArgs);

            // Push a "running" live tool row so the UI shows something is happening.
            setLiveToolCalls((prev) => [
              ...prev,
              {
                id: toolCallId,
                toolName: name,
                argsSummary: liveArgsSummary,
                status: "running",
                durationMs: null,
                resultPreview: null,
              },
            ]);

            let result: AgentToolResult;
            try {
              result = await withTimeout(invokeAgentTool(name, liveArgs), AI_TOOL_TIMEOUT_MS);
            } catch (e) {
              result = {
                ok: false,
                output: "",
                truncated: false,
                duration_ms: Date.now() - started,
                error: e instanceof Error ? e.message : String(e),
                suggest_write: false,
              };
            }

            // Update the live row: done or error, with a preview of the output.
            setLiveToolCalls((prev) =>
              prev.map((row) =>
                row.id === toolCallId
                  ? {
                      ...row,
                      status: result.ok ? "done" : "error",
                      durationMs: result.duration_ms,
                      resultPreview: makePreview(
                        result.output.length > 0 ? result.output : (result.error ?? ""),
                      ),
                    }
                  : row,
              ),
            );

            turnToolCalls.push({
              name,
              args: effectiveCmd ? { cmd: effectiveCmd } : args,
              result,
            });
            await params.saveToolCall({
              id: newId("tc-"),
              session_id: session.id,
              message_id: messageId,
              tool_name: name,
              args_json: JSON.stringify(effectiveCmd ? { cmd: effectiveCmd } : args),
              result_json: JSON.stringify(result),
              result_truncated: result.truncated ? 1 : 0,
              approval_state: approvalState,
              duration_ms: result.duration_ms,
              invoked_at: Date.now(),
            });

            conversation.push({
              role: "tool",
              tool_call_id: toolCallId,
              name,
              content: JSON.stringify(result),
            });
          }
          // Loop back — LLM will see tool results in the next call.
        }
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") {
          hadError = e instanceof Error ? e.message : String(e);
        }
      }

      // Assemble the final assistant message record.
      const elapsed = Date.now() - turnStarted;
      const assistantMsg: ChatMessage = {
        id: messageId,
        session_id: session.id,
        role: "assistant",
        content: finalContent || (hadError ? `Error: ${hadError}` : "(empty response)"),
        created_at: Date.now(),
        ctx_page: ctx.currentPage,
        ctx_host: ctx.terminal?.connectedHost ?? null,
        ctx_cwd: ctx.terminal?.cwd ?? null,
        ctx_last_cmd: ctx.terminal?.lastCommand ?? null,
        ctx_node_id: ctx.docker?.selectedNodeId ?? null,
        ctx_node_type: ctx.docker?.selectedNodeType ?? null,
        ctx_node_json: ctx.docker?.selectedNodeJson ?? null,
        model_id: params.activeModel,
        response_ms: elapsed,
        token_count: null,
        has_commands: turnToolCalls.length > 0 ? 1 : 0,
        error: hadError,
      };
      await params.onAssistantMessage(assistantMsg);
      params.setMessages((prev) => {
        if (prev.some((m) => m.id === assistantMsg.id)) return prev;
        if (prev[0]?.session_id && prev[0].session_id !== session.id) return prev;
        return [...prev, assistantMsg];
      });
      params.setStreaming(false);
      params.setStreamingContent("");
      abortRef.current = null;
      if (hadError) params.setError(hadError);
    },
    [params],
  );

  return {
    runTurn,
    stop,
    pendingApproval,
    resolveApproval,
    liveToolCalls,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newId(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normaliseArgs(args: OllamaToolCall["function"]["arguments"]): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as unknown;
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return args;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`tool timed out after ${String(ms)}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Safely coerce an unknown value to a string for tool arguments. */
function argStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
function argNum(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Compact, glanceable summary of tool args for the live row (e.g. `name="db-1"`). */
function summariseArgsForLive(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const s = typeof v === "string" ? `"${v}"` : argStr(v);
    parts.push(`${k}=${s.length > 24 ? s.slice(0, 24) + "…" : s}`);
    if (parts.length >= 3) break;
  }
  return parts.join(", ");
}

/** First line + length hint from the tool output, for the live row. */
function makePreview(output: string): string {
  if (!output) return "(no output)";
  const first = output.split("\n").find((l) => l.trim().length > 0) ?? "";
  return first.length > 80 ? first.slice(0, 80) + "…" : first;
}

async function invokeAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<AgentToolResult> {
  switch (name) {
    case "docker_list_containers":
      return agentDockerListContainers();
    case "docker_logs":
      return agentDockerLogs(argStr(args.name), argNum(args.tail), argStr(args.since) || undefined);
    case "docker_inspect":
      return agentDockerInspect(argStr(args.name));
    case "docker_stats":
      return agentDockerStats();
    case "docker_networks":
      return agentDockerNetworks();
    case "docker_volumes":
      return agentDockerVolumes();
    case "read_file":
      return agentReadFile(argStr(args.path));
    case "list_directory":
      return agentListDirectory(argStr(args.path));
    case "exec_read":
      return agentExecRead(argStr(args.cmd));
    default:
      return {
        ok: false,
        output: "",
        truncated: false,
        duration_ms: 0,
        error: `Unknown tool: ${name}`,
        suggest_write: false,
      };
  }
}
