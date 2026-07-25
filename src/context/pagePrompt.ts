import type { PageContextValue } from "./PageContext";

/**
 * Build a system prompt for the LLM based on live page context.
 * Called on every message so the model sees the *current* state.
 */
export function buildSystemPrompt(ctx: PageContextValue): string {
  const base = `You are an expert infrastructure and DevOps assistant embedded in HarborSCP, a secure SSH desktop application. Give concise, practical answers (under 150 words unless the user asks for more detail).

When suggesting shell commands, always wrap them in \`\`\`bash code blocks — the user can run them directly in the terminal with one click. Prefer safe, read-only commands when possible.`;

  if (ctx.currentPage === "terminal" && ctx.terminal) {
    const lastOut = ctx.terminal.lastOutputLines.slice(-20).join("\n");
    return `${base}

CURRENT CONTEXT — Terminal:
Host: ${ctx.terminal.connectedHost}
Working directory: ${ctx.terminal.cwd || "unknown"}
Last command: ${ctx.terminal.lastCommand || "(none yet)"}
Recent output:
${lastOut || "(empty)"}`;
  }

  if (ctx.currentPage === "docker" && ctx.docker) {
    let selected = "No node selected.";
    if (ctx.docker.selectedNodeJson) {
      try {
        const parsed: unknown = JSON.parse(ctx.docker.selectedNodeJson);
        selected = `Selected ${ctx.docker.selectedNodeType ?? "node"}:\n${JSON.stringify(parsed, null, 2)}`;
      } catch {
        selected = `Selected node: ${ctx.docker.selectedNodeJson}`;
      }
    }
    return `${base}

CURRENT CONTEXT — Docker Dashboard:
Host: ${ctx.terminal?.connectedHost ?? "unknown"}
Containers: ${String(ctx.docker.containerCount)}, Networks: ${String(ctx.docker.networkCount)}, Volumes: ${String(ctx.docker.volumeCount)}
${selected}`;
  }

  if (ctx.currentPage === "files" && ctx.file) {
    return `${base}

CURRENT CONTEXT — File Explorer:
Host: ${ctx.terminal?.connectedHost ?? "unknown"}
Viewing file: ${ctx.file.filePath}`;
  }

  return base;
}
