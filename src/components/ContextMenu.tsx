import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: y, left: x, zIndex: 9999 }}
      className="min-w-[160px] rounded-[10px] border border-border-raised bg-surface-pane py-1 shadow-[0_4px_24px_rgba(0,0,0,0.14)]"
    >
      {items.map((item, i) =>
        item.label === "---" ? (
          <div key={i} className="my-1 border-t border-border-subtle" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-[6px] text-left text-[12.5px] transition-colors ${
              item.disabled
                ? "cursor-not-allowed text-text-faint"
                : item.danger
                  ? "text-danger hover:bg-red-50"
                  : "text-text-primary hover:bg-surface-hover"
            }`}
          >
            {item.icon != null && (
              <span className="flex w-4 flex-shrink-0 items-center justify-center">{item.icon}</span>
            )}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
