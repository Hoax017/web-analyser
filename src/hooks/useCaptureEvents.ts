import { useEffect, useRef } from "react";

import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/tauri";
import { useCaptureStore } from "@/stores/captureStore";
import { useGraphStore } from "@/stores/graphStore";
import { useRequestListStore } from "@/stores/requestListStore";
import type { ExchangeEvent } from "@/types/domain";

import { useTauriEvent } from "./useTauriEvent";

/** Keeps the capture status store in sync with the backend (mount once at app root). */
export function useCaptureStatusSync(): void {
  const setStatus = useCaptureStore((s) => s.setStatus);
  const refresh = useCaptureStore((s) => s.refresh);

  useEffect(() => {
    refresh().catch((error: unknown) => console.warn(errorMessage(error)));
  }, [refresh]);

  useTauriEvent("capture://status", setStatus);
  useTauriEvent("capture://error", (event) => toast.error(event.message));
}

/**
 * Streams live exchanges into the stores. Events are buffered and flushed once
 * per animation frame so that bursts of hundreds of requests cause a single render.
 */
export function useLiveExchanges(): void {
  const buffer = useRef<ExchangeEvent[]>([]);
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useTauriEvent("capture://exchange", (event) => {
    buffer.current.push(event);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const batch = buffer.current;
      buffer.current = [];
      useRequestListStore.getState().appendLive(batch.map((e) => e.request));
      useGraphStore.getState().applyExchanges(batch);
    });
  });
}
