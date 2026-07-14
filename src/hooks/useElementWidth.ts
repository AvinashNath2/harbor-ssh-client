import { useEffect, useRef, useState } from "react";

/** Tracks the current width of a DOM element via ResizeObserver. */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const obs = new ResizeObserver((entries) => {
      // First entry is always the observed element.
      setWidth(entries[0].contentRect.width);
    });
    obs.observe(el);
    return () => { obs.disconnect(); };
  }, []);

  return [ref, width] as const;
}

// Note about the `entries[0]` check above: `entries` is typed as
// `ReadonlyArray<ResizeObserverEntry>` which TypeScript treats as non-empty
// even though it could technically be empty. If TS ever adds
// noUncheckedIndexedAccess the check becomes meaningful again.
