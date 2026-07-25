import {
  AlertTriangle,
  ArrowUp,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  Minus,
  Paperclip,
  Play,
  Plus,
  Settings,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePageContext } from "../context/PageContext";
import { useChatSession, type ChatMessage, type ChatToolCall } from "../hooks/useChatSession";
import {
  MODEL_CATALOG,
  RECOMMENDED_TOOL_MODEL,
  isToolCapable,
  useModelManager,
  type CatalogModel,
} from "../hooks/useModelManager";
import { useAgentLoop, type LiveToolCall } from "../hooks/useAgentLoop";
import { onChatAsk, sendCommandToTerminal } from "../lib/terminalBus";

// ── Component ─────────────────────────────────────────────────────────────────

interface ChatPanelProps {
  host: string;
  onClose: () => void;
  /** When true, only the header renders (Messenger-style dock). */
  minimized?: boolean;
  /** Called when the user clicks the minimize/expand affordance. */
  onToggleMinimize?: () => void;
  /**
   * When set, auto-sends this message when the panel mounts or when the value
   * changes to a new non-null string. Used by the embedded Docker chat.
   */
  autoMessage?: string | null;
  /**
   * When true, the panel does NOT subscribe to the global chatBus — only
   * responds to messages sent via the `autoMessage` prop or typed by the user.
   * Prevents duplicate AI calls when an embedded and main panel coexist.
   */
  embedMode?: boolean;
}

export function ChatPanel({
  host,
  onClose,
  minimized = false,
  onToggleMinimize,
  autoMessage,
  embedMode = false,
}: ChatPanelProps) {
  const pageContext = usePageContext();
  const models = useModelManager();
  const chat = useChatSession({
    host,
    activeModel: models.activeModel,
    originPage: pageContext.currentPage,
    pageContext,
  });

  const [showModelManager, setShowModelManager] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [inputText, setInputText] = useState("");
  const [hiddenChips, setHiddenChips] = useState<Set<string>>(new Set());
  // Agent mode defaults ON when user hasn't explicitly set it — Harbor AI is
  // primarily an investigation tool, so tool-use should be the default UX.
  const [agentMode, setAgentModeState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("harbor.chat.agentMode");
      if (stored === "0") return false;
      return true; // default ON (also handles null / "1")
    } catch {
      return true;
    }
  });
  const setAgentMode = useCallback((next: boolean) => {
    setAgentModeState(next);
    try {
      localStorage.setItem("harbor.chat.agentMode", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  // Tool-call rows keyed by message_id — populated after each agent turn
  const [toolCallsByMessage, setToolCallsByMessage] = useState<Map<string, ChatToolCall[]>>(
    new Map(),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Agent loop hook — wires model + persistence + page context together
  const agent = useAgentLoop({
    activeModel: models.activeModel,
    pageContext,
    priorMessages: chat.messages,
    onAssistantMessage: async (msg) => {
      // Persist the assistant message ourselves — the agent loop assembled it.
      // We reuse insertMessage indirectly by relying on setMessages + a direct
      // DB call is not needed here because runTurn already saved tool calls;
      // the message itself is stored via chat.sendMessage-like path below.
      // For simplicity, we open a scoped DB insert here.
      if (chat.db) {
        await chat.db.execute(
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
            null,
            msg.has_commands,
            msg.error,
          ],
        );
        // Update session's last_active
        await chat.db.execute(
          "UPDATE chat_sessions SET last_active = $1, model_used = COALESCE($2, model_used) WHERE id = $3",
          [msg.created_at, msg.model_id, msg.session_id],
        );
      }
      // Refresh tool calls for this message so the UI can render them
      const calls = await chat.loadToolCallsForMessage(msg.id);
      setToolCallsByMessage((prev) => {
        const next = new Map(prev);
        next.set(msg.id, calls);
        return next;
      });
    },
    saveToolCall: chat.saveToolCall,
    setStreaming: chat.setStreaming,
    setStreamingContent: chat.setStreamingContent,
    setError: chat.setError,
    setMessages: chat.setMessages,
  });

  // Lazy-load tool calls for messages when they first appear
  useEffect(() => {
    (async () => {
      for (const m of chat.messages) {
        if (m.role !== "assistant" || m.has_commands === 0) continue;
        if (toolCallsByMessage.has(m.id)) continue;
        const calls = await chat.loadToolCallsForMessage(m.id);
        if (calls.length > 0) {
          setToolCallsByMessage((prev) => {
            const next = new Map(prev);
            next.set(m.id, calls);
            return next;
          });
        }
      }
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages.length]);

  // Auto-scroll to bottom on new messages / streaming updates
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.streamingContent]);

  // Listen for external "ask chat" events (Docker node clicks etc.)
  const chatRef = useRef(chat);
  chatRef.current = chat;
  useEffect(() => {
    if (embedMode) return; // embedded panel ignores global bus — prevents duplicate sends
    const off = onChatAsk((message, role) => {
      if (chatRef.current.streaming) return;
      void chatRef.current.sendMessage(message, role);
    });
    return off;
  }, [embedMode]);

  // Stable refs so the autoMessage effect can read latest values without stale closures
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;
  const modelsRef = useRef(models);
  modelsRef.current = models;

  // Auto-send autoMessage when it changes.
  // Depends on chat.db so it retries automatically once the SQLite DB is ready
  // (sendMessage silently no-ops when db is null, so we must wait for it).
  const prevAutoMsgRef = useRef<string | null | undefined>(undefined);
  const chatDb = chat.db;
  useEffect(() => {
    if (!autoMessage || autoMessage === prevAutoMsgRef.current) return;
    if (!chatDb) return; // DB not ready yet — effect re-runs when chatDb becomes non-null
    prevAutoMsgRef.current = autoMessage;
    if (chatRef.current.streaming) return;

    const text = autoMessage;
    if (agentModeRef.current && isToolCapable(modelsRef.current.activeModel)) {
      void (async () => {
        let session = chatRef.current.activeSession;
        if (!session) {
          await chatRef.current.startNewSession();
          session = chatRef.current.activeSession;
        }
        if (!session) return;
        const now = Date.now();
        const userMsg: ChatMessage = {
          id: `msg-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
          session_id: session.id,
          role: "user",
          content: text,
          created_at: now,
          ctx_page: pageContext.currentPage,
          ctx_host: pageContext.terminal?.connectedHost ?? host,
          ctx_cwd: pageContext.terminal?.cwd ?? null,
          ctx_last_cmd: pageContext.terminal?.lastCommand ?? null,
          ctx_node_id: pageContext.docker?.selectedNodeId ?? null,
          ctx_node_type: pageContext.docker?.selectedNodeType ?? null,
          ctx_node_json: pageContext.docker?.selectedNodeJson ?? null,
          model_id: null,
          response_ms: null,
          token_count: null,
          has_commands: 0,
          error: null,
        };
        await chatDb.execute(
          `INSERT INTO chat_messages
              (id, session_id, role, content, created_at, ctx_page, ctx_host, ctx_cwd, ctx_last_cmd,
               ctx_node_id, ctx_node_type, ctx_node_json, model_id, response_ms, token_count, has_commands, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            userMsg.id,
            userMsg.session_id,
            userMsg.role,
            userMsg.content,
            userMsg.created_at,
            userMsg.ctx_page,
            userMsg.ctx_host,
            userMsg.ctx_cwd,
            userMsg.ctx_last_cmd,
            userMsg.ctx_node_id,
            userMsg.ctx_node_type,
            userMsg.ctx_node_json,
            null,
            null,
            null,
            0,
            null,
          ],
        );
        chatRef.current.setMessages((prev) => [...prev, userMsg]);
        await agentRef.current.runTurn(text, { id: session.id });
      })();
    } else {
      void chatRef.current.sendMessage(text, "user");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMessage, chatDb]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || chat.streaming) return;
    setInputText("");
    setHiddenChips(new Set());
    if (agentMode && isToolCapable(models.activeModel)) {
      // Agent mode: create a user message + run the loop
      void (async () => {
        // Inline session bootstrap: use activeSession or create one now.
        let session = chat.activeSession;
        if (!session) {
          await chat.startNewSession();
          session = chat.activeSession;
        }
        if (!session) return;
        const now = Date.now();
        const userMsg: ChatMessage = {
          id: `msg-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
          session_id: session.id,
          role: "user",
          content: text,
          created_at: now,
          ctx_page: pageContext.currentPage,
          ctx_host: pageContext.terminal?.connectedHost ?? host,
          ctx_cwd: pageContext.terminal?.cwd ?? null,
          ctx_last_cmd: pageContext.terminal?.lastCommand ?? null,
          ctx_node_id: pageContext.docker?.selectedNodeId ?? null,
          ctx_node_type: pageContext.docker?.selectedNodeType ?? null,
          ctx_node_json: pageContext.docker?.selectedNodeJson ?? null,
          model_id: null,
          response_ms: null,
          token_count: null,
          has_commands: 0,
          error: null,
        };
        if (chat.db) {
          await chat.db.execute(
            `INSERT INTO chat_messages
              (id, session_id, role, content, created_at, ctx_page, ctx_host, ctx_cwd, ctx_last_cmd,
               ctx_node_id, ctx_node_type, ctx_node_json, model_id, response_ms, token_count, has_commands, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              userMsg.id,
              userMsg.session_id,
              userMsg.role,
              userMsg.content,
              userMsg.created_at,
              userMsg.ctx_page,
              userMsg.ctx_host,
              userMsg.ctx_cwd,
              userMsg.ctx_last_cmd,
              userMsg.ctx_node_id,
              userMsg.ctx_node_type,
              userMsg.ctx_node_json,
              null,
              null,
              null,
              0,
              null,
            ],
          );
        }
        chat.setMessages((prev) => [...prev, userMsg]);
        await agent.runTurn(text, { id: session.id });
      })();
    } else {
      void chat.sendMessage(text, "user");
    }
  }, [inputText, chat, agentMode, models.activeModel, agent, pageContext, host]);

  const handleRunCommand = useCallback(
    (msgId: string, blockIndex: number, cmd: string) => {
      sendCommandToTerminal(cmd);
      void chat.markCommandRun(msgId, blockIndex);
    },
    [chat],
  );

  const handleCopyCommand = useCallback(
    (msgId: string, blockIndex: number, cmd: string) => {
      void navigator.clipboard.writeText(cmd);
      void chat.markCommandCopied(msgId, blockIndex);
    },
    [chat],
  );

  const noModelSelected = models.ollamaRunning && !models.activeModel;
  const noModelInstalled = models.ollamaRunning && models.installedModels.length === 0;
  const canSend = !!models.activeModel && !chat.streaming && inputText.trim().length > 0;

  const contextChips = useMemo(() => buildContextChips(pageContext), [pageContext]);
  const visibleChips = contextChips.filter((c) => !hiddenChips.has(c.key));

  const insertPrompt = useCallback((text: string) => {
    setInputText(text);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, []);

  return (
    <div
      className={`flex w-full flex-col border-l border-border bg-surface-pane ${
        minimized ? "h-11 rounded-tl-[10px] border-t" : "h-full"
      }`}
    >
      {/* Header — single row. When minimized, whole header is a click target that expands. */}
      <div
        className={`relative flex h-11 flex-none items-center justify-between bg-surface-toolbar px-2.5 ${
          minimized ? "cursor-pointer rounded-tl-[10px]" : "border-b border-border"
        }`}
        onClick={
          minimized
            ? () => {
                onToggleMinimize?.();
              }
            : undefined
        }
      >
        <button
          onClick={(e) => {
            if (minimized) return; // header click already handles expand
            e.stopPropagation();
            if (chat.sessions.length > 0) setShowSessionMenu((v) => !v);
          }}
          className="group flex min-w-0 items-center gap-2 rounded-input px-1.5 py-1 hover:bg-surface-chip"
          title={minimized ? "Click header to expand" : "Session history"}
        >
          <span
            className={`h-2 w-2 flex-none rounded-full ${
              models.ollamaRunning ? "bg-success" : "bg-danger"
            }`}
            title={models.ollamaRunning ? "Ollama running" : "Ollama not detected"}
          />
          <span className="truncate text-[12.5px] font-semibold text-text-primary">
            {chat.activeSession?.title ?? "Harbor AI"}
          </span>
          {!minimized && chat.sessions.length > 0 && (
            <ChevronDown
              size={12}
              className={`flex-none text-text-tertiary transition-transform ${
                showSessionMenu ? "rotate-180" : ""
              }`}
            />
          )}
        </button>

        <div
          className="flex flex-none items-center gap-0.5"
          onClick={(e) => {
            // Prevent the header-click-to-expand from firing when clicking buttons.
            if (minimized) e.stopPropagation();
          }}
        >
          {!minimized && (
            <button
              title={
                agentMode
                  ? "Agent mode ON — AI runs read-only tools on your VM to investigate"
                  : "Agent mode OFF — plain chat, AI only writes commands for you to run"
              }
              onClick={() => {
                setAgentMode(!agentMode);
              }}
              className={`flex h-7 items-center gap-1 rounded-full border px-2 text-[10.5px] font-semibold transition-colors ${
                agentMode
                  ? "border-accent-dark bg-accent-dark text-white hover:bg-accent"
                  : "border-border-input bg-surface-pane text-text-tertiary hover:bg-surface-chip hover:text-text-primary"
              }`}
            >
              <Zap
                size={10}
                className={agentMode ? "fill-current" : ""}
                strokeWidth={agentMode ? 2.4 : 2}
              />
              Agent {agentMode ? "ON" : "OFF"}
            </button>
          )}
          {!minimized && (
            <IconBtn
              title="AI Models"
              onClick={() => {
                setShowModelManager(true);
              }}
            >
              <Settings size={13} />
            </IconBtn>
          )}
          {!minimized && (
            <IconBtn
              title="New chat"
              onClick={() => {
                void chat.startNewSession();
                setInputText("");
                setShowSessionMenu(false);
              }}
            >
              <Plus size={14} />
            </IconBtn>
          )}
          {onToggleMinimize && (
            <IconBtn
              title={minimized ? "Expand chat" : "Minimize chat"}
              onClick={() => {
                onToggleMinimize();
              }}
            >
              {minimized ? <Maximize2 size={11} /> : <Minus size={13} />}
            </IconBtn>
          )}
          <IconBtn title="Close" onClick={onClose}>
            <X size={13} />
          </IconBtn>
        </div>

        {!minimized && showSessionMenu && (
          <SessionPickerPopover
            sessions={chat.sessions}
            activeId={chat.activeSession?.id ?? null}
            onSelect={(id) => {
              void chat.switchSession(id);
              setShowSessionMenu(false);
            }}
            onNew={() => {
              void chat.startNewSession();
              setInputText("");
              setShowSessionMenu(false);
            }}
            onDismiss={() => {
              setShowSessionMenu(false);
            }}
          />
        )}
      </div>

      {/* Everything below the header only when expanded */}
      {!minimized && (
        <>
          {/* Banners */}
          {!models.ollamaRunning && !models.checking && (
            <Banner
              tone="warn"
              title="Ollama not detected"
              body="Install Ollama to enable AI chat. It runs locally — no data leaves your machine."
              action={{
                label: "Download Ollama",
                icon: <ExternalLink size={10} />,
                onClick: () => {
                  void openUrl("https://ollama.com/download");
                },
              }}
            />
          )}
          {noModelInstalled && (
            <Banner
              tone="info"
              title="No AI models installed"
              body="Download a small model to start chatting."
              action={{
                label: "Open Models",
                icon: <Sparkles size={10} />,
                onClick: () => {
                  setShowModelManager(true);
                },
              }}
            />
          )}
          {noModelSelected && !noModelInstalled && (
            <Banner
              tone="info"
              title="No active model"
              action={{
                label: "Pick a model",
                icon: <Cpu size={10} />,
                onClick: () => {
                  setShowModelManager(true);
                },
              }}
            />
          )}
          {agentMode && models.activeModel && !isToolCapable(models.activeModel) && (
            <Banner
              tone="warn"
              title="Agent mode needs a tool-capable model"
              body={`${models.activeModel} does not support tool-calling. Download & switch to ${RECOMMENDED_TOOL_MODEL} (2 GB) for agent mode to work.`}
              action={{
                label: "Open Models",
                icon: <Download size={10} />,
                onClick: () => {
                  setShowModelManager(true);
                },
              }}
            />
          )}
          {chat.error && (
            <div className="flex-none border-b border-danger/30 bg-danger/5 px-3 py-1.5">
              <p className="text-[11px] text-danger">{chat.error}</p>
            </div>
          )}

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto"
            style={{ scrollbarWidth: "thin" }}
          >
            {chat.messages.length === 0 && !chat.streaming ? (
              <EmptyState page={pageContext.currentPage} onPick={insertPrompt} />
            ) : (
              <div className="flex flex-col gap-3 px-3 py-3">
                {chat.messages.map((m) => (
                  <MessageRow
                    key={m.id}
                    msg={m}
                    toolCalls={toolCallsByMessage.get(m.id) ?? []}
                    onCopy={handleCopyCommand}
                    onRun={handleRunCommand}
                  />
                ))}
                {chat.streaming && (
                  <div className="flex flex-col gap-2">
                    {agent.liveToolCalls.length > 0 && (
                      <LiveToolCallsPanel calls={agent.liveToolCalls} model={models.activeModel} />
                    )}
                    <MessageRow
                      key="streaming"
                      streaming
                      toolCalls={[]}
                      onCopy={handleCopyCommand}
                      onRun={handleRunCommand}
                      msg={{
                        id: "streaming",
                        session_id: "",
                        role: "assistant",
                        content: chat.streamingContent,
                        created_at: Date.now(),
                        ctx_page: null,
                        ctx_host: null,
                        ctx_cwd: null,
                        ctx_last_cmd: null,
                        ctx_node_id: null,
                        ctx_node_type: null,
                        ctx_node_json: null,
                        model_id: models.activeModel,
                        response_ms: null,
                        token_count: null,
                        has_commands: 0,
                        error: null,
                      }}
                    />
                  </div>
                )}
                {/* Approval flow removed — agent is read-only. Left for future write-tool support. */}
              </div>
            )}
          </div>

          {/* Input capsule */}
          <div className="flex-none border-t border-border bg-surface-toolbar px-2.5 py-2.5">
            <div
              className={`overflow-hidden rounded-[12px] border bg-surface-input transition-colors ${
                chat.streaming
                  ? "border-accent-muted/50"
                  : "border-border-input focus-within:border-accent-muted"
              }`}
            >
              {/* Context chips row (only when relevant) */}
              {visibleChips.length > 0 && (
                <div className="flex flex-wrap gap-1 border-b border-border-subtle px-2.5 py-1.5">
                  <Paperclip size={9} className="mt-1 text-text-faint" />
                  {visibleChips.map((chip) => (
                    <ContextChip
                      key={chip.key}
                      chip={chip}
                      onRemove={() => {
                        setHiddenChips((prev) => {
                          const next = new Set(prev);
                          next.add(chip.key);
                          return next;
                        });
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Textarea */}
              <AutoTextarea
                ref={inputRef}
                value={inputText}
                onChange={setInputText}
                onSubmit={handleSend}
                disabled={!models.activeModel || chat.streaming}
                placeholder={
                  !models.ollamaRunning
                    ? "Install Ollama to enable chat"
                    : !models.activeModel
                      ? "Pick a model to start chatting"
                      : chat.streaming
                        ? "Waiting for response…"
                        : "Ask about your containers, terminal, or files…"
                }
              />

              {/* Bottom row: model chip · mode chip · hint · send button */}
              <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    onClick={() => {
                      setShowModelManager(true);
                    }}
                    className="flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-[10.5px] font-medium text-text-secondary hover:bg-surface-chip hover:text-text-primary"
                    title="Change model"
                  >
                    <Cpu size={10} />
                    {models.activeModel ?? "No model"}
                    <ChevronDown size={9} className="text-text-faint" />
                  </button>
                  {agentMode && isToolCapable(models.activeModel) && (
                    <span
                      title="Agent mode: AI will investigate using read-only tools"
                      className="flex items-center gap-0.5 rounded-chip bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-dark"
                    >
                      <Zap size={9} className="fill-current" /> Agent
                    </span>
                  )}
                </div>

                <p className="hidden truncate text-[10px] text-text-faint sm:block">
                  <kbd className="rounded border border-border-input bg-surface-input px-1 font-mono">
                    ⏎
                  </kbd>{" "}
                  send <span className="mx-0.5 text-text-faint/60">·</span>
                  <kbd className="rounded border border-border-input bg-surface-input px-1 font-mono">
                    ⇧⏎
                  </kbd>{" "}
                  newline
                </p>

                {chat.streaming ? (
                  <button
                    onClick={() => {
                      if (agentMode) agent.stop();
                      else chat.stopStreaming();
                    }}
                    title="Stop"
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-danger text-white transition-colors hover:bg-danger/90"
                  >
                    <Square size={11} />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!canSend}
                    title="Send (Enter)"
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-dark text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:bg-text-faint/40"
                  >
                    <ArrowUp size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {showModelManager && (
            <ModelManagerModal
              mm={models}
              onClose={() => {
                setShowModelManager(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Context chips ─────────────────────────────────────────────────────────────

interface ContextChipData {
  key: string;
  icon: React.ReactNode;
  label: string;
  detail: string;
}

function buildContextChips(pageContext: ReturnType<typeof usePageContext>): ContextChipData[] {
  const chips: ContextChipData[] = [];
  if (pageContext.currentPage === "docker" && pageContext.docker) {
    const { selectedNodeType, selectedNodeJson, containerCount, networkCount, volumeCount } =
      pageContext.docker;
    let label = "Docker";
    let detail = `${String(containerCount)}c · ${String(networkCount)}n · ${String(volumeCount)}v`;
    if (selectedNodeJson) {
      try {
        const parsed = JSON.parse(selectedNodeJson) as { name?: string };
        const name = typeof parsed.name === "string" ? parsed.name.replace(/^\//, "") : "?";
        label = `${selectedNodeType ?? "node"}: ${name}`;
        detail = "selected";
      } catch {
        /* ignore */
      }
    }
    chips.push({
      key: "docker",
      icon: <Boxes size={9} />,
      label,
      detail,
    });
  }
  if (pageContext.currentPage === "terminal" && pageContext.terminal) {
    chips.push({
      key: "terminal",
      icon: <TerminalSquare size={9} />,
      label: `Terminal · ${pageContext.terminal.cwd || "~"}`,
      detail: pageContext.terminal.connectedHost || "",
    });
  }
  if (pageContext.currentPage === "files" && pageContext.file) {
    chips.push({
      key: "file",
      icon: <FileText size={9} />,
      label: `File · ${pageContext.file.fileName}`,
      detail: pageContext.file.filePath,
    });
  }
  return chips;
}

function ContextChip({ chip, onRemove }: { chip: ContextChipData; onRemove: () => void }) {
  return (
    <span
      title={chip.detail}
      className="group flex items-center gap-1 rounded-chip bg-surface-chip px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
    >
      {chip.icon}
      <span className="max-w-[140px] truncate">{chip.label}</span>
      <button
        onClick={onRemove}
        title="Remove from this message"
        className="ml-0.5 text-text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
      >
        <X size={9} />
      </button>
    </span>
  );
}

// ── Empty state — Capability Playbook ─────────────────────────────────────────

interface PlaybookCategory {
  emoji: string;
  label: string;
  hint: string;
  prompts: string[];
}

const PLAYBOOK: PlaybookCategory[] = [
  {
    emoji: "🔎",
    label: "Discover your setup",
    hint: "See what's running",
    prompts: [
      "What's running on this VM?",
      "Which containers are exposed to the internet?",
      "Show me my databases and where their data lives",
    ],
  },
  {
    emoji: "🪵",
    label: "Logs & debugging",
    hint: "Find and read logs",
    prompts: [
      "Where are the logs for each of my containers?",
      "Show me last hour of errors across all containers",
      "Why is one of my containers restarting?",
    ],
  },
  {
    emoji: "🩺",
    label: "Health checks",
    hint: "See what's unwell",
    prompts: [
      "Anything unhealthy right now?",
      "Which containers are using the most CPU or memory?",
      "Is the proxy slow — what should I check?",
    ],
  },
  {
    emoji: "🔒",
    label: "Security scan",
    hint: "Spot exposure & risks",
    prompts: [
      "Any security concerns in my current setup?",
      "Which containers are reachable from outside the VM?",
      "Are any of my images out of date?",
    ],
  },
  {
    emoji: "🧹",
    label: "Cleanup & disk",
    hint: "Reclaim space",
    prompts: [
      "How can I safely reclaim disk space?",
      "Which volumes are orphaned and can be removed?",
      "How big is each of my named volumes?",
    ],
  },
  {
    emoji: "🔗",
    label: "Understand relationships",
    hint: "See what talks to what",
    prompts: [
      "Which containers talk to my database?",
      "If I stop the cache, what breaks?",
      "How does traffic flow through my setup?",
    ],
  },
  {
    emoji: "📚",
    label: "Explain what things are",
    hint: "Get plain-English explanations",
    prompts: [
      "What is the backend network for?",
      "Why do I have a Redis container in this setup?",
      "Explain what the worker container does",
    ],
  },
  {
    emoji: "🛠",
    label: "Configuration & migration",
    hint: "Upgrade, back up, migrate",
    prompts: [
      "How do I safely upgrade Postgres to a newer version?",
      "Give me a script to back up all named volumes",
      "How do I add a new container to my existing network?",
    ],
  },
  {
    emoji: "💻",
    label: "Environment questions",
    hint: "About this host",
    prompts: [
      "What OS am I on and what package manager to use?",
      "How do I check disk usage on this VM?",
      "Install htop on this host",
    ],
  },
  {
    emoji: "📝",
    label: "Workflows & recipes",
    hint: "Multi-step setups",
    prompts: [
      "Set up a nightly backup for my database volume",
      "Give me a compose snippet to add Prometheus + Grafana",
      "Build me a one-line health-dashboard command",
    ],
  },
];

function EmptyState({ page, onPick }: { page: string; onPick: (t: string) => void }) {
  const [openCat, setOpenCat] = useState<string | null>(null);

  const subtitle =
    page === "docker"
      ? "Explore your containers, networks, and volumes."
      : page === "terminal"
        ? "Ask about your shell, processes, or last output."
        : page === "files"
          ? "Ask about the current file or folder."
          : "Ask anything about your infra, terminal, or files.";

  return (
    <div className="flex h-full flex-col">
      {/* Header greeting */}
      <div className="flex flex-none flex-col items-center gap-2 border-b border-border-subtle px-4 pb-3 pt-5 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent-dark">
          <Sparkles size={16} />
        </div>
        <div>
          <p className="text-[13.5px] font-semibold text-text-primary">Harbor AI</p>
          <p className="mt-0.5 text-[11px] text-text-tertiary">{subtitle}</p>
        </div>
      </div>

      {/* Playbook — scrollable list of categories */}
      <div className="flex-1 overflow-y-auto px-2 py-2" style={{ scrollbarWidth: "thin" }}>
        <p className="mb-1 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-text-tertiary">
          Capability playbook
        </p>
        <p className="mb-2 px-1 text-[10.5px] text-text-tertiary">
          Tap a category to see example questions, or click one to try it.
        </p>
        <div className="flex flex-col gap-1">
          {PLAYBOOK.map((cat) => (
            <PlaybookCategoryRow
              key={cat.label}
              cat={cat}
              open={openCat === cat.label}
              onToggle={() => {
                setOpenCat((prev) => (prev === cat.label ? null : cat.label));
              }}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlaybookCategoryRow({
  cat,
  open,
  onToggle,
  onPick,
}: {
  cat: PlaybookCategory;
  open: boolean;
  onToggle: () => void;
  onPick: (t: string) => void;
}) {
  return (
    <div
      className={`overflow-hidden rounded-input border transition-colors ${
        open ? "border-accent-muted/60 bg-surface-hover/60" : "border-border-subtle bg-surface-pane"
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="text-[13px]">{cat.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-semibold text-text-primary">{cat.label}</p>
          <p className="truncate text-[10px] text-text-tertiary">{cat.hint}</p>
        </div>
        <ChevronDown
          size={11}
          className={`flex-none text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-border-subtle bg-surface-pane px-1.5 py-1.5">
          {cat.prompts.map((p) => (
            <button
              key={p}
              onClick={() => {
                onPick(p);
              }}
              className="group flex items-start gap-1.5 rounded-chip px-1.5 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
            >
              <ArrowUp
                size={9}
                className="mt-0.5 flex-none rotate-45 text-text-faint transition-colors group-hover:text-accent-dark"
              />
              <span className="leading-snug">{p}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Message rendering ─────────────────────────────────────────────────────────

function MessageRow({
  msg,
  toolCalls,
  streaming,
  onCopy,
  onRun,
}: {
  msg: ChatMessage;
  toolCalls: ChatToolCall[];
  streaming?: boolean;
  onCopy: (id: string, idx: number, cmd: string) => void;
  onRun: (id: string, idx: number, cmd: string) => void;
}) {
  if (msg.role === "auto") return <ContextMessage msg={msg} />;
  if (msg.role === "user") return <UserMessage msg={msg} />;
  return (
    <AssistantMessage
      msg={msg}
      toolCalls={toolCalls}
      streaming={streaming}
      onCopy={onCopy}
      onRun={onRun}
    />
  );
}

function ContextMessage({ msg }: { msg: ChatMessage }) {
  // Extract a short label from the auto-message (before the first period)
  const short = msg.content.split(/[.—\n]/)[0].slice(0, 90);
  return (
    <div className="flex items-center gap-1.5 self-start rounded-full bg-surface-chip/70 px-2 py-1 text-[10.5px] text-text-tertiary">
      <Paperclip size={9} />
      <span className="truncate">Context added — {short}</span>
    </div>
  );
}

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="pr-1 text-[10px] font-medium text-text-tertiary">
        You · {formatTime(msg.created_at)}
      </span>
      <div className="max-w-[92%] rounded-[10px] bg-accent/8 px-3 py-2 text-[12px] leading-relaxed text-text-primary">
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    </div>
  );
}

function AssistantMessage({
  msg,
  toolCalls,
  streaming,
  onCopy,
  onRun,
}: {
  msg: ChatMessage;
  toolCalls: ChatToolCall[];
  streaming?: boolean;
  onCopy: (id: string, idx: number, cmd: string) => void;
  onRun: (id: string, idx: number, cmd: string) => void;
}) {
  const byline = (
    <div className="mb-1 flex items-center gap-1.5">
      <div className="flex h-4 w-4 items-center justify-center rounded bg-accent/10 text-accent-dark">
        <Sparkles size={9} />
      </div>
      <span className="text-[10px] font-medium text-text-tertiary">Harbor AI</span>
      {msg.model_id && (
        <>
          <span className="text-text-faint">·</span>
          <span className="text-[10px] font-mono text-text-tertiary">{msg.model_id}</span>
        </>
      )}
      {msg.response_ms !== null && !streaming && (
        <>
          <span className="text-text-faint">·</span>
          <span className="text-[10px] text-text-tertiary">{formatMs(msg.response_ms)}</span>
        </>
      )}
      {streaming && (
        <span
          className="ml-1 h-1.5 w-1.5 rounded-full bg-accent-dark"
          style={{ animation: "harbor-pulse 1.4s ease-in-out infinite" }}
        />
      )}
    </div>
  );

  const isAgentTurn = toolCalls.length > 0;

  return (
    <div className="flex flex-col">
      {byline}
      {/* Tool-call rows appear ABOVE the answer (they were executed to produce it) */}
      {toolCalls.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {toolCalls.map((tc) => (
            <ToolCallRow key={tc.id} call={tc} />
          ))}
        </div>
      )}
      <div className="text-[12.5px] leading-relaxed text-text-primary">
        {msg.content ? (
          <MarkdownContent
            content={msg.content}
            messageId={msg.id}
            onCopy={onCopy}
            onRun={onRun}
            streaming={streaming}
          />
        ) : streaming ? (
          <BlinkingCursor />
        ) : (
          <span className="italic text-text-tertiary">(empty response)</span>
        )}
      </div>
      {msg.error && (
        <p className="mt-1 flex items-center gap-1 text-[10.5px] text-danger">
          <span>⚠</span> {msg.error}
        </p>
      )}
      {/* Sources footer for agent answers */}
      {!streaming && msg.role === "assistant" && msg.model_id && (
        <SourcesFooter toolCalls={toolCalls} isAgentTurn={isAgentTurn} />
      )}
    </div>
  );
}

// ── Tool call row (collapsible) ───────────────────────────────────────────────

// ── Live tool calls (streaming) ───────────────────────────────────────────────

function LiveToolCallsPanel({ calls, model }: { calls: LiveToolCall[]; model: string | null }) {
  return (
    <div className="flex flex-col">
      {/* Small byline so the streaming panel visually matches assistant messages */}
      <div className="mb-1 flex items-center gap-1.5">
        <div className="flex h-4 w-4 items-center justify-center rounded bg-accent/10 text-accent-dark">
          <Sparkles size={9} />
        </div>
        <span className="text-[10px] font-medium text-text-tertiary">Harbor AI</span>
        {model && (
          <>
            <span className="text-text-faint">·</span>
            <span className="font-mono text-[10px] text-text-tertiary">{model}</span>
          </>
        )}
        <span className="text-text-faint">·</span>
        <span className="text-[10px] text-text-tertiary">investigating…</span>
        <span
          className="ml-1 h-1.5 w-1.5 rounded-full bg-accent-dark"
          style={{ animation: "harbor-pulse 1.4s ease-in-out infinite" }}
        />
      </div>
      <div className="flex flex-col gap-1">
        {calls.map((c) => (
          <LiveToolRow key={c.id} call={c} />
        ))}
      </div>
    </div>
  );
}

function LiveToolRow({ call }: { call: LiveToolCall }) {
  const isRunning = call.status === "running";
  const isError = call.status === "error";
  const dur = call.durationMs != null ? formatMs(call.durationMs) : "";
  const label = isRunning
    ? `Running ${call.toolName}${call.argsSummary ? ` (${call.argsSummary})` : ""}…`
    : isError
      ? `Failed ${call.toolName}`
      : `${call.toolName}${call.argsSummary ? ` (${call.argsSummary})` : ""}`;
  return (
    <div className="overflow-hidden rounded-[6px] border border-border-subtle bg-surface-pane px-2 py-1.5 text-[10.5px]">
      <div className="flex items-center gap-1.5">
        {isRunning ? (
          <div
            className="h-2 w-2 flex-none rounded-full bg-accent-dark"
            style={{ animation: "harbor-pulse 1.1s ease-in-out infinite" }}
          />
        ) : isError ? (
          <AlertTriangle size={10} className="flex-none text-danger" />
        ) : (
          <Check size={10} className="flex-none text-success" />
        )}
        <Wrench size={9} className="flex-none text-text-tertiary" />
        <span className="truncate text-text-primary">{label}</span>
        {dur && <span className="ml-auto flex-none text-text-faint">{dur}</span>}
      </div>
      {call.resultPreview && !isRunning && (
        <p className="mt-1 truncate pl-3.5 font-mono text-[10px] text-text-tertiary">
          → {call.resultPreview}
        </p>
      )}
    </div>
  );
}

function ToolCallRow({ call }: { call: ChatToolCall }) {
  // Default OPEN so users see what happened without a click.
  const [open, setOpen] = useState(true);
  const args = call.args_json ? summariseArgs(call.args_json) : "";
  const result = call.result_json ? tryParseResult(call.result_json) : null;
  const ok = result?.ok ?? false;
  const durationLabel = call.duration_ms != null ? formatMs(call.duration_ms) : "";
  const state = call.approval_state;
  const narration = deriveNarration(call.tool_name, args, result, durationLabel);

  return (
    <div className="overflow-hidden rounded-[6px] border border-border-subtle bg-surface-pane">
      <button
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10.5px] hover:bg-surface-hover"
      >
        <ChevronRight
          size={10}
          className={`flex-none text-text-tertiary transition-transform ${open ? "rotate-90" : ""}`}
        />
        {ok ? (
          <Check size={10} className="flex-none text-success" />
        ) : (
          <AlertTriangle size={10} className="flex-none text-warning" />
        )}
        <Wrench size={9} className="flex-none text-text-tertiary" />
        <span className="truncate text-text-primary">{narration}</span>
        <span className="ml-auto flex flex-none items-center gap-1.5 pl-2 text-text-faint">
          {state && state !== "auto" && (
            <span
              className={`rounded-chip px-1 py-0.5 text-[9px] font-semibold uppercase ${
                state === "denied"
                  ? "bg-danger/10 text-danger"
                  : state === "modified"
                    ? "bg-warning/10 text-warning"
                    : "bg-accent/10 text-accent-dark"
              }`}
            >
              {state}
            </span>
          )}
          {durationLabel && <span>{durationLabel}</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-border-subtle bg-surface-input px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-text-secondary">{call.tool_name}</span>
            {args && (
              <span className="truncate font-mono text-[10px] text-text-tertiary">({args})</span>
            )}
          </div>
          {call.args_json && (
            <>
              <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
                Args
              </p>
              <pre className="mb-1.5 max-h-24 overflow-auto rounded bg-surface-pane px-2 py-1 font-mono text-[10.5px] text-text-primary">
                {prettyJson(call.args_json)}
              </pre>
            </>
          )}
          <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
            Result{call.result_truncated ? " (truncated)" : ""}
          </p>
          <pre className="max-h-48 overflow-auto rounded bg-surface-pane px-2 py-1 font-mono text-[10.5px] text-text-primary">
            {result
              ? result.output.length > 0
                ? result.output
                : result.error && result.error.length > 0
                  ? result.error
                  : "(empty)"
              : (call.result_json ?? "")}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Turn (tool_name, args, result) into a one-liner like:
 *   "Listed containers → 12 total"
 *   "Read logs for db-1 → 200 lines"
 *   "Ran df -h → OK"
 * Small enough to fit in the collapsed row; parseable at a glance.
 */
function deriveNarration(
  toolName: string,
  argsSummary: string,
  result: { ok: boolean; output: string; error: string | null } | null,
  durationLabel: string,
): string {
  const output = result?.output ?? "";
  const firstLine = output.split("\n").find((l) => l.trim().length > 0) ?? "";
  // Extract a headline from the pretty formatter, e.g. "Containers on this VM (12 total: ...)"
  const parenMatch = /\(([^)]+)\)/.exec(firstLine);
  const stat = parenMatch ? parenMatch[1] : "";

  const durSuffix = durationLabel ? ` · ${durationLabel}` : "";
  const errSuffix = result && !result.ok ? " · ERROR" : "";

  switch (toolName) {
    case "docker_list_containers":
      return `Listed containers${stat ? ` → ${stat}` : ""}${errSuffix}`;
    case "docker_stats":
      return `Read live stats${stat ? ` → ${stat}` : ""}${errSuffix}`;
    case "docker_networks":
      return `Listed Docker networks${errSuffix}`;
    case "docker_volumes":
      return `Listed Docker volumes${errSuffix}`;
    case "docker_logs": {
      const lines = output ? output.split("\n").length : 0;
      return `Read logs${argsSummary ? ` (${argsSummary})` : ""} → ${String(lines)} line${lines === 1 ? "" : "s"}${errSuffix}`;
    }
    case "docker_inspect":
      return `Inspected ${argsSummary || "container"}${errSuffix}`;
    case "read_file":
      return `Read file ${argsSummary}${errSuffix}${durSuffix ? "" : ""}`;
    case "list_directory":
      return `Listed directory ${argsSummary}${errSuffix}`;
    case "exec_read":
      return `Ran shell command ${argsSummary}${errSuffix}`;
    default:
      return `${toolName}${argsSummary ? ` (${argsSummary})` : ""}${errSuffix}`;
  }
}

// ── Sources footer ────────────────────────────────────────────────────────────

function SourcesFooter({
  toolCalls,
  isAgentTurn,
}: {
  toolCalls: ChatToolCall[];
  isAgentTurn: boolean;
}) {
  if (isAgentTurn && toolCalls.length > 0) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-[9.5px] font-semibold uppercase tracking-wide text-text-tertiary">
          Sources
        </span>
        {toolCalls.map((tc) => (
          <span
            key={tc.id}
            title={tc.args_json ?? ""}
            className="rounded-chip bg-surface-chip px-1.5 py-0.5 font-mono text-[9.5px] text-text-secondary"
          >
            {tc.tool_name}
          </span>
        ))}
      </div>
    );
  }
  // Non-agent assistant messages don't get the "no tools" warning — that's expected.
  return null;
}

// ApprovalCard was here — removed because agent is now strictly read-only.
// Kept in git history in case write-tool support is re-added later.

// ── Helpers used by ToolCallRow ───────────────────────────────────────────────

function summariseArgs(json: string): string {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const parts = Object.entries(obj).map(([k, v]) => {
      const s = typeof v === "string" ? `"${v}"` : String(v);
      return `${k}=${s.length > 30 ? s.slice(0, 30) + "…" : s}`;
    });
    return parts.join(", ");
  } catch {
    return json.slice(0, 40);
  }
}
function tryParseResult(
  json: string,
): { ok: boolean; output: string; error: string | null } | null {
  try {
    const j = JSON.parse(json) as { ok?: boolean; output?: string; error?: string | null };
    return {
      ok: Boolean(j.ok),
      output: typeof j.output === "string" ? j.output : "",
      error: typeof j.error === "string" ? j.error : null,
    };
  } catch {
    return null;
  }
}
function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function MarkdownContent({
  content,
  messageId,
  onCopy,
  onRun,
  streaming,
}: {
  content: string;
  messageId: string;
  onCopy: (id: string, idx: number, cmd: string) => void;
  onRun: (id: string, idx: number, cmd: string) => void;
  streaming?: boolean;
}) {
  // Track code block index across the message so Copy/Run link back to DB rows.
  const codeCounterRef = useRef(0);
  codeCounterRef.current = 0;

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 whitespace-pre-wrap">
              {children}
              {streaming && <BlinkingCursor />}
            </p>
          ),
          a: ({ href, children }) => (
            <a
              onClick={(e) => {
                e.preventDefault();
                if (href) void openUrl(href);
              }}
              className="cursor-pointer text-accent-dark underline decoration-accent-muted underline-offset-2 hover:text-accent"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="text-[12px]">{children}</li>,
          h1: ({ children }) => (
            <h2 className="mb-2 mt-2 text-[13.5px] font-semibold text-text-primary">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mb-1.5 mt-2 text-[12.5px] font-semibold text-text-primary">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1 mt-1.5 text-[12px] font-semibold text-text-primary">{children}</h4>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-2 border-border pl-2 text-text-secondary">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-text-primary">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="my-2 border-border-subtle" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border-subtle bg-surface-chip px-1.5 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border-subtle px-1.5 py-1">{children}</td>
          ),
          code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
            // Detect a fenced block via language className (react-markdown v9
            // no longer passes an `inline` flag — the presence of `language-xxx`
            // reliably means it's a code block from GFM).
            const langMatch = /language-([\w+-]+)/.exec(className ?? "");
            if (!langMatch) {
              return (
                <code className="rounded bg-surface-chip px-1 py-0.5 font-mono text-[11px] text-text-primary">
                  {children}
                </code>
              );
            }
            const lang = langMatch[1].toLowerCase();
            const raw = flattenToString(children).replace(/\n$/, "");
            const idx = codeCounterRef.current++;
            return (
              <CommandCard
                lang={lang}
                command={raw}
                onCopy={() => {
                  onCopy(messageId, idx, raw);
                }}
                onRun={
                  isShell(lang)
                    ? () => {
                        onRun(messageId, idx, raw);
                      }
                    : undefined
                }
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function isShell(lang: string): boolean {
  return ["bash", "sh", "shell", "zsh", "console"].includes(lang);
}

// ── Command card ──────────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, { bg: string; fg: string }> = {
  bash: { bg: "rgba(152,195,121,0.14)", fg: "#98c379" },
  sh: { bg: "rgba(152,195,121,0.14)", fg: "#98c379" },
  shell: { bg: "rgba(152,195,121,0.14)", fg: "#98c379" },
  zsh: { bg: "rgba(152,195,121,0.14)", fg: "#98c379" },
  python: { bg: "rgba(97,175,239,0.14)", fg: "#61afef" },
  py: { bg: "rgba(97,175,239,0.14)", fg: "#61afef" },
  sql: { bg: "rgba(198,120,221,0.14)", fg: "#c678dd" },
  yaml: { bg: "rgba(229,192,123,0.14)", fg: "#e5c07b" },
  yml: { bg: "rgba(229,192,123,0.14)", fg: "#e5c07b" },
  json: { bg: "rgba(229,192,123,0.14)", fg: "#e5c07b" },
  ts: { bg: "rgba(97,175,239,0.14)", fg: "#61afef" },
  typescript: { bg: "rgba(97,175,239,0.14)", fg: "#61afef" },
  js: { bg: "rgba(229,192,123,0.14)", fg: "#e5c07b" },
  javascript: { bg: "rgba(229,192,123,0.14)", fg: "#e5c07b" },
};

function CommandCard({
  lang,
  command,
  onCopy,
  onRun,
}: {
  lang: string;
  command: string;
  onCopy: () => void;
  onRun?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [ran, setRan] = useState(false);
  const colors = LANG_COLORS[lang] ?? { bg: "rgba(220,223,228,0.12)", fg: "#dcdfe4" };

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1200);
  };
  const handleRun = () => {
    onRun?.();
    setRan(true);
    setTimeout(() => {
      setRan(false);
    }, 1200);
  };

  return (
    <div
      className="my-2 overflow-hidden rounded-[8px] border border-white/5"
      style={{ background: "#1a1d24" }}
    >
      <div
        className="flex items-center justify-between border-b px-2 py-1"
        style={{ borderColor: "rgba(255,255,255,0.05)" }}
      >
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide"
          style={{ background: colors.bg, color: colors.fg }}
        >
          {lang}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            title="Copy to clipboard"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy"}
          </button>
          {onRun && (
            <button
              onClick={handleRun}
              title="Run in active terminal"
              className="flex items-center gap-1 rounded bg-accent-dark px-1.5 py-0.5 text-[10.5px] font-semibold text-white transition-colors hover:bg-accent"
            >
              {ran ? <Check size={10} /> : <Play size={10} />}
              {ran ? "Sent" : "Run"}
            </button>
          )}
        </div>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[#dcdfe4]">
        {command}
      </pre>
    </div>
  );
}

// ── Session picker popover ────────────────────────────────────────────────────

interface SessionListItem {
  id: string;
  title: string | null;
  last_active: number;
  message_count: number;
}

function SessionPickerPopover({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDismiss,
}: {
  sessions: SessionListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDismiss: () => void;
}) {
  const grouped = useMemo(() => groupSessionsByAge(sessions), [sessions]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onDismiss();
    }
    document.addEventListener("mousedown", onClickAway);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
    };
  }, [onDismiss]);

  return (
    <div
      ref={rootRef}
      className="absolute left-2 top-full z-20 mt-1 w-[280px] rounded-input border border-border bg-surface-pane shadow-modal"
    >
      <button
        onClick={onNew}
        className="flex w-full items-center gap-2 border-b border-border-subtle px-3 py-2 text-left text-[11.5px] font-medium text-accent-dark hover:bg-surface-hover"
      >
        <Plus size={12} />
        New chat
      </button>
      <div className="max-h-72 overflow-y-auto py-1">
        {grouped.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-text-tertiary">No previous chats yet.</p>
        )}
        {grouped.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-0.5 pt-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-text-tertiary">
              {group.label}
            </p>
            {group.items.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onSelect(s.id);
                }}
                className={`flex w-full flex-col items-start gap-0.5 border-l-2 px-3 py-1.5 text-left text-[11.5px] transition-colors hover:bg-surface-hover ${
                  s.id === activeId
                    ? "border-accent-dark bg-surface-hover text-text-primary"
                    : "border-transparent text-text-secondary"
                }`}
              >
                <span className="w-full truncate font-medium">{s.title ?? "Untitled chat"}</span>
                <span className="text-[10px] text-text-tertiary">
                  {formatRelative(s.last_active)} · {String(s.message_count)} msg
                  {s.message_count === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function groupSessionsByAge(sessions: SessionListItem[]) {
  const day = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart.getTime() - day;
  const weekStart = todayStart.getTime() - 7 * day;

  const buckets: { label: string; items: SessionListItem[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Last 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const s of sessions) {
    if (s.last_active >= todayStart.getTime()) buckets[0].items.push(s);
    else if (s.last_active >= yesterdayStart) buckets[1].items.push(s);
    else if (s.last_active >= weekStart) buckets[2].items.push(s);
    else buckets[3].items.push(s);
  }
  return buckets.filter((b) => b.items.length > 0);
}

// ── Auto-growing textarea ─────────────────────────────────────────────────────

const AutoTextarea = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  ref,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled: boolean;
  ref: React.RefObject<HTMLTextAreaElement | null>;
}) => {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 6 * 20 + 12; // ~6 rows
    el.style.height = `${String(Math.min(el.scrollHeight, maxHeight))}px`;
  }, [value, ref]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      className="block w-full resize-none bg-transparent px-3 py-2 text-[12.5px] leading-relaxed text-text-primary outline-none placeholder:text-text-faint disabled:cursor-not-allowed disabled:opacity-70"
      style={{ minHeight: "40px" }}
    />
  );
};

// ── Small primitives ──────────────────────────────────────────────────────────

function IconBtn({
  title,
  children,
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-chip text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
    >
      {children}
    </button>
  );
}

function Banner({
  tone,
  title,
  body,
  action,
}: {
  tone: "warn" | "info";
  title: string;
  body?: string;
  action?: { label: string; icon?: React.ReactNode; onClick: () => void };
}) {
  const cls = tone === "warn" ? "border-warning/30 bg-warning/10" : "border-accent/30 bg-accent/8";
  return (
    <div className={`flex-none border-b ${cls} px-3 py-2`}>
      <p className="text-[11.5px] font-medium text-text-primary">{title}</p>
      {body && <p className="mt-0.5 text-[10.5px] text-text-secondary">{body}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-accent-dark hover:underline"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}

function BlinkingCursor() {
  return (
    <span
      className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 bg-text-primary align-baseline"
      style={{ animation: "harbor-blink 1s steps(1) infinite" }}
    />
  );
}

// ── Model manager modal (existing, tidied lightly) ────────────────────────────

function ModelManagerModal({
  mm,
  onClose,
}: {
  mm: ReturnType<typeof useModelManager>;
  onClose: () => void;
}) {
  const installedSet = new Set(mm.installedModels);
  const uninstalled = MODEL_CATALOG.filter((m) => !installedSet.has(m.id));
  const installedInCatalog: CatalogModel[] = MODEL_CATALOG.filter((m) => installedSet.has(m.id));
  const installedExtra = mm.installedModels
    .filter((n) => !MODEL_CATALOG.some((m) => m.id === n))
    .map((n) => ({ id: n, label: n, size: "?", tier: "Custom" as const, desc: "Custom model" }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-[440px] flex-col overflow-hidden rounded-modal bg-surface-pane shadow-modal">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold text-text-primary">AI Models</h2>
            <p className="text-[10.5px] text-text-tertiary">
              Ollama:{" "}
              <span className={mm.ollamaRunning ? "text-success" : "text-danger"}>
                {mm.ollamaRunning ? "Running" : "Not detected"}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-chip p-1 text-text-secondary hover:bg-surface-chip hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!mm.ollamaRunning && (
            <div className="border-b border-warning/30 bg-warning/10 px-4 py-3">
              <p className="text-[12px] font-medium text-text-primary">
                Ollama is required to run local AI models.
              </p>
              <button
                onClick={() => {
                  void openUrl("https://ollama.com/download");
                }}
                className="mt-2 inline-flex items-center gap-1 rounded-input bg-accent-dark px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-accent"
              >
                <ExternalLink size={11} />
                Download Ollama
              </button>
            </div>
          )}

          {mm.ollamaRunning && (installedInCatalog.length > 0 || installedExtra.length > 0) && (
            <div>
              <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                Installed
              </p>
              <div className="mt-1 flex flex-col">
                {[...installedInCatalog, ...installedExtra].map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    installed
                    active={mm.activeModel === m.id}
                    onActivate={() => {
                      mm.setActiveModel(m.id);
                    }}
                    onDelete={() => {
                      void mm.deleteModel(m.id);
                    }}
                    error={mm.errorByModel.get(m.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {mm.ollamaRunning && uninstalled.length > 0 && (
            <div>
              <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                Available to download
              </p>
              <div className="mt-1 flex flex-col">
                {uninstalled.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    progress={mm.downloadProgress.get(m.id)}
                    onDownload={() => {
                      void mm.pullModel(m.id);
                    }}
                    onCancel={() => {
                      mm.cancelPull(m.id);
                    }}
                    error={mm.errorByModel.get(m.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-surface-toolbar px-4 py-2 text-[10px] text-text-tertiary">
          Models run locally on your machine — no data leaves your device.
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  installed,
  active,
  progress,
  error,
  onActivate,
  onDelete,
  onDownload,
  onCancel,
}: {
  model: { id: string; label: string; size: string; tier: string; desc: string };
  installed?: boolean;
  active?: boolean;
  progress?: number;
  error?: string;
  onActivate?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onCancel?: () => void;
}) {
  const isDownloading = progress !== undefined;
  return (
    <div className="border-b border-border-subtle px-4 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        {installed ? (
          <button
            onClick={onActivate}
            className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border transition-colors ${
              active
                ? "border-accent-dark bg-accent-dark"
                : "border-border-input hover:border-accent-muted"
            }`}
            title={active ? "Active model" : "Set as active"}
          >
            {active && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
          </button>
        ) : (
          <div className="mt-0.5 h-4 w-4 flex-none" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-text-primary">
              {model.label}
            </span>
            <span className="rounded-chip bg-surface-chip px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-secondary">
              {model.tier}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10.5px] text-text-tertiary">{model.desc}</p>
          <p className="mt-0.5 font-mono text-[10px] text-text-faint">
            {model.id} · {model.size}
          </p>
          {isDownloading && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-chip">
                <div
                  className="h-full bg-accent-dark transition-all"
                  style={{ width: `${String(progress)}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-text-secondary">
                {String(progress)}%
              </span>
            </div>
          )}
          {error && <p className="mt-1 text-[10.5px] text-danger">{error}</p>}
        </div>
        <div className="flex flex-none flex-col gap-1">
          {installed ? (
            <button
              onClick={onDelete}
              title="Remove model"
              className="rounded-chip p-1 text-text-tertiary hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          ) : isDownloading ? (
            <button
              onClick={onCancel}
              title="Cancel download"
              className="flex items-center gap-1 rounded-input border border-border-input px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-chip"
            >
              <X size={10} />
              Cancel
            </button>
          ) : (
            <button
              onClick={onDownload}
              title="Download model"
              className="flex items-center gap-1 rounded-input bg-accent-dark px-2 py-1 text-[10.5px] font-medium text-white hover:bg-accent"
            >
              <Download size={10} />
              Get
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function flattenToString(node: React.ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenToString).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props;
    return flattenToString(props?.children);
  }
  return "";
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${String(m)}m${String(s)}s`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${String(Math.floor(diff / min))}m ago`;
  if (diff < day) return `${String(Math.floor(diff / hr))}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Global CSS injection: blink + pulse + markdown scope ──────────────────────

if (typeof document !== "undefined") {
  const id = "harbor-chat-style";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes harbor-blink { 50% { opacity: 0; } }
      @keyframes harbor-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.4); opacity: 0.55; }
      }
      .markdown-body > *:first-child { margin-top: 0 !important; }
      .markdown-body > *:last-child { margin-bottom: 0 !important; }
    `;
    document.head.appendChild(style);
  }
}
