import { create } from "zustand";

import { graphApi } from "@/api";
import type {
  ExchangeEvent,
  GraphData,
  Link,
  LinkId,
  ProjectId,
  RequestId,
  RequestSummary,
} from "@/types/domain";

export interface XY {
  x: number;
  y: number;
}

export type LinkEditorState =
  | { mode: "create"; sourceRequestId: RequestId | null; targetRequestId: RequestId }
  | { mode: "edit"; link: Link };

interface GraphStore {
  projectId: ProjectId | null;
  requests: ReadonlyMap<RequestId, RequestSummary>;
  links: ReadonlyMap<LinkId, Link>;
  /** Pinned / manually placed nodes. `null` = pinned without fixed position. */
  positions: ReadonlyMap<string, XY | null>;
  loading: boolean;
  editor: LinkEditorState | null;

  load: (projectId: ProjectId) => Promise<void>;
  applyGraph: (data: GraphData) => void;
  applyExchanges: (events: ExchangeEvent[]) => void;
  upsertLink: (link: Link, requests?: RequestSummary[]) => void;
  removeLink: (linkId: LinkId) => void;
  pin: (request: RequestSummary) => void;
  unpin: (requestId: RequestId) => void;
  setPosition: (nodeKey: string, position: XY) => void;
  setPositions: (entries: Iterable<[string, XY]>) => void;
  openEditor: (state: LinkEditorState) => void;
  closeEditor: () => void;
}

export const USER_NODE_ID = "user";
export const requestNodeId = (id: RequestId): string => `req:${id}`;

export function parseNodeId(nodeId: string): { kind: "user" } | { kind: "request"; id: RequestId } | null {
  if (nodeId === USER_NODE_ID) return { kind: "user" };
  const match = /^req:(\d+)$/.exec(nodeId);
  return match?.[1] ? { kind: "request", id: Number(match[1]) } : null;
}

function withRequests(
  map: ReadonlyMap<RequestId, RequestSummary>,
  requests: readonly RequestSummary[],
): Map<RequestId, RequestSummary> {
  const next = new Map(map);
  for (const r of requests) next.set(r.id, r);
  return next;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  projectId: null,
  requests: new Map(),
  links: new Map(),
  positions: new Map(),
  loading: false,
  editor: null,

  load: async (projectId) => {
    set({ projectId, loading: true, requests: new Map(), links: new Map(), positions: new Map(), editor: null });
    try {
      const data = await graphApi.get(projectId);
      if (get().projectId === projectId) get().applyGraph(data);
    } finally {
      if (get().projectId === projectId) set({ loading: false });
    }
  },

  applyGraph: (data) =>
    set({
      requests: new Map(data.requests.map((r) => [r.id, r])),
      links: new Map(data.links.map((l) => [l.id, l])),
      positions: new Map(
        data.positions.map((p) => [p.nodeKey, p.x !== null && p.y !== null ? { x: p.x, y: p.y } : null]),
      ),
    }),

  applyExchanges: (events) => {
    const own = events.filter((e) => e.projectId === get().projectId && e.links.length > 0);
    if (own.length === 0) return;
    set((s) => {
      const links = new Map(s.links);
      const incoming: RequestSummary[] = [];
      for (const e of own) {
        incoming.push(e.request, ...e.related);
        for (const l of e.links) links.set(l.id, l);
      }
      return { links, requests: withRequests(s.requests, incoming) };
    });
  },

  upsertLink: (link, requests = []) =>
    set((s) => ({
      links: new Map(s.links).set(link.id, link),
      requests: withRequests(s.requests, requests),
    })),

  removeLink: (linkId) =>
    set((s) => {
      const links = new Map(s.links);
      links.delete(linkId);
      return { links };
    }),

  pin: (request) =>
    set((s) => {
      const key = requestNodeId(request.id);
      const positions = new Map(s.positions);
      if (!positions.has(key)) positions.set(key, null);
      return { positions, requests: withRequests(s.requests, [request]) };
    }),

  unpin: (requestId) =>
    set((s) => {
      const positions = new Map(s.positions);
      positions.delete(requestNodeId(requestId));
      return { positions };
    }),

  setPosition: (nodeKey, position) =>
    set((s) => ({ positions: new Map(s.positions).set(nodeKey, position) })),

  setPositions: (entries) =>
    set((s) => {
      const positions = new Map(s.positions);
      for (const [key, xy] of entries) positions.set(key, xy);
      return { positions };
    }),

  openEditor: (editor) => set({ editor }),
  closeEditor: () => set({ editor: null }),
}));
