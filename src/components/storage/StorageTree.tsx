import { ChevronDown, ChevronRight, Folder, Loader2 } from "lucide-react";
import { memo } from "react";
import type { TreeNode } from "../../hooks/useStorageAnalyzer";
import { formatBytes } from "../../utils/storageHealth";

interface StorageTreeProps {
  root: TreeNode;
  totalBytes: number;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
  depth?: number;
}

export const StorageTree = memo(function StorageTree({
  root,
  totalBytes,
  onExpand,
  onCollapse,
  depth = 0,
}: StorageTreeProps) {
  return (
    <div>
      <TreeRow
        node={root}
        totalBytes={totalBytes}
        onExpand={onExpand}
        onCollapse={onCollapse}
        depth={depth}
      />
      {root.expanded && root.children && root.children.length > 0 && (
        <div>
          {root.children.map((child) => (
            <StorageTree
              key={child.path}
              root={child}
              totalBytes={totalBytes}
              onExpand={onExpand}
              onCollapse={onCollapse}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});

interface TreeRowProps {
  node: TreeNode;
  totalBytes: number;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
  depth: number;
}

function TreeRow({ node, totalBytes, onExpand, onCollapse, depth }: TreeRowProps) {
  const hasUnloadedChildren = node.children === null;
  const hasLoadedChildren = node.children !== null && node.children.length > 0;
  const isExpandable = hasUnloadedChildren || hasLoadedChildren;
  const pct = totalBytes > 0 ? (node.size_bytes / totalBytes) * 100 : 0;

  // Color by share of total disk
  const barColor =
    pct > 40 ? "#ef4444" : pct > 15 ? "#f97316" : pct > 5 ? "#f59e0b" : "#3f7be0";

  function handleToggle() {
    if (node.loading) return;
    if (node.expanded) {
      onCollapse(node.path);
    } else {
      onExpand(node.path);
    }
  }

  return (
    <div
      className="group flex items-center gap-2 border-b py-1.5 pr-4 transition-colors hover:bg-surface-chip"
      style={{
        paddingLeft: 12 + depth * 20,
        borderColor: "#e5e2db",
      }}
    >
      {/* Expand toggle */}
      <button
        onClick={handleToggle}
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:text-text-primary"
        style={{ visibility: isExpandable ? "visible" : "hidden" }}
      >
        {node.loading ? (
          <Loader2 size={12} className="animate-spin text-[#3f7be0]" />
        ) : node.expanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
      </button>

      {/* Folder icon */}
      <Folder
        size={14}
        className="flex-shrink-0"
        style={{ color: node.expanded ? "#3f7be0" : "#9c9790" }}
      />

      {/* Name */}
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">
        {node.name}
      </span>

      {/* Usage bar */}
      <div className="flex w-24 items-center gap-1.5 flex-shrink-0">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-chip">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(pct, 100).toFixed(2)}%`, background: barColor }}
          />
        </div>
        <span className="w-8 text-right text-[10.5px] tabular-nums text-text-faint">
          {pct.toFixed(0)}%
        </span>
      </div>

      {/* Size */}
      <span className="w-20 flex-shrink-0 text-right font-mono text-[12px] text-text-secondary">
        {formatBytes(node.size_bytes)}
      </span>
    </div>
  );
}
