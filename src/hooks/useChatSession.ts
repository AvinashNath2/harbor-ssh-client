import Database from "@tauri-apps/plugin-sql";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageContextValue } from "../context/PageContext";
import { buildSystemPrompt } from "../context/pagePrompt";
import { OLLAMA_BASE_URL, AI_ROLLING_WINDOW } from "../config";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "auto";

export interface ChatMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: number;
  ctx_page: string | null;
  ctx_host: string | null;
  ctx_cwd: string | null;
  ctx_last_cmd: string | null;
  ctx_node_id: string | null;
  ctx_node_type: string | null;
  ctx_node_json: string | null;
  model_id: string | null;
  response_ms: number | null;
  token_count: number | null;
  has_commands: number;
  error: string | null;
}

export interface ChatSession {
  id: string;
  title: string | null;
  host: string;
  origin_page: string;
  started_at: number;
  last_active: number;
  message_count: number;
  model_used: string | null;
  archived: number;
}

export interface ChatToolCall {
  id: string;
  session_id: string;
  message_id: string;
  tool_name: string;
  args_json: string | null;
  result_json: string | null;
  result_truncated: number;
  approval_state: string | null; // 'auto' | 'approved' | 'denied' | 'modified'
  duration_ms: number | null;
  invoked_at: number;
}

export interface ChatCommand {
  id: string;
  message_id: string;
  session_id: string;
  language: string;
  command: string;
  block_index: number;
  was_copied: number;
  was_run: number;
  run_count: number;
  first_run_at: number | null;
  last_run_at: number | null;
}

// ── SQL schema (executed once on connect) ─────────────────────────────────────

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    id             TEXT    PRIMARY KEY,
    title          TEXT,
    host           TEXT    NOT NULL,
    origin_page    TEXT    NOT NULL,
    started_at     INTEGER NOT NULL,
    last_active    INTEGER NOT NULL,
    message_count  INTEGER DEFAULT 0,
    model_used     TEXT,
    archived       INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_host ON chat_sessions(host)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON chat_sessions(last_active DESC)`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
    id             TEXT    PRIMARY KEY,
    session_id     TEXT    NOT NULL,
    role           TEXT    NOT NULL,
    content        TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    ctx_page       TEXT,
    ctx_host       TEXT,
    ctx_cwd        TEXT,
    ctx_last_cmd   TEXT,
    ctx_node_id    TEXT,
    ctx_node_type  TEXT,
    ctx_node_json  TEXT,
    model_id       TEXT,
    response_ms    INTEGER,
    token_count    INTEGER,
    has_commands   INTEGER DEFAULT 0,
    error          TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_has_cmds ON chat_messages(has_commands)`,

  `CREATE TABLE IF NOT EXISTS chat_commands (
    id            TEXT    PRIMARY KEY,
    message_id    TEXT    NOT NULL,
    session_id    TEXT    NOT NULL,
    language      TEXT    NOT NULL DEFAULT 'bash',
    command       TEXT    NOT NULL,
    block_index   INTEGER NOT NULL,
    was_copied    INTEGER DEFAULT 0,
    was_run       INTEGER DEFAULT 0,
    run_count     INTEGER DEFAULT 0,
    first_run_at  INTEGER,
    last_run_at   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_commands_session ON chat_commands(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_commands_was_run ON chat_commands(was_run)`,

  `CREATE TABLE IF NOT EXISTS terminal_snapshots (
    id             TEXT    PRIMARY KEY,
    session_id     TEXT    NOT NULL,
    message_id     TEXT,
    host           TEXT    NOT NULL,
    cwd            TEXT,
    last_command   TEXT,
    last_output    TEXT,
    captured_at    INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tsnap_session ON terminal_snapshots(session_id)`,

  `CREATE TABLE IF NOT EXISTS docker_snapshots (
    id                 TEXT    PRIMARY KEY,
    session_id         TEXT    NOT NULL,
    message_id         TEXT,
    host               TEXT    NOT NULL,
    selected_node_id   TEXT,
    selected_node_type TEXT,
    selected_node_json TEXT,
    total_containers   INTEGER,
    total_networks     INTEGER,
    total_volumes      INTEGER,
    captured_at        INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dsnap_session ON docker_snapshots(session_id)`,

  `CREATE TABLE IF NOT EXISTS model_usage_log (
    id             TEXT    PRIMARY KEY,
    session_id     TEXT    NOT NULL,
    message_id     TEXT    NOT NULL,
    model_id       TEXT    NOT NULL,
    prompt_chars   INTEGER,
    response_chars INTEGER,
    response_ms    INTEGER,
    streamed       INTEGER DEFAULT 1,
    used_at        INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_model ON model_usage_log(model_id)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_session ON model_usage_log(session_id)`,

  // Agent tool-call audit log (Phase: agentic mode)
  `CREATE TABLE IF NOT EXISTS chat_tool_calls (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL,
    message_id        TEXT NOT NULL,
    tool_name         TEXT NOT NULL,
    args_json         TEXT,
    result_json       TEXT,
    result_truncated  INTEGER DEFAULT 0,
    approval_state    TEXT,
    duration_ms       INTEGER,
    invoked_at        INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_toolcalls_session ON chat_tool_calls(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_toolcalls_message ON chat_tool_calls(message_id)`,
];

// ── Utility functions ─────────────────────────────────────────────────────────

function newId(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Extract shell code blocks from an assistant message. */
export function extractCodeBlocks(
  content: string,
): { language: string; command: string; blockIndex: number }[] {
  const regex = /```(bash|sh|shell|zsh|python|sql|yaml|json)?\n([\s\S]*?)```/g;
  const out: { language: string; command: string; blockIndex: number }[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = regex.exec(content)) !== null) {
    out.push({
      language: (m[1] || "bash").toLowerCase(),
      command: m[2].trim(),
      blockIndex: idx++,
    });
  }
  return out;
}


interface OllamaChatChunk {
  model?: string;
  message?: { role: string; content: string };
  done?: boolean;
  error?: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseChatSessionParams {
  host: string;
  activeModel: string | null;
  originPage: string;
  pageContext: PageContextValue;
}

export function useChatSession({
  host,
  activeModel,
  originPage,
  pageContext,
}: UseChatSessionParams) {
  const [db, setDb] = useState<Database | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pageContextRef = useRef(pageContext);
  pageContextRef.current = pageContext;

  // Load DB and initialise schema once
  const cancelRef = useRef({ cancelled: false });
  useEffect(() => {
    const flag = cancelRef.current;
    flag.cancelled = false;
    void (async () => {
      try {
        const database = await Database.load("sqlite:harbor-docker-chat.db");
        for (const sql of SCHEMA_SQL) {
          await database.execute(sql);
        }
        if (!flag.cancelled) setDb(database);
      } catch (e) {
        if (!flag.cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      flag.cancelled = true;
    };
  }, []);

  // Load sessions for this host
  const loadSessions = useCallback(async () => {
    if (!db) return;
    try {
      const rows = await db.select<ChatSession[]>(
        "SELECT * FROM chat_sessions WHERE host = $1 AND archived = 0 ORDER BY last_active DESC",
        [host],
      );
      setSessions(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [db, host]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const loadMessages = useCallback(
    async (sessionId: string) => {
      if (!db) return;
      try {
        const rows = await db.select<ChatMessage[]>(
          "SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC",
          [sessionId],
        );
        setMessages(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [db],
  );

  const createSession = useCallback(async (): Promise<ChatSession | null> => {
    if (!db) return null;
    const now = Date.now();
    const s: ChatSession = {
      id: newId("sess-"),
      title: null,
      host,
      origin_page: originPage,
      started_at: now,
      last_active: now,
      message_count: 0,
      model_used: activeModel,
      archived: 0,
    };
    await db.execute(
      "INSERT INTO chat_sessions (id, title, host, origin_page, started_at, last_active, message_count, model_used, archived) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        s.id,
        s.title,
        s.host,
        s.origin_page,
        s.started_at,
        s.last_active,
        s.message_count,
        s.model_used,
        s.archived,
      ],
    );
    setActiveSession(s);
    setMessages([]);
    await loadSessions();
    return s;
  }, [db, host, originPage, activeModel, loadSessions]);

  const switchSession = useCallback(
    async (sessionId: string) => {
      if (!db) return;
      const s = sessions.find((x) => x.id === sessionId);
      if (!s) return;
      setActiveSession(s);
      await loadMessages(sessionId);
    },
    [db, sessions, loadMessages],
  );

  const insertMessage = useCallback(
    async (msg: ChatMessage): Promise<void> => {
      if (!db) return;
      await db.execute(
        `INSERT INTO chat_messages
          (id, session_id, role, content, created_at, ctx_page, ctx_host, ctx_cwd, ctx_last_cmd,
           ctx_node_id, ctx_node_type, ctx_node_json, model_id, response_ms, token_count, has_commands, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          msg.id,
          msg.session_id,
          msg.role,
          msg.content,
          msg.created_at,
          msg.ctx_page,
          msg.ctx_host,
          msg.ctx_cwd,
          msg.ctx_last_cmd,
          msg.ctx_node_id,
          msg.ctx_node_type,
          msg.ctx_node_json,
          msg.model_id,
          msg.response_ms,
          msg.token_count,
          msg.has_commands,
          msg.error,
        ],
      );
      await db.execute(
        "UPDATE chat_sessions SET last_active = $1, message_count = message_count + 1, model_used = COALESCE($2, model_used) WHERE id = $3",
        [msg.created_at, msg.model_id, msg.session_id],
      );
    },
    [db],
  );

  const saveSnapshot = useCallback(
    async (sessionId: string, messageId: string) => {
      if (!db) return;
      const ctx = pageContextRef.current;
      if (ctx.currentPage === "terminal" && ctx.terminal) {
        await db.execute(
          `INSERT INTO terminal_snapshots (id, session_id, message_id, host, cwd, last_command, last_output, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            newId("tsnap-"),
            sessionId,
            messageId,
            ctx.terminal.connectedHost,
            ctx.terminal.cwd,
            ctx.terminal.lastCommand,
            ctx.terminal.lastOutputLines.slice(-30).join("\n"),
            Date.now(),
          ],
        );
      }
      if (ctx.currentPage === "docker" && ctx.docker) {
        await db.execute(
          `INSERT INTO docker_snapshots (id, session_id, message_id, host, selected_node_id, selected_node_type, selected_node_json, total_containers, total_networks, total_volumes, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            newId("dsnap-"),
            sessionId,
            messageId,
            ctx.terminal?.connectedHost ?? host,
            ctx.docker.selectedNodeId,
            ctx.docker.selectedNodeType,
            ctx.docker.selectedNodeJson,
            ctx.docker.containerCount,
            ctx.docker.networkCount,
            ctx.docker.volumeCount,
            Date.now(),
          ],
        );
      }
    },
    [db, host],
  );

  const saveCommands = useCallback(
    async (msg: ChatMessage) => {
      if (!db) return;
      const blocks = extractCodeBlocks(msg.content);
      for (const b of blocks) {
        await db.execute(
          `INSERT INTO chat_commands (id, message_id, session_id, language, command, block_index)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId("cmd-"), msg.id, msg.session_id, b.language, b.command, b.blockIndex],
        );
      }
    },
    [db],
  );

  const saveToolCall = useCallback(
    async (call: ChatToolCall) => {
      if (!db) return;
      await db.execute(
        `INSERT INTO chat_tool_calls
          (id, session_id, message_id, tool_name, args_json, result_json,
           result_truncated, approval_state, duration_ms, invoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          call.id,
          call.session_id,
          call.message_id,
          call.tool_name,
          call.args_json,
          call.result_json,
          call.result_truncated,
          call.approval_state,
          call.duration_ms,
          call.invoked_at,
        ],
      );
    },
    [db],
  );

  const loadToolCallsForMessage = useCallback(
    async (messageId: string): Promise<ChatToolCall[]> => {
      if (!db) return [];
      return db.select<ChatToolCall[]>(
        `SELECT * FROM chat_tool_calls WHERE message_id = $1 ORDER BY invoked_at ASC`,
        [messageId],
      );
    },
    [db],
  );

  const saveModelUsage = useCallback(
    async (
      sessionId: string,
      messageId: string,
      modelId: string,
      promptChars: number,
      responseChars: number,
      responseMs: number,
    ) => {
      if (!db) return;
      await db.execute(
        `INSERT INTO model_usage_log (id, session_id, message_id, model_id, prompt_chars, response_chars, response_ms, streamed, used_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)`,
        [
          newId("use-"),
          sessionId,
          messageId,
          modelId,
          promptChars,
          responseChars,
          responseMs,
          Date.now(),
        ],
      );
    },
    [db],
  );

  const setSessionTitleIfEmpty = useCallback(
    async (sessionId: string, firstUserContent: string) => {
      if (!db) return;
      const title = firstUserContent.slice(0, 60).replace(/\s+/g, " ").trim();
      await db.execute("UPDATE chat_sessions SET title = $1 WHERE id = $2 AND title IS NULL", [
        title,
        sessionId,
      ]);
      await loadSessions();
    },
    [db, loadSessions],
  );

  // Ensure there's an active session; create one on demand
  const ensureSession = useCallback(async (): Promise<ChatSession | null> => {
    if (activeSession) return activeSession;
    return createSession();
  }, [activeSession, createSession]);

  const sendMessage = useCallback(
    async (userText: string, role: "user" | "auto" = "user"): Promise<void> => {
      if (!db) return;
      if (!activeModel) {
        setError("No model selected. Open Models to install/select one.");
        return;
      }
      const session = await ensureSession();
      if (!session) return;

      setError(null);
      setStreaming(true);
      setStreamingContent("");

      const ctx = pageContextRef.current;
      const now = Date.now();

      const userMsg: ChatMessage = {
        id: newId("msg-"),
        session_id: session.id,
        role,
        content: userText,
        created_at: now,
        ctx_page: ctx.currentPage,
        ctx_host: ctx.terminal?.connectedHost ?? host,
        ctx_cwd: ctx.terminal?.cwd ?? null,
        ctx_last_cmd: ctx.terminal?.lastCommand ?? null,
        ctx_node_id: ctx.docker?.selectedNodeId ?? null,
        ctx_node_type: ctx.docker?.selectedNodeType ?? null,
        ctx_node_json: ctx.docker?.selectedNodeJson ?? null,
        model_id: null,
        response_ms: null,
        token_count: null,
        has_commands: 0,
        error: null,
      };
      await insertMessage(userMsg);
      await saveSnapshot(session.id, userMsg.id);
      setMessages((prev) => {
        if (prev[0]?.session_id && prev[0].session_id !== session.id) return prev;
        return [...prev, userMsg];
      });
      if (!session.title) void setSessionTitleIfEmpty(session.id, userText);

      // Build message history for Ollama
      const priorAll = [...messages, userMsg];
      const priorPruned = priorAll.slice(-AI_ROLLING_WINDOW);
      const systemPrompt = buildSystemPrompt(ctx);
      const ollamaMessages = [
        { role: "system", content: systemPrompt },
        ...priorPruned
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "auto" ? "user" : m.role,
            content: m.content,
          })),
      ];

      const promptChars =
        systemPrompt.length + priorPruned.reduce((n, m) => n + m.content.length, 0);
      const started = Date.now();

      const abort = new AbortController();
      abortRef.current = abort;

      let assistantContent = "";
      let hadError: string | null = null;

      try {
        const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: activeModel,
            stream: true,
            messages: ollamaMessages,
          }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Ollama chat failed (${String(res.status)})`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const j = JSON.parse(line) as OllamaChatChunk;
              if (j.error) {
                hadError = j.error;
                continue;
              }
              const tok = j.message?.content ?? "";
              if (tok) {
                assistantContent += tok;
                setStreamingContent(assistantContent);
              }
            } catch {
              /* ignore parse errors on partial lines */
            }
          }
        }
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") {
          hadError = e instanceof Error ? e.message : String(e);
        }
      }

      const elapsed = Date.now() - started;
      const codeBlocks = extractCodeBlocks(assistantContent);
      const assistantMsg: ChatMessage = {
        id: newId("msg-"),
        session_id: session.id,
        role: "assistant",
        content: assistantContent || (hadError ? `Error: ${hadError}` : "(empty response)"),
        created_at: Date.now(),
        ctx_page: ctx.currentPage,
        ctx_host: ctx.terminal?.connectedHost ?? host,
        ctx_cwd: ctx.terminal?.cwd ?? null,
        ctx_last_cmd: ctx.terminal?.lastCommand ?? null,
        ctx_node_id: ctx.docker?.selectedNodeId ?? null,
        ctx_node_type: ctx.docker?.selectedNodeType ?? null,
        ctx_node_json: ctx.docker?.selectedNodeJson ?? null,
        model_id: activeModel,
        response_ms: elapsed,
        token_count: null,
        has_commands: codeBlocks.length > 0 ? 1 : 0,
        error: hadError,
      };
      await insertMessage(assistantMsg);
      await saveCommands(assistantMsg);
      await saveModelUsage(
        session.id,
        assistantMsg.id,
        activeModel,
        promptChars,
        assistantContent.length,
        elapsed,
      );
      // Only append to visible messages if we're still viewing the same session
      // (user might have switched sessions during streaming — DB is correct,
      // but the on-screen list should belong to whatever session is active now).
      setMessages((prev) => {
        if (prev.some((m) => m.id === assistantMsg.id)) return prev;
        if (prev[0]?.session_id && prev[0].session_id !== session.id) return prev;
        return [...prev, assistantMsg];
      });
      setStreaming(false);
      setStreamingContent("");
      abortRef.current = null;
      if (hadError) setError(hadError);
    },
    [
      db,
      activeModel,
      messages,
      host,
      ensureSession,
      insertMessage,
      saveSnapshot,
      saveCommands,
      saveModelUsage,
      setSessionTitleIfEmpty,
    ],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStreamingContent("");
  }, []);

  const startNewSession = useCallback(async () => {
    await createSession();
  }, [createSession]);

  const markCommandCopied = useCallback(
    async (messageId: string, blockIndex: number) => {
      if (!db) return;
      await db.execute(
        `UPDATE chat_commands SET was_copied = 1 WHERE message_id = $1 AND block_index = $2`,
        [messageId, blockIndex],
      );
    },
    [db],
  );

  const markCommandRun = useCallback(
    async (messageId: string, blockIndex: number) => {
      if (!db) return;
      const now = Date.now();
      await db.execute(
        `UPDATE chat_commands SET was_run = 1, run_count = run_count + 1,
           first_run_at = COALESCE(first_run_at, $1), last_run_at = $1
         WHERE message_id = $2 AND block_index = $3`,
        [now, messageId, blockIndex],
      );
    },
    [db],
  );

  return {
    db,
    sessions,
    activeSession,
    messages,
    streaming,
    streamingContent,
    error,
    sendMessage,
    stopStreaming,
    startNewSession,
    switchSession,
    markCommandCopied,
    markCommandRun,
    // Exposed for the agent loop to persist tool calls + drive message state
    saveToolCall,
    loadToolCallsForMessage,
    setStreaming,
    setStreamingContent,
    setError,
    setMessages,
  };
}
