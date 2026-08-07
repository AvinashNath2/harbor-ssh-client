import { Download, FileWarning } from "lucide-react";
import type { FileEntry } from "../api";

export type UnviewableReason = "binary" | "encoding";

interface Props {
  entry: FileEntry;
  reason: UnviewableReason;
  onDownload: () => void;
}

function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const SUBTITLE: Record<UnviewableReason, string> = {
  binary: "This looks like a binary file — executable, archive, image or similar.",
  encoding: "The file's contents aren't valid UTF-8 text, so a text preview would be gibberish.",
};

export function UnviewableFileCard({ entry, reason, onDownload }: Props) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        className="max-w-md rounded-modal border border-border-raised bg-surface-pane p-6 text-center"
        style={{ boxShadow: "0 12px 40px -12px rgba(20,18,15,0.30)" }}
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-chip text-text-faint">
          <FileWarning size={26} strokeWidth={1.8} />
        </div>
        <h2 className="mb-1.5 text-[15px] font-semibold text-text-primary">
          This file can&rsquo;t be previewed
        </h2>
        <p className="mb-5 text-[12.5px] leading-relaxed text-text-secondary">{SUBTITLE[reason]}</p>
        <div className="mb-5 rounded-[8px] bg-surface-chip px-3 py-2 text-left font-mono text-[11.5px] text-text-tertiary">
          <div className="truncate">{entry.name}</div>
          <div className="mt-0.5 text-text-faint">{fmtSize(entry.size)}</div>
        </div>
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 rounded-input px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
        >
          <Download size={12} strokeWidth={2.2} />
          Download to open locally
        </button>
      </div>
    </div>
  );
}
