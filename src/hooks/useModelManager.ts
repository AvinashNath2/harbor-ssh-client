import { useCallback, useEffect, useRef, useState } from "react";

export interface CatalogModel {
  id: string;
  label: string;
  size: string;
  tier: "Fast" | "Balanced" | "Max";
  desc: string;
}

export const MODEL_CATALOG: readonly CatalogModel[] = [
  {
    id: "phi3:mini",
    label: "Phi-3 Mini",
    size: "2.3 GB",
    tier: "Fast",
    desc: "Quick answers. Runs on any machine.",
  },
  {
    id: "llama3.2:3b",
    label: "Llama 3.2 3B",
    size: "2.0 GB",
    tier: "Fast",
    desc: "Excellent quality/speed balance.",
  },
  {
    id: "qwen2.5:3b",
    label: "Qwen 2.5 3B",
    size: "1.9 GB",
    tier: "Fast",
    desc: "Strong at infra and code topics.",
  },
  {
    id: "mistral:7b",
    label: "Mistral 7B",
    size: "4.1 GB",
    tier: "Balanced",
    desc: "High quality. Needs 8 GB RAM.",
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    size: "4.7 GB",
    tier: "Balanced",
    desc: "Very capable, long explanations.",
  },
  {
    id: "llama3.3:70b",
    label: "Llama 3.3 70B",
    size: "43 GB",
    tier: "Max",
    desc: "Best quality. Needs GPU / 64 GB RAM.",
  },
] as const;

const OLLAMA_BASE = "http://localhost:11434";
const ACTIVE_MODEL_KEY = "harbor.activeModel";

/**
 * Ollama models known to support the `tools` parameter in /api/chat.
 * Family-match against the id prefix — `llama3.2:3b`, `llama3.2:latest`,
 * `qwen2.5:3b-instruct` all resolve correctly.
 */
const TOOL_CAPABLE_PREFIXES = ["llama3.1", "llama3.2", "llama3.3", "qwen2.5", "mistral"];

/** Returns true if the Ollama model id supports tool calling. */
export function isToolCapable(modelId: string | null): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return TOOL_CAPABLE_PREFIXES.some((p) => lower.startsWith(p));
}

/** Suggest a small tool-capable default when the current model isn't. */
export const RECOMMENDED_TOOL_MODEL = "llama3.2:3b";

interface OllamaTagsResponse {
  models?: { name: string; size?: number; modified_at?: string }[];
}

interface OllamaPullChunk {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export interface ModelManager {
  ollamaRunning: boolean;
  checking: boolean;
  installedModels: string[];
  activeModel: string | null;
  downloadProgress: Map<string, number>;
  errorByModel: Map<string, string>;
  refreshInstalled: () => Promise<void>;
  pullModel: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  setActiveModel: (id: string) => void;
  cancelPull: (id: string) => void;
}

export function useModelManager(): ModelManager {
  const [ollamaRunning, setOllamaRunning] = useState(false);
  const [checking, setChecking] = useState(true);
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [activeModel, setActiveModelState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_MODEL_KEY);
    } catch {
      return null;
    }
  });
  const [downloadProgress, setDownloadProgress] = useState<Map<string, number>>(new Map());
  const [errorByModel, setErrorByModel] = useState<Map<string, string>>(new Map());

  const abortersRef = useRef<Map<string, AbortController>>(new Map());

  const refreshInstalled = useCallback(async () => {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!res.ok) throw new Error("Ollama not reachable");
      const data = (await res.json()) as OllamaTagsResponse;
      const names = (data.models ?? []).map((m) => m.name);
      setInstalledModels(names);
      setOllamaRunning(true);
    } catch {
      setOllamaRunning(false);
      setInstalledModels([]);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshInstalled();
    const interval = setInterval(() => {
      void refreshInstalled();
    }, 15000);
    return () => {
      clearInterval(interval);
    };
  }, [refreshInstalled]);

  const setActiveModel = useCallback((id: string) => {
    setActiveModelState(id);
    try {
      localStorage.setItem(ACTIVE_MODEL_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const setError = useCallback((id: string, msg: string | null) => {
    setErrorByModel((prev) => {
      const next = new Map(prev);
      if (msg === null) next.delete(id);
      else next.set(id, msg);
      return next;
    });
  }, []);

  const setProgress = useCallback((id: string, pct: number | null) => {
    setDownloadProgress((prev) => {
      const next = new Map(prev);
      if (pct === null) next.delete(id);
      else next.set(id, pct);
      return next;
    });
  }, []);

  const pullModel = useCallback(
    async (id: string) => {
      setError(id, null);
      setProgress(id, 0);
      const abort = new AbortController();
      abortersRef.current.set(id, abort);
      try {
        const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: id, stream: true }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Pull failed (${String(res.status)})`);
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
              const j = JSON.parse(line) as OllamaPullChunk;
              if (j.error) throw new Error(j.error);
              if (j.total && j.completed) {
                setProgress(id, Math.min(100, Math.round((j.completed / j.total) * 100)));
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
        setProgress(id, 100);
        await refreshInstalled();
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") {
          setError(id, e instanceof Error ? e.message : String(e));
        }
      } finally {
        abortersRef.current.delete(id);
        // Clear progress after a short delay so UI shows "100%" briefly
        setTimeout(() => {
          setProgress(id, null);
        }, 800);
      }
    },
    [refreshInstalled, setError, setProgress],
  );

  const cancelPull = useCallback((id: string) => {
    const c = abortersRef.current.get(id);
    c?.abort();
    abortersRef.current.delete(id);
  }, []);

  const deleteModel = useCallback(
    async (id: string) => {
      setError(id, null);
      try {
        const res = await fetch(`${OLLAMA_BASE}/api/delete`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: id }),
        });
        if (!res.ok) throw new Error(`Delete failed (${String(res.status)})`);
        if (activeModel === id) {
          setActiveModelState(null);
          try {
            localStorage.removeItem(ACTIVE_MODEL_KEY);
          } catch {
            /* ignore */
          }
        }
        await refreshInstalled();
      } catch (e) {
        setError(id, e instanceof Error ? e.message : String(e));
      }
    },
    [activeModel, refreshInstalled, setError],
  );

  return {
    ollamaRunning,
    checking,
    installedModels,
    activeModel,
    downloadProgress,
    errorByModel,
    refreshInstalled,
    pullModel,
    deleteModel,
    setActiveModel,
    cancelPull,
  };
}
