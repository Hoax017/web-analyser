import { X } from "lucide-react";
import { create } from "zustand";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

type ToastTone = "info" | "error" | "success";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const TOAST_TTL_MS = 6000;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (tone, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, tone, message }] }));
    window.setTimeout(() => get().dismiss(id), TOAST_TTL_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (message: string) => useToastStore.getState().push("info", message),
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message),
};

const TONE_CLASSES: Record<ToastTone, string> = {
  info: "border-border",
  success: "border-emerald-500/50",
  error: "border-red-500/60 text-red-300",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const closeLabel = useT().common.close;
  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-md border bg-popover p-3 text-sm shadow-lg",
            TONE_CLASSES[t.tone],
          )}
        >
          <p className="flex-1 break-words">{t.message}</p>
          <button type="button" aria-label={closeLabel} onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
