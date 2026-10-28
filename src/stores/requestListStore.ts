import { create } from "zustand";

import { requestsApi } from "@/api";
import { errorMessage } from "@/lib/tauri";
import { requestGroupKey, type ProjectId, type RequestGroup, type RequestSummary } from "@/types/domain";

export const PAGE_SIZE = 200;

interface RequestListStore {
  projectId: ProjectId | null;
  query: string;
  /** Grouped summaries only (bodies are fetched on demand) to keep memory low. */
  items: RequestGroup[];
  /** Group key -> index in `items`, to merge live occurrences in O(1). */
  indexByKey: Map<string, number>;
  /** Number of groups on the server. */
  total: number;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  /** Incremented on reset so that stale page responses are discarded. */
  generation: number;

  reset: (projectId: ProjectId) => void;
  setQuery: (query: string) => void;
  loadMore: () => Promise<void>;
  appendLive: (requests: RequestSummary[]) => void;
}

const emptyList = {
  items: [],
  indexByKey: new Map<string, number>(),
  total: 0,
  loading: false,
  initialized: false,
  error: null,
} satisfies Partial<RequestListStore>;

export const useRequestListStore = create<RequestListStore>((set, get) => ({
  projectId: null,
  query: "",
  ...emptyList,
  generation: 0,

  reset: (projectId) => {
    set((s) => ({ ...emptyList, indexByKey: new Map(), projectId, query: "", generation: s.generation + 1 }));
    void get().loadMore();
  },

  setQuery: (query) => {
    set((s) => ({ ...emptyList, indexByKey: new Map(), query, generation: s.generation + 1 }));
    void get().loadMore();
  },

  loadMore: async () => {
    const { projectId, query, items, total, loading, initialized, generation } = get();
    if (projectId === null || loading || (initialized && items.length >= total)) return;
    set({ loading: true });
    try {
      const page = await requestsApi.list(projectId, query.trim() || null, items.length, PAGE_SIZE);
      if (get().generation !== generation) return;
      set((s) => {
        const indexByKey = new Map(s.indexByKey);
        const merged = [...s.items];
        for (const group of page.items) {
          const key = requestGroupKey(group);
          // A live occurrence may already have created this group locally.
          const existing = indexByKey.get(key);
          if (existing === undefined) {
            indexByKey.set(key, merged.length);
            merged.push(group);
          } else {
            merged[existing] = group;
          }
        }
        return { items: merged, indexByKey, total: page.total, initialized: true, loading: false, error: null };
      });
    } catch (error: unknown) {
      if (get().generation !== generation) return;
      set({ loading: false, error: errorMessage(error) });
    }
  },

  appendLive: (requests) => {
    const { query, initialized, projectId } = get();
    const own = requests.filter((r) => r.projectId === projectId);
    // While searching, live rows may not match the filter: skip them.
    if (own.length === 0 || query.trim() !== "" || !initialized) return;
    set((s) => {
      const items = [...s.items];
      let indexByKey = s.indexByKey;
      let total = s.total;
      const fullyLoaded = s.items.length >= s.total;
      for (const request of own) {
        const key = requestGroupKey(request);
        const index = indexByKey.get(key);
        const current = index === undefined ? undefined : items[index];
        if (index !== undefined && current) {
          // Same request again: bump the stack instead of adding a row.
          items[index] = { ...request, count: current.count + 1 };
        } else if (fullyLoaded) {
          // New groups always sort last (ordered by first occurrence).
          if (indexByKey === s.indexByKey) indexByKey = new Map(indexByKey);
          indexByKey.set(key, items.length);
          items.push({ ...request, count: 1 });
          total += 1;
        }
        // Otherwise the group lives in a page not loaded yet: paging will fetch it.
      }
      return { items, indexByKey, total };
    });
  },
}));
