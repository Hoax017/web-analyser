import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { onEvent } from "@/lib/tauri";
import type { EventMap, EventName } from "@/types/ipc";

/** Subscribes to a typed Tauri event for the lifetime of the component. */
export function useTauriEvent<K extends EventName>(name: K, handler: (payload: EventMap[K]) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    onEvent(name, (payload) => handlerRef.current(payload))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error: unknown) => console.error(`listen(${name})`, error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name]);
}
