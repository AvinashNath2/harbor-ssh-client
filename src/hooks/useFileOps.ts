import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { createFolder, deletePath, renamePath, writeFileText } from "../api";
import type { useTransferQueue } from "./useTransferQueue";

type Queue = ReturnType<typeof useTransferQueue>;
type LogFn = (action: string, details: string) => void;

export function useFileOps(
  currentPath: string,
  onRefresh: () => void,
  queue: Queue,
  onLog?: LogFn,
) {
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  function clearError() {
    setOpError(null);
  }

  async function handleCreateFolder(name: string) {
    const fullPath = currentPath.replace(/\/$/, "") + "/" + name;
    setOpError(null);
    setBusy(true);
    try {
      await createFolder(fullPath);
      onLog?.("create folder", fullPath);
      onRefresh();
    } catch (e) {
      const msg = extractMsg(e);
      setOpError(msg);
      onLog?.("create folder failed", `${fullPath} — ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFile(name: string) {
    const fullPath = currentPath.replace(/\/$/, "") + "/" + name;
    setOpError(null);
    setBusy(true);
    try {
      // write_file_text overwrites if exists; use empty content to create an
      // empty file.
      await writeFileText(fullPath, "");
      onLog?.("create file", fullPath);
      onRefresh();
    } catch (e) {
      const msg = extractMsg(e);
      setOpError(msg);
      onLog?.("create file failed", `${fullPath} — ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePaths(paths: string[]) {
    if (paths.length === 0) return;
    setOpError(null);
    setBusy(true);
    try {
      for (const p of paths) {
        await deletePath(p);
        onLog?.("delete", p);
      }
      onRefresh();
    } catch (e) {
      const msg = extractMsg(e);
      setOpError(msg);
      onLog?.("delete failed", `${paths.join(", ")} — ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(oldPath: string, newName: string) {
    const dir = oldPath.substring(0, oldPath.lastIndexOf("/")) || "/";
    const newPath = dir === "/" ? "/" + newName : dir + "/" + newName;
    setOpError(null);
    setBusy(true);
    try {
      await renamePath(oldPath, newPath);
      onLog?.("rename", `${oldPath} → ${newPath}`);
      onRefresh();
    } catch (e) {
      const msg = extractMsg(e);
      setOpError(msg);
      onLog?.("rename failed", `${oldPath} → ${newPath} — ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    setOpError(null);
    const picked = await openDialog({ multiple: true });
    if (!picked) return;
    const localPaths = Array.isArray(picked) ? picked : [picked];
    if (localPaths.length === 0) return;

    for (const lp of localPaths) {
      const name = lp.split(/[/\\]/).pop() ?? "file";
      const remotePath = currentPath.replace(/\/$/, "") + "/" + name;
      queue.enqueueUpload(lp, remotePath, name);
      onLog?.("upload queued", `${lp} → ${remotePath}`);
    }
  }

  async function handleDownload(remotePaths: string[]) {
    if (remotePaths.length === 0) return;
    setOpError(null);

    if (remotePaths.length === 1) {
      const name = remotePaths[0].split("/").pop() ?? "file";
      const dest = await saveDialog({ defaultPath: name });
      if (!dest) return;
      queue.enqueueDownload(remotePaths[0], dest, name);
      onLog?.("download queued", `${remotePaths[0]} → ${dest}`);
    } else {
      const dir = await openDialog({ directory: true });
      if (!dir || typeof dir !== "string") return;
      for (const rp of remotePaths) {
        const name = rp.split("/").pop() ?? "file";
        queue.enqueueDownload(rp, dir + "/" + name, name);
        onLog?.("download queued", `${rp} → ${dir}/${name}`);
      }
    }
  }

  return {
    busy,
    opError,
    clearError,
    createFolder: handleCreateFolder,
    createFile: handleCreateFile,
    deletePaths: handleDeletePaths,
    rename: handleRename,
    upload: handleUpload,
    download: handleDownload,
  };
}

function extractMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  if (e instanceof Error) return e.message;
  return String(e);
}
