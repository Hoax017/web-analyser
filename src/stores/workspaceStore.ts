import { create } from "zustand";

import type { ProjectId, RequestId } from "@/types/domain";

const GRAPH_SEARCH_KEY = "web-analyser.graph-search-filter";

export type WorkspaceView = { kind: "graph" } | { kind: "request"; requestId: RequestId };

interface WorkspaceStore {
  projectId: ProjectId | null;
  view: WorkspaceView;
  /** Group key of the request shown in the detail view (highlights its stack in the list). */
  selectedGroup: string | null;
  /** When true, graph nodes not matching the global search are hidden. */
  graphSearchFilter: boolean;
  setGraphSearchFilter: (enabled: boolean) => void;
  enter: (projectId: ProjectId) => void;
  openRequest: (requestId: RequestId) => void;
  setSelectedGroup: (key: string | null) => void;
  showGraph: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  projectId: null,
  view: { kind: "graph" },
  selectedGroup: null,
  graphSearchFilter: localStorage.getItem(GRAPH_SEARCH_KEY) === "1",
  setGraphSearchFilter: (graphSearchFilter) => {
    localStorage.setItem(GRAPH_SEARCH_KEY, graphSearchFilter ? "1" : "0");
    set({ graphSearchFilter });
  },
  enter: (projectId) => set({ projectId, view: { kind: "graph" }, selectedGroup: null }),
  openRequest: (requestId) => set({ view: { kind: "request", requestId } }),
  setSelectedGroup: (selectedGroup) => set({ selectedGroup }),
  showGraph: () => set({ view: { kind: "graph" }, selectedGroup: null }),
}));
