import { memo, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { Loader2, Pin } from "lucide-react";

import { graphApi } from "@/api";
import { MethodLabel, StatusBadge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { formatTime } from "@/lib/format";
import { errorMessage } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useGraphStore } from "@/stores/graphStore";
import { useRequestListStore } from "@/stores/requestListStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { requestGroupKey, type RequestGroup } from "@/types/domain";

const ROW_HEIGHT = 70;
/** Vertical/horizontal offset of each card drawn behind a stack. */
const STACK_OFFSET = 3;
/** Start fetching the next page when this close to the end of loaded rows. */
const PREFETCH_THRESHOLD = 40;

/**
 * Virtualized, infinitely scrolling list: only visible rows are mounted and
 * only lightweight summaries are kept in memory.
 */
export function RequestList() {
  const { items, total, loading, error, query, loadMore } = useRequestListStore(
    useShallow((s) => ({
      items: s.items,
      total: s.total,
      loading: s.loading,
      error: s.error,
      query: s.query,
      loadMore: s.loadMore,
    })),
  );
  const selectedId = useWorkspaceStore((s) => (s.view.kind === "request" ? s.view.requestId : null));
  const selectedGroup = useWorkspaceStore((s) => s.selectedGroup);
  const scrollRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally not memoized.
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVisible = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (lastVisible >= items.length - PREFETCH_THRESHOLD) void loadMore();
  }, [lastVisible, items.length, loadMore]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{query ? `${total} résultat(s)` : `${total} requête(s) distincte(s)`}</span>
        {loading && <Loader2 className="size-3.5 animate-spin" />}
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((row) => {
            const group = items[row.index];
            if (!group) return null;
            const key = requestGroupKey(group);
            return (
              <div
                key={key}
                className="absolute left-0 top-0 w-full px-2 pb-1 pt-2.5"
                style={{ height: row.size, transform: `translateY(${row.start}px)` }}
              >
                <RequestListItem group={group} selected={selectedGroup === null ? group.id === selectedId : key === selectedGroup} />
              </div>
            );
          })}
        </div>
        {!loading && items.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {query ? "Aucune requête ne correspond à la recherche." : "Aucune requête capturée."}
          </p>
        )}
      </div>
    </div>
  );
}

const RequestListItem = memo(function RequestListItem({
  group,
  selected,
}: {
  group: RequestGroup;
  selected: boolean;
}) {
  const openRequest = useWorkspaceStore((s) => s.openRequest);
  // Latest occurrence: clicking opens it, tabs in the detail view list the others.
  const request = group;
  const depth = Math.min(group.count - 1, 2);

  const pin = async () => {
    try {
      await graphApi.pin(request.projectId, request.id);
      useGraphStore.getState().pin(request);
      toast.success("Requête ajoutée au graphique");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  };

  return (
    // Space for two stacked layers is always reserved so that every row lines up.
    <div className="relative h-full" style={{ paddingRight: STACK_OFFSET * 2, paddingBottom: STACK_OFFSET * 2 }}>
      {Array.from({ length: depth }, (_, i) => {
        const shift = (depth - i) * STACK_OFFSET;
        return (
          <div
            key={shift}
            aria-hidden
            className="absolute rounded-md border border-border bg-card"
            style={{ left: shift, top: shift, right: STACK_OFFSET * 2 - shift, bottom: STACK_OFFSET * 2 - shift }}
          />
        );
      })}
      <div
        role="button"
        tabIndex={0}
        onClick={() => openRequest(request.id)}
        onKeyDown={(e) => e.key === "Enter" && openRequest(request.id)}
        title={group.count > 1 ? `${request.url}\n${group.count} occurrences` : request.url}
        className={cn(
          "group relative flex h-full cursor-pointer flex-col justify-center gap-1 rounded-md border px-3 transition-colors",
          selected ? "border-primary bg-accent" : "border-border bg-card hover:bg-accent",
        )}
      >
        <div className="flex items-center gap-2">
          <MethodLabel method={request.method} />
          <span className="min-w-0 flex-1 truncate font-mono text-sm">{request.path || "/"}</span>
          <StatusBadge status={request.status} failed={request.failed} />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{request.host}</span>
          <span className="tabular-nums">{formatTime(request.startedAt)}</span>
          <button
            type="button"
            aria-label="Ajouter au graphique"
            title="Ajouter au graphique"
            onClick={(e) => {
              e.stopPropagation();
              void pin();
            }}
            className="opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <Pin className="size-3.5" />
          </button>
        </div>
        {group.count > 1 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-primary px-1.5 text-center text-[10px] font-semibold leading-5 text-primary-foreground tabular-nums shadow">
            {group.count > 999 ? "999+" : group.count}
          </span>
        )}
      </div>
    </div>
  );
});
