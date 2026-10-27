import { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";

import { requestsApi } from "@/api";
import { StatusBadge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { errorMessage } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useRequestListStore } from "@/stores/requestListStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { requestGroupKey, type RequestId, type RequestSummary } from "@/types/domain";

/**
 * One tab per occurrence of the same request (method + host + path), newest first.
 * Switching tab only changes the displayed request id; the list keeps a single stack.
 */
export function OccurrenceTabs({ requestId }: { requestId: RequestId }) {
  const openRequest = useWorkspaceStore((s) => s.openRequest);
  const setSelectedGroup = useWorkspaceStore((s) => s.setSelectedGroup);
  const [occurrences, setOccurrences] = useState<RequestSummary[]>([]);
  const groupKey = occurrences[0] ? requestGroupKey(occurrences[0]) : null;
  // Re-fetch when live capture adds an occurrence to this stack.
  const liveCount = useRequestListStore((s) => {
    if (groupKey === null) return 0;
    const index = s.indexByKey.get(groupKey);
    return index === undefined ? 0 : (s.items[index]?.count ?? 0);
  });
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    requestsApi
      .occurrences(requestId)
      .then((items) => {
        if (cancelled) return;
        setOccurrences(items);
        setSelectedGroup(items[0] ? requestGroupKey(items[0]) : null);
      })
      .catch((error: unknown) => !cancelled && toast.error(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [requestId, liveCount, setSelectedGroup]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [requestId, occurrences]);

  if (occurrences.length < 2 || !occurrences.some((o) => o.id === requestId)) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Layers className="size-3.5" /> {occurrences.length} occurrences
      </span>
      <div role="tablist" className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
        {[...occurrences].reverse().map((o) => {
          const active = o.id === requestId;
          return (
            <button
              key={o.id}
              ref={active ? activeRef : undefined}
              type="button"
              role="tab"
              aria-selected={active}
              title={o.url}
              onClick={() => openRequest(o.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors",
                active ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-accent/60",
              )}
            >
              {formatDate(o.startedAt)}
              <StatusBadge status={o.status} failed={o.failed} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
