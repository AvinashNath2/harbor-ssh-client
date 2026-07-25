/**
 * Lightweight typed event bus.
 *
 * `terminalBus` — sends shell commands from the chat panel to the active
 *  SSH terminal (writes to PTY).
 *
 * `chatBus` — sends auto-messages from any page (e.g. clicking a Docker
 *  node) into the chat panel, which appends and streams a response.
 */

interface RunCommandEvent extends Event {
  command: string;
}
interface AskChatEvent extends Event {
  message: string;
  role: "user" | "auto";
}

export const terminalBus = new EventTarget();
export const chatBus = new EventTarget();

export function sendCommandToTerminal(command: string): void {
  const evt = new Event("run-command") as RunCommandEvent;
  evt.command = command;
  terminalBus.dispatchEvent(evt);
}

export function onTerminalCommand(handler: (command: string) => void): () => void {
  const listener = (e: Event) => {
    const cmd = (e as RunCommandEvent).command;
    if (typeof cmd === "string") handler(cmd);
  };
  terminalBus.addEventListener("run-command", listener);
  return () => {
    terminalBus.removeEventListener("run-command", listener);
  };
}

export function askChat(message: string, role: "user" | "auto" = "auto"): void {
  const evt = new Event("ask-chat") as AskChatEvent;
  evt.message = message;
  evt.role = role;
  chatBus.dispatchEvent(evt);
}

export function onChatAsk(handler: (message: string, role: "user" | "auto") => void): () => void {
  const listener = (e: Event) => {
    const ev = e as AskChatEvent;
    if (typeof ev.message === "string") handler(ev.message, ev.role);
  };
  chatBus.addEventListener("ask-chat", listener);
  return () => {
    chatBus.removeEventListener("ask-chat", listener);
  };
}
