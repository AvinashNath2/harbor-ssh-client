import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Standard dropdown menu used across the main toolbar / nav.
 *
 * Design goals:
 * - Trigger button matches the app's other toolbar buttons (subtle border,
 *   muted-grey text; on hover / open, switches to the accent tint used by the
 *   toggle buttons — not a saturated blue pill).
 * - Menu panel rendered through a portal so it escapes any `overflow: hidden`
 *   ancestor. Positioned with `getBoundingClientRect()` relative to the
 *   trigger; re-measured on scroll / resize while open.
 * - Compact items: 12 px icon left, 12 px label, tight vertical rhythm.
 * - Keyboard: Enter/Space to open, Esc to close, ↑ / ↓ to move highlight,
 *   Enter to activate. Focus returns to the trigger on close.
 * - Click-outside-to-close (checks both the trigger and the portalled panel).
 */

export interface MenuItem {
  /** 12 px icon rendered before the label. Optional. */
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Renders in the item's right slot — e.g. keyboard shortcut hint. */
  shortcut?: string;
}

export interface MenuProps {
  /** Trigger label shown next to the icon. */
  label: string;
  /** Optional icon rendered on the left of the trigger. */
  icon?: ReactNode;
  /** Tooltip text for the trigger. */
  title?: string;
  items: MenuItem[];
  /** Which edge of the trigger the panel aligns to. Default "right". */
  align?: "left" | "right";
  /** Extra classes appended to the trigger. Rarely needed. */
  triggerClassName?: string;
}

export function Menu({
  label,
  icon,
  title,
  items,
  align = "right",
  triggerClassName = "",
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus onto the panel when it opens so arrow keys can drive the menu.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Recompute the portalled panel's position from the trigger's rect.
  // Runs on open, and on scroll / resize while open. useLayoutEffect avoids a
  // visible flash at wrong coords.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function measure() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const top = rect.bottom + 4;
      if (align === "right") {
        setPos({ top, right: window.innerWidth - rect.right });
      } else {
        setPos({ top, left: rect.left });
      }
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, align]);

  // Reset highlight to the first enabled item every time the menu opens.
  useEffect(() => {
    if (!open) return;
    const first = items.findIndex((it) => !it.disabled);
    setHighlight(first === -1 ? 0 : first);
  }, [open, items]);

  // Click outside → close. Checks both the trigger and the portalled panel.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Global Esc handler while open — always closes, even when focus is inside
  // one of the items rather than the trigger.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const nextEnabled = useCallback(
    (from: number, step: 1 | -1): number => {
      if (items.length === 0) return 0;
      let i = from;
      for (const _ of items) {
        void _;
        i = (i + step + items.length) % items.length;
        if (!items[i]?.disabled) return i;
      }
      return from;
    },
    [items],
  );

  function handlePanelKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => nextEnabled(h, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => nextEnabled(h, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const it = items[highlight];
      if (!it.disabled) {
        setOpen(false);
        it.onClick();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(nextEnabled(-1, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(nextEnabled(0, -1));
    }
  }

  function handleTriggerKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        onKeyDown={handleTriggerKey}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className={`flex items-center gap-1.5 rounded-input border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
          open
            ? "border-border-input bg-accent/[0.12] text-accent-dark"
            : "border-border-input bg-surface-chip text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        } ${triggerClassName}`}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {label}
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            tabIndex={-1}
            onKeyDown={handlePanelKey}
            className="fixed z-[100] min-w-[200px] overflow-hidden rounded-input border border-border-raised bg-surface-pane py-1"
            style={{
              top: pos.top,
              ...(pos.left !== undefined ? { left: pos.left } : {}),
              ...(pos.right !== undefined ? { right: pos.right } : {}),
              boxShadow: "0 8px 24px -8px rgba(20,18,15,0.20)",
            }}
          >
            {items.map((item, idx) => (
              <MenuRow
                key={`${item.label}-${idx.toString()}`}
                item={item}
                highlighted={idx === highlight}
                onHover={() => {
                  if (!item.disabled) setHighlight(idx);
                }}
                onSelect={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onClick();
                }}
              />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuRow({
  item,
  highlighted,
  onHover,
  onSelect,
}: {
  item: MenuItem;
  highlighted: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[11.5px] transition-colors disabled:opacity-40 ${
        highlighted && !item.disabled
          ? "bg-surface-hover text-text-primary"
          : "text-text-primary hover:bg-surface-hover"
      }`}
    >
      {item.icon && <span className="flex-shrink-0 text-text-tertiary">{item.icon}</span>}
      <span className="flex-1 truncate">{item.label}</span>
      {item.shortcut && (
        <span className="ml-2 flex-shrink-0 font-mono text-[10px] text-text-faint">
          {item.shortcut}
        </span>
      )}
    </button>
  );
}
