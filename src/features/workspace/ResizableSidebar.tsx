import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { useT } from "@/i18n";

const STORAGE_KEY = "web-analyser.sidebar-width";
const MIN_WIDTH = 260;
const DEFAULT_WIDTH = 360;
/** The sidebar may take at most this fraction of the window width. */
const MAX_RATIO = 0.5;

function clampWidth(width: number): number {
  const max = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_RATIO));
  return Math.min(Math.max(width, MIN_WIDTH), max);
}

function initialWidth(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return clampWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_WIDTH);
}

/** Start-side sidebar with a drag handle on its end edge (260px → 50% of the window); mirrored in RTL. */
export function ResizableSidebar({ children }: { children: ReactNode }) {
  const t = useT();
  const [width, setWidth] = useState(initialWidth);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!dragging) localStorage.setItem(STORAGE_KEY, String(width));
  }, [width, dragging]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const rect = asideRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rtl = getComputedStyle(asideRef.current ?? document.documentElement).direction === "rtl";
      setWidth(clampWidth(rtl ? rect.right - e.clientX : e.clientX - rect.left));
    },
    [dragging],
  );

  const stopDragging = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  return (
    <aside ref={asideRef} className="relative shrink-0 border-e border-border" style={{ width }}>
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        title={t.sidebar.resize}
        className={`absolute inset-y-0 -end-1 z-20 w-2 cursor-col-resize transition-colors hover:bg-primary/40 ${dragging ? "bg-primary/60" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onDoubleClick={() => setWidth(clampWidth(DEFAULT_WIDTH))}
      />
      {dragging && <div className="fixed inset-0 z-10 cursor-col-resize select-none" />}
    </aside>
  );
}
