import { useCallback, useEffect, useRef, useState } from "react";

type Axis = "x" | "y";

interface Options {
  min: number;
  max: number;
  /** Set to "invert" if dragging in the positive direction should DECREASE the size
   *  (e.g. resizing the terminal by dragging its TOP edge downward shrinks it). */
  invert?: boolean;
  /** localStorage key to persist the size. If omitted, size is in-memory only. */
  persistKey?: string;
}

/**
 * Generic resizable-panel hook.
 *
 * Returns `[size, startDrag]`. Wire `startDrag` to a divider element's `onMouseDown`.
 * The hook takes over the document during the drag and stops on mouseup.
 */
export function useResizable(
  initial: number,
  axis: Axis,
  { min, max, invert, persistKey }: Options,
): [number, (e: React.MouseEvent) => void] {
  const [size, setSize] = useState<number>(() => {
    if (!persistKey) return initial;
    try {
      const raw = localStorage.getItem(persistKey);
      if (!raw) return initial;
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed)) return initial;
      return Math.max(min, Math.min(max, parsed));
    } catch {
      return initial;
    }
  });

  // Persist size (debounced by React batching — good enough).
  useEffect(() => {
    if (!persistKey) return;
    try {
      localStorage.setItem(persistKey, size.toString());
    } catch {
      /* ignore */
    }
  }, [persistKey, size]);

  const dragStateRef = useRef<{ startPos: number; startSize: number } | null>(null);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStateRef.current = {
        startPos: axis === "x" ? e.clientX : e.clientY,
        startSize: size,
      };

      const onMove = (ev: MouseEvent) => {
        const state = dragStateRef.current;
        if (!state) return;
        const now = axis === "x" ? ev.clientX : ev.clientY;
        let delta = now - state.startPos;
        if (invert) delta = -delta;
        const next = Math.max(min, Math.min(max, state.startSize + delta));
        setSize(next);
      };

      const onUp = () => {
        dragStateRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis, invert, min, max, size],
  );

  return [size, startDrag];
}
