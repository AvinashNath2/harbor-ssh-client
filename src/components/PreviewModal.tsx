import { Check, ChevronDown, ChevronUp, Info, Pencil, Search, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as jsYaml from "js-yaml";
import xmlFormatter from "xml-formatter";
import { readFilePreview, readFilePreviewTail, writeFileText, type FileEntry } from "../api";
import type { PendingCommand } from "../hooks/useSessionLog";
import { fileIcon, fileTypeLabel, isKnownBinary, languageForFilename } from "../utils/fileType";
import { CodeMirrorEditor, type CodeMirrorHandle } from "./CodeMirrorEditor";
import { UnviewableFileCard, type UnviewableReason } from "./UnviewableFileCard";

/** Max bytes we ever fetch for a preview. Matches SFTP_PREVIEW_CAP_BYTES in Rust. */
const PREVIEW_CAP_BYTES = 10 * 1024 * 1024;
/** Above this file size we warn the user before starting the fetch. */
const HUGE_FILE_THRESHOLD = 50 * 1024 * 1024;
/** How much of the file we ship into the session-log record (cheap storage). */
const SESSION_LOG_CAP = 50 * 1024;

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

function ext(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface PreviewModalProps {
  entry: FileEntry;
  onClose: () => void;
  onDownload: () => void;
  onCommandLogged?: (cmd: PendingCommand) => void;
}

export function PreviewModal({ entry, onClose, onDownload, onCommandLogged }: PreviewModalProps) {
  const [state, setState] = useState<
    "loading" | "confirm-huge" | "image" | "text" | "binary" | "directory" | "error"
  >("loading");
  const [unviewableReason, setUnviewableReason] = useState<UnviewableReason>("binary");
  /** Original content as loaded from the server. Never mutated after load. */
  const [content, setContent] = useState("");
  /** Working buffer used in edit mode. Diverges from `content` when dirty. */
  const [draft, setDraft] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [fetchMode, setFetchMode] = useState<"head" | "tail">("head");
  const [error, setError] = useState("");
  const [wrap, setWrap] = useState(true);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [formatError, setFormatError] = useState<string | null>(null);
  const [fetchNonce, setFetchNonce] = useState(0);

  const fileExt = ext(entry.name);
  const isImage = IMAGE_EXTS.has(fileExt);
  const isLogFile = fileExt === "log";
  const language = languageForFilename(entry.name);
  const canFormat =
    state === "text" && (language === "json" || language === "xml" || language === "yaml");
  const typeLabel = fileTypeLabel(entry.name, entry.kind);
  const icon = fileIcon(entry.name, entry.kind);
  const isDirty = mode === "edit" && draft !== content;

  const entryDir = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";

  const editorRef = useRef<CodeMirrorHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Bumped each time we begin a fetch. In-flight promises check this on
   *  completion and abort their state writes if a newer fetch has started
   *  or the modal was closed. */
  const activeFetchRef = useRef(0);

  // Load content on mount / when the file changes / on retry (fetchNonce bump).
  useEffect(() => {
    if (entry.kind === "directory") {
      setState("directory");
      return;
    }
    // Skip byte fetch for known-binary extensions — jump straight to the card.
    if (!isImage && isKnownBinary(fileExt)) {
      setUnviewableReason("binary");
      setState("binary");
      onCommandLogged?.({
        executedAt: Date.now(),
        cwd: entryDir,
        raw: `open ${entry.path}`,
        exitCode: 0,
        durationMs: 0,
        output: null,
        outputTruncated: false,
        originalOutputBytes: 0,
        source: "file_browser",
      });
      return;
    }
    // Huge files: confirm before pulling anything. Images bypass the confirm
    // (they're capped by the same PREVIEW_CAP_BYTES on the Rust side anyway).
    if (
      !isImage &&
      entry.size !== null &&
      entry.size > HUGE_FILE_THRESHOLD &&
      state !== "confirm-huge" &&
      fetchNonce === 0
    ) {
      setState("confirm-huge");
      return;
    }

    // Begin fetch. Any earlier in-flight fetch will see its nonce is stale
    // and skip its state writes.
    const myNonce = activeFetchRef.current + 1;
    activeFetchRef.current = myNonce;
    const t0 = Date.now();
    setState("loading");
    setSaveMsg(null);
    setMode("view");
    setFormatError(null);

    const reader = fetchMode === "tail" ? readFilePreviewTail : readFilePreview;
    reader(entry.path, PREVIEW_CAP_BYTES)
      .then((b64) => {
        if (activeFetchRef.current !== myNonce) return; // stale response
        if (isImage) {
          const mime = IMAGE_MIME[fileExt] ?? "image/png";
          setContent(`data:${mime};base64,${b64}`);
          setDraft("");
          setState("image");
          onCommandLogged?.({
            executedAt: t0,
            cwd: entryDir,
            raw: `open ${entry.path}`,
            exitCode: 0,
            durationMs: Date.now() - t0,
            output: null,
            outputTruncated: false,
            originalOutputBytes: 0,
            source: "file_browser",
          });
        } else {
          try {
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            setContent(text);
            setDraft(text);
            setState("text");
            const hitCap = bytes.length >= PREVIEW_CAP_BYTES;
            const knownLarger = entry.size !== null && entry.size > PREVIEW_CAP_BYTES;
            setTruncated(hitCap || knownLarger);
            const logSlice = text.length > SESSION_LOG_CAP ? text.slice(0, SESSION_LOG_CAP) : text;
            onCommandLogged?.({
              executedAt: t0,
              cwd: entryDir,
              raw: `${fetchMode === "tail" ? "tail" : "cat"} ${entry.path}`,
              exitCode: 0,
              durationMs: Date.now() - t0,
              output: logSlice,
              outputTruncated: text.length > SESSION_LOG_CAP,
              originalOutputBytes: text.length,
              source: "file_browser",
            });
          } catch {
            setUnviewableReason("encoding");
            setState("binary");
          }
        }
      })
      .catch((e: unknown) => {
        if (activeFetchRef.current !== myNonce) return;
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      });
    // Invalidate all in-flight fetches when the modal unmounts.
    return () => {
      activeFetchRef.current = -1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path, entry.kind, isImage, fileExt, fetchMode, fetchNonce]);

  const closeWithGuard = useCallback(() => {
    if (isDirty && !confirm("You have unsaved changes. Discard them?")) return;
    onClose();
  }, [isDirty, onClose]);

  // Global keys: Esc, Cmd/Ctrl+F, Cmd/Ctrl+S
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (document.activeElement === searchInputRef.current) {
          if (query) {
            setQuery("");
            editorRef.current?.clearSearch();
          }
          searchInputRef.current?.blur();
          e.preventDefault();
          return;
        }
        closeWithGuard();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (state === "text") {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (mode === "edit" && isDirty && !saving) {
          e.preventDefault();
          void handleSave();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeWithGuard, state, mode, isDirty, saving, query]);

  // Debounce the raw `query` (per-keystroke) into `debouncedQuery` (settled).
  // Keeps search snappy on multi-MB files where a full-doc re-decorate on
  // every keystroke would feel sluggish.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 150);
    return () => {
      window.clearTimeout(t);
    };
  }, [query]);

  // Push the debounced query into the editor.
  useEffect(() => {
    if (state !== "text") return;
    editorRef.current?.setSearch(debouncedQuery);
  }, [debouncedQuery, state]);

  function nextMatch() {
    editorRef.current?.findNext();
  }
  function prevMatch() {
    editorRef.current?.findPrev();
  }
  function clearSearch() {
    setQuery("");
    editorRef.current?.clearSearch();
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(mode === "edit" ? draft : content);
    } catch {
      /* ignore */
    }
  }

  async function handleSave() {
    if (!isDirty || saving) return;
    setSaving(true);
    setSaveMsg(null);
    const t0 = Date.now();
    try {
      await writeFileText(entry.path, draft);
      setContent(draft);
      setSaveMsg({ ok: true, text: "Saved" });
      onCommandLogged?.({
        executedAt: t0,
        cwd: entryDir,
        raw: `write ${entry.path}`,
        exitCode: 0,
        durationMs: Date.now() - t0,
        output: `Saved ${draft.length.toString()} bytes`,
        outputTruncated: false,
        originalOutputBytes: draft.length,
        source: "file_browser",
      });
      window.setTimeout(() => {
        setSaveMsg((cur) => (cur?.ok ? null : cur));
      }, 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveMsg({ ok: false, text: msg });
      onCommandLogged?.({
        executedAt: t0,
        cwd: entryDir,
        raw: `write ${entry.path}`,
        exitCode: 1,
        durationMs: Date.now() - t0,
        output: msg,
        outputTruncated: false,
        originalOutputBytes: 0,
        source: "file_browser",
      });
    } finally {
      setSaving(false);
    }
  }

  function discardChanges() {
    if (!isDirty) {
      setMode("view");
      return;
    }
    if (!confirm("Discard unsaved changes?")) return;
    setDraft(content);
    setMode("view");
    setSaveMsg(null);
    setFormatError(null);
  }

  function handleFormat() {
    if (!canFormat) return;
    const src = mode === "edit" ? draft : content;
    try {
      let out: string;
      if (language === "json") {
        out = JSON.stringify(JSON.parse(src), null, 2);
      } else if (language === "xml") {
        out = xmlFormatter(src, {
          indentation: "  ",
          collapseContent: true,
          lineSeparator: "\n",
        });
      } else {
        // language === "yaml" — canFormat guard above ensures we never hit anything else.
        out = jsYaml.dump(jsYaml.load(src), { indent: 2, lineWidth: 120, noRefs: true });
      }
      setFormatError(null);
      // Format is a real modification — switch to edit mode so the user can save it.
      setDraft(out);
      setMode("edit");
      setSaveMsg(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFormatError(msg);
    }
  }

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(20,18,15,0.62)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeWithGuard();
      }}
    >
      <div
        className="flex h-[90vh] w-[92vw] max-w-[1400px] flex-col overflow-hidden rounded-modal border border-border-raised bg-surface-pane"
        style={{ boxShadow: "0 40px 100px -20px rgba(20,18,15,0.55)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] font-mono text-[9px] font-bold"
            style={{ background: icon.bg, color: icon.fg }}
          >
            {icon.glyph}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 truncate">
              <span className="truncate text-[13.5px] font-semibold text-text-primary">
                {entry.name}
              </span>
              {isDirty && (
                <span
                  className="flex-shrink-0 rounded-chip px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.5px]"
                  style={{ background: "#fff2d1", color: "#8a6020" }}
                >
                  Unsaved
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-text-tertiary">
              <span>{typeLabel}</span>
              <span>·</span>
              <span className="truncate">{entry.path}</span>
              {entry.size !== null && (
                <>
                  <span>·</span>
                  <span>{fmtSize(entry.size)}</span>
                </>
              )}
            </div>
          </div>

          <button
            onClick={closeWithGuard}
            title="Close (Esc)"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>

        {/* Truncation warning — with a switch button between head and tail */}
        {truncated && state === "text" && (
          <div className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-2 text-[12px] text-[#8a6020]">
            <span className="font-semibold">⚠ File truncated</span>
            <span className="text-[#8a6020]/80">
              — showing {fetchMode === "tail" ? "last" : "first"} {fmtSize(PREVIEW_CAP_BYTES)}
              {entry.size !== null && entry.size > PREVIEW_CAP_BYTES
                ? ` of ${fmtSize(entry.size)}`
                : ""}
              .
            </span>
            <button
              onClick={() => {
                setFetchMode(fetchMode === "tail" ? "head" : "tail");
                setFetchNonce((n) => n + 1);
              }}
              className="ml-auto rounded-input border border-[#8a6020]/30 bg-white/50 px-2 py-0.5 text-[11px] font-medium text-[#8a6020] transition-colors hover:bg-white"
            >
              {fetchMode === "tail"
                ? `Show first ${fmtSize(PREVIEW_CAP_BYTES)}`
                : `Show last ${fmtSize(PREVIEW_CAP_BYTES)}`}
            </button>
            <button
              onClick={onDownload}
              className="rounded-input border border-[#8a6020]/30 bg-white/50 px-2 py-0.5 text-[11px] font-medium text-[#8a6020] transition-colors hover:bg-white"
            >
              Download full file
            </button>
          </div>
        )}

        {/* Toolbar */}
        {state === "text" && (
          <div className="flex items-center gap-2 border-b border-border px-5 py-2">
            {/* Search box */}
            <div className="flex h-8 flex-1 items-center gap-2 rounded-input border border-border-input bg-surface-colheader px-3">
              <span className="text-text-faint">
                <Search size={13} strokeWidth={2} />
              </span>
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (e.shiftKey) prevMatch();
                    else nextMatch();
                  }
                }}
                placeholder="Find in file (⌘F)"
                className="flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-faint"
              />
              {query && (
                <>
                  <button
                    onClick={prevMatch}
                    title="Previous match (Shift+Enter)"
                    className="text-text-faint hover:text-text-secondary"
                  >
                    <ChevronUp size={12} strokeWidth={2.2} />
                  </button>
                  <button
                    onClick={nextMatch}
                    title="Next match (Enter)"
                    className="text-text-faint hover:text-text-secondary"
                  >
                    <ChevronDown size={12} strokeWidth={2.2} />
                  </button>
                  <button
                    onClick={clearSearch}
                    title="Clear search"
                    className="text-text-faint hover:text-text-secondary"
                  >
                    <X size={12} strokeWidth={2.2} />
                  </button>
                </>
              )}
            </div>

            {/* Action buttons */}
            {canFormat && (
              <button
                onClick={handleFormat}
                className="flex items-center gap-1.5 rounded-input border border-border-input bg-surface-chip px-2.5 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
                title={`Pretty-print this ${language.toUpperCase()} — switches to edit mode`}
              >
                <Wand2 size={11} strokeWidth={2} />
                Format
              </button>
            )}
            <div className="flex items-center">
              <button
                onClick={() => {
                  setWrap((w) => !w);
                }}
                className="rounded-l-input border border-r-0 border-border-input bg-surface-chip px-2.5 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
                title={
                  wrap
                    ? "Line wrap is ON — click to turn off (long lines will scroll sideways)"
                    : "Line wrap is OFF — click to turn on (long lines will fold to fit)"
                }
              >
                {wrap ? "No wrap" : "Wrap"}
              </button>
              <span
                className="flex h-[26px] items-center justify-center rounded-r-input border border-border-input bg-surface-chip px-1.5 text-text-faint"
                title="Line wrap ON: long lines fold to the next visual row (no sideways scroll). Line wrap OFF: long lines run off the right; scroll horizontally to see the rest. Toggle it based on whether you're reading prose/logs (wrap) or code/tables (no wrap)."
              >
                <Info size={11} strokeWidth={2} />
              </span>
            </div>
            <button
              onClick={() => {
                void copyToClipboard();
              }}
              className="rounded-input border border-border-input bg-surface-chip px-2.5 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
              title="Copy content"
            >
              Copy
            </button>

            {mode === "view" ? (
              <button
                onClick={() => {
                  setMode("edit");
                  setSaveMsg(null);
                }}
                className="flex items-center gap-1.5 rounded-input border border-border-input bg-surface-chip px-2.5 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
                title="Edit file"
              >
                <Pencil size={11} strokeWidth={2} /> Edit
              </button>
            ) : (
              <>
                <button
                  onClick={discardChanges}
                  className="rounded-input border border-border-input bg-surface-chip px-2.5 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
                  title="Discard changes and return to view mode"
                >
                  Discard
                </button>
                <button
                  onClick={() => {
                    void handleSave();
                  }}
                  disabled={!isDirty || saving}
                  className="rounded-input px-3 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
                  title="Save changes (⌘S)"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Save result strip */}
        {saveMsg && (
          <div
            className="flex items-center gap-1.5 border-b border-border px-5 py-1.5 text-[11.5px]"
            style={
              saveMsg.ok
                ? { background: "rgba(31,157,99,0.10)", color: "#177a4c" }
                : { background: "rgba(229,83,75,0.10)", color: "#b33c34" }
            }
          >
            {saveMsg.ok ? <Check size={12} strokeWidth={2} /> : <X size={12} strokeWidth={2.2} />}
            {saveMsg.text}
          </div>
        )}

        {/* Format error banner — file content unchanged, just informing user */}
        {formatError && (
          <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/10 px-5 py-2 text-[11.5px] text-[#b33c34]">
            <X size={13} strokeWidth={2.2} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold">Cannot format:</span>{" "}
              <span className="break-words font-mono">{formatError}</span>
            </div>
            <button
              onClick={() => {
                setFormatError(null);
              }}
              title="Dismiss"
              className="flex-shrink-0 text-[#b33c34]/70 hover:text-[#b33c34]"
            >
              <X size={12} strokeWidth={2.2} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden" style={{ background: "#f8f6f1" }}>
          {state === "loading" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-text-secondary">
              <span
                className="inline-block h-5 w-5 flex-shrink-0 animate-spin rounded-full border-2"
                style={{ borderColor: "#3f7be0", borderTopColor: "transparent" }}
              />
              <span>
                {fetchMode === "tail" ? "Loading last part of" : "Loading"}{" "}
                {entry.size !== null && entry.size > PREVIEW_CAP_BYTES
                  ? `${fmtSize(PREVIEW_CAP_BYTES)} of ${fmtSize(entry.size)}`
                  : fmtSize(entry.size)}
                …
              </span>
              <button
                onClick={closeWithGuard}
                className="rounded-input border border-border-input px-2.5 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:bg-surface-chip hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
          )}

          {state === "confirm-huge" && (
            <div className="flex h-full items-center justify-center p-8">
              <div
                className="max-w-md rounded-modal border border-border-raised bg-surface-pane p-6 text-center"
                style={{ boxShadow: "0 12px 40px -12px rgba(20,18,15,0.30)" }}
              >
                <h2 className="mb-1.5 text-[15px] font-semibold text-text-primary">
                  This is a large file
                </h2>
                <p className="mb-5 text-[12.5px] leading-relaxed text-text-secondary">
                  {entry.name} is {fmtSize(entry.size)}. Only the{" "}
                  {fetchMode === "tail" ? "last" : "first"} {fmtSize(PREVIEW_CAP_BYTES)} will be
                  loaded — the rest can be reached with
                  <span className="mx-1 rounded bg-surface-chip px-1 py-0.5 font-mono text-[11px]">
                    Download full file
                  </span>
                  or from the terminal.
                </p>
                <div className="flex justify-center gap-2">
                  <button
                    onClick={closeWithGuard}
                    className="rounded-input border border-border-input bg-surface-chip px-3 py-1.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setFetchMode("head");
                      setFetchNonce((n) => n + 1);
                    }}
                    className="rounded-input border border-border-input bg-surface-chip px-3 py-1.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
                  >
                    Load first {fmtSize(PREVIEW_CAP_BYTES)}
                  </button>
                  <button
                    onClick={() => {
                      setFetchMode("tail");
                      setFetchNonce((n) => n + 1);
                    }}
                    className="rounded-input px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
                  >
                    Load last {fmtSize(PREVIEW_CAP_BYTES)}
                  </button>
                </div>
              </div>
            </div>
          )}

          {state === "directory" && (
            <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
              Directory — no preview available
            </div>
          )}

          {state === "binary" && (
            <UnviewableFileCard entry={entry} reason={unviewableReason} onDownload={onDownload} />
          )}

          {state === "error" && (
            <div className="flex h-full items-center justify-center text-[13px] text-danger">
              {error}
            </div>
          )}

          {state === "image" && (
            <div className="flex h-full items-center justify-center p-8">
              <img
                src={content}
                alt={entry.name}
                className="max-h-full max-w-full rounded object-contain shadow-lg"
              />
            </div>
          )}

          {state === "text" && (
            <CodeMirrorEditor
              ref={editorRef}
              value={mode === "edit" ? draft : content}
              readOnly={mode === "view"}
              language={language}
              lineWrap={wrap}
              highlightErrors={isLogFile}
              onChange={
                mode === "edit"
                  ? (v) => {
                      setDraft(v);
                      setSaveMsg(null);
                      setFormatError(null);
                    }
                  : undefined
              }
              onSave={
                mode === "edit"
                  ? () => {
                      if (isDirty && !saving) void handleSave();
                    }
                  : undefined
              }
            />
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border px-5 py-2 text-[11px] text-text-faint">
          <span>
            {mode === "edit" ? "Read-write • changes saved to remote" : "Read-only preview"}
          </span>
          <span className="flex items-center gap-3">
            {state === "text" && (
              <>
                <span>
                  <kbd className="rounded border border-border-input px-1.5 py-0.5 font-mono text-[10px]">
                    ⌘F
                  </kbd>{" "}
                  find
                </span>
                {mode === "edit" && (
                  <span>
                    <kbd className="rounded border border-border-input px-1.5 py-0.5 font-mono text-[10px]">
                      ⌘S
                    </kbd>{" "}
                    save
                  </span>
                )}
              </>
            )}
            <span>
              <kbd className="rounded border border-border-input px-1.5 py-0.5 font-mono text-[10px]">
                Esc
              </kbd>{" "}
              close
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
