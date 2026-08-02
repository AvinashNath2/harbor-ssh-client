import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileEntry } from "../api";

export interface FolderListChunk {
  list_id: string;
  entries: FileEntry[];
  offset: number;
}

export interface FolderListDone {
  list_id: string;
  total: number;
}

export interface FolderListError {
  list_id: string;
  message: string;
}

export async function listFolderStream(path: string, listId: string): Promise<void> {
  await invoke("list_folder_stream", { path, listId });
}

export async function cancelFolderList(listId: string): Promise<void> {
  await invoke("cancel_folder_list", { listId });
}

export interface FolderListHandlers {
  onChunk: (chunk: FolderListChunk) => void;
  onDone: (total: number) => void;
  onError: (message: string) => void;
}

/** Register listeners for one list_id, then invoke the stream command. */
export async function startFolderListStream(
  path: string,
  listId: string,
  handlers: FolderListHandlers,
): Promise<UnlistenFn> {
  const unsubs: UnlistenFn[] = [];

  unsubs.push(
    await listen<FolderListChunk>("folder-list-chunk", (event) => {
      if (event.payload.list_id === listId) handlers.onChunk(event.payload);
    }),
  );
  unsubs.push(
    await listen<FolderListDone>("folder-list-done", (event) => {
      if (event.payload.list_id === listId) handlers.onDone(event.payload.total);
    }),
  );
  unsubs.push(
    await listen<FolderListError>("folder-list-error", (event) => {
      if (event.payload.list_id === listId) handlers.onError(event.payload.message);
    }),
  );

  void listFolderStream(path, listId).catch((err: unknown) => {
    handlers.onError(extractMessage(err));
  });

  return () => {
    for (const fn of unsubs) fn();
  };
}

function extractMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return (err as { message: string }).message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
