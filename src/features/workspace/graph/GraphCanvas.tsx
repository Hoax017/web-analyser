import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type IsValidConnection,
  type NodeTypes,
  type OnNodeDrag,
} from "@xyflow/react";
import { Crosshair, Eye, GitFork, LayoutGrid, Network, Search, X } from "lucide-react";

import { graphApi, requestsApi } from "@/api";
import { toast } from "@/components/ui/toast";
import { plural, useT, type Messages } from "@/i18n";
import { errorMessage } from "@/lib/tauri";
import { parseNodeId, requestNodeId, useGraphStore } from "@/stores/graphStore";
import { useRequestListStore } from "@/stores/requestListStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { Button } from "@/components/ui/button";

import { deriveGraph, mergeNode, placeNodes } from "./buildGraph";
import { DataFlowEdge } from "./DataFlowEdge";
import { descendantsOf, radialLayout } from "./layout";
import { LinkEditorDialog } from "./LinkEditorDialog";
import { RequestNode, UserNode } from "./nodes";
import type { AppNode, DataFlowEdgeType } from "./types";

// Stable references: React Flow re-renders everything if these change.
const nodeTypes = { request: RequestNode, user: UserNode } satisfies NodeTypes;
const edgeTypes = { dataFlow: DataFlowEdge } satisfies EdgeTypes;
const DELETE_KEYS = ["Delete"];
const PRO_OPTIONS = { hideAttribution: true };
const FIT_OPTIONS = { padding: 0.2, duration: 300 };

/** Keeps node outlines visible at any zoom level (see `.graph-node-card` in index.css). */
function applyRingWidth(container: HTMLElement | null, zoom: number) {
  const width = Math.min(40, Math.max(1.5, 1.5 / zoom));
  container?.style.setProperty("--node-ring", `${width}px`);
}

interface ContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

function nodeLabel(node: AppNode | undefined, t: Messages): string {
  if (!node) return "";
  if (node.type === "user") return t.graph.user;
  return `${node.data.request.method} ${node.data.request.path}`;
}

function GraphCanvasInner() {
  const t = useT();
  const projectId = useWorkspaceStore((s) => s.projectId);
  const openRequest = useWorkspaceStore((s) => s.openRequest);
  const requests = useGraphStore((s) => s.requests);
  const links = useGraphStore((s) => s.links);
  const positions = useGraphStore((s) => s.positions);
  const loading = useGraphStore((s) => s.loading);
  const openEditor = useGraphStore((s) => s.openEditor);
  const setPosition = useGraphStore((s) => s.setPosition);
  const setPositions = useGraphStore((s) => s.setPositions);
  const removeLink = useGraphStore((s) => s.removeLink);
  const { fitView } = useReactFlow<AppNode, DataFlowEdgeType>();

  const derived = useMemo(() => deriveGraph(requests, links, positions), [requests, links, positions]);
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DataFlowEdgeType>([]);

  useEffect(() => {
    setNodes((prev) => placeNodes(derived, prev, positions));
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return derived.edges.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [derived, positions, setNodes, setEdges]);

  // Fit the viewport once after each (re)load of the project graph.
  const fittedFor = useRef<number | null>(null);
  useEffect(() => {
    if (loading || projectId === null || fittedFor.current === projectId || nodes.length === 0) return;
    fittedFor.current = projectId;
    requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300 }));
  }, [loading, projectId, nodes.length, fitView]);

  // --- "View from…" focus mode -------------------------------------
  const [focusRoot, setFocusRoot] = useState<string | null>(null);
  const activeFocus = focusRoot !== null && derived.nodes.some((n) => n.id === focusRoot) ? focusRoot : null;
  const focusIds = useMemo(
    () => (activeFocus === null ? null : descendantsOf(activeFocus, derived.edges)),
    [activeFocus, derived.edges],
  );
  // Separate node state so focus positions never overwrite the full graph layout.
  const [focusNodes, setFocusNodes, onFocusNodesChange] = useNodesState<AppNode>([]);
  useEffect(() => {
    if (activeFocus === null || focusIds === null) return;
    setFocusNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      const subset = derived.nodes.filter((n) => focusIds.has(n.id));
      const needsLayout = subset.some((n) => !prevById.has(n.id));
      const auto = needsLayout
        ? radialLayout(
            subset.map((n) => n.id),
            derived.edges,
            [activeFocus],
          )
        : null;
      return subset.map((node) => {
        const prevNode = prevById.get(node.id);
        const position = prevNode?.position ?? auto?.get(node.id) ?? { x: 0, y: 0 };
        return mergeNode(prevNode, node, position);
      });
    });
  }, [activeFocus, focusIds, derived, setFocusNodes]);

  useEffect(() => {
    if (activeFocus === null) return;
    const timer = window.setTimeout(() => void fitView(FIT_OPTIONS), 60);
    return () => window.clearTimeout(timer);
  }, [activeFocus, fitView]);

  // --- Search highlight / optional filter ----------------------------------
  const hideNonMatches = useWorkspaceStore((s) => s.graphSearchFilter);
  const query = useRequestListStore((s) => s.query).trim();
  const { requestIds, nodeOfRequest } = useMemo(() => {
    const map = new Map<number, string>();
    for (const n of derived.nodes) {
      if (n.type === "request") for (const id of n.data.memberIds) map.set(id, n.id);
    }
    return { requestIds: [...map.keys()], nodeOfRequest: map };
  }, [derived.nodes]);
  const searchKey = `${projectId ?? ""}|${query}|${requestIds.join(",")}`;
  const [matches, setMatches] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const searchActive = query !== "" && projectId !== null;
  useEffect(() => {
    if (!searchActive || projectId === null) return;
    let cancelled = false;
    requestsApi
      .match(projectId, query, requestIds)
      .then((ids) => {
        if (!cancelled) {
          const nodeIds = ids.map((id) => nodeOfRequest.get(id) ?? requestNodeId(id));
          setMatches({ key: searchKey, ids: new Set(nodeIds) });
        }
      })
      .catch((error: unknown) => toast.error(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [searchActive, projectId, query, requestIds, nodeOfRequest, searchKey]);
  // Keep showing the previous result while a new one is loading to avoid flicker.
  const matchIds = searchActive ? (matches?.ids ?? null) : null;
  const shownRequestCount = derived.nodes.length - (derived.nodes.some((n) => n.type === "user") ? 1 : 0);

  const filtering = hideNonMatches && matchIds !== null;

  const visibleIds = useMemo(() => {
    if (!hideNonMatches || matchIds === null) return focusIds;
    const ids = new Set([...matchIds].filter((id) => focusIds === null || focusIds.has(id)));
    // Keep the user node when it feeds a visible request.
    for (const e of derived.edges) {
      if (ids.has(e.target) && parseNodeId(e.source)?.kind === "user") ids.add(e.source);
    }
    return ids;
  }, [hideNonMatches, matchIds, focusIds, derived.edges]);

  const baseNodes = activeFocus === null ? nodes : focusNodes;
  const shownNodes = useMemo(() => {
    if (matchIds === null) return baseNodes;
    const kept = filtering && visibleIds !== null ? baseNodes.filter((n) => visibleIds.has(n.id)) : baseNodes;
    // Matching blocks glow; others are dimmed (only while a search is active).
    return kept.map((n) => ({ ...n, className: matchIds.has(n.id) ? "search-match" : "search-dim" }));
  }, [baseNodes, matchIds, filtering, visibleIds]);
  const shownEdges = useMemo(
    () => (visibleIds === null ? edges : edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))),
    [edges, visibleIds],
  );

  const showFrom = useCallback((nodeId: string) => {
    setFocusNodes([]);
    setFocusRoot(nodeId);
  }, [setFocusNodes]);

  const showAll = useCallback(() => {
    setFocusRoot(null);
    window.setTimeout(() => void fitView(FIT_OPTIONS), 60);
  }, [fitView]);

  // --- Context menu --------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const onNodeContextMenu = useCallback((event: MouseEvent, node: AppNode) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    setMenu({ nodeId: node.id, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    if (menu === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // --- Toolbar actions -----------------------------------------------------
  const recenter = useCallback(() => void fitView(FIT_OPTIONS), [fitView]);

  const arrangeInCircle = useCallback(() => {
    if (activeFocus !== null && focusIds !== null) {
      const layout = radialLayout([...focusIds], derived.edges, [activeFocus]);
      setFocusNodes((prev) => prev.map((n) => ({ ...n, position: layout.get(n.id) ?? n.position })));
      window.setTimeout(() => void fitView(FIT_OPTIONS), 60);
      return;
    }
    if (projectId === null) return;
    const layout = radialLayout(
      derived.nodes.map((n) => n.id),
      derived.edges,
    );
    setNodes((prev) => prev.map((n) => ({ ...n, position: layout.get(n.id) ?? n.position })));
    setPositions(layout);
    window.setTimeout(() => void fitView(FIT_OPTIONS), 60);
    const placements = [...layout].map(([nodeKey, { x, y }]) => ({ nodeKey, x, y }));
    graphApi.savePositions(projectId, placements).catch((error: unknown) => toast.error(errorMessage(error)));
  }, [activeFocus, focusIds, derived, projectId, setFocusNodes, setNodes, setPositions, fitView]);

  const isValidConnection: IsValidConnection<DataFlowEdgeType> = useCallback((c) => {
    const target = parseNodeId(c.target);
    return target?.kind === "request" && c.source !== c.target;
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      const source = parseNodeId(c.source);
      const target = parseNodeId(c.target);
      if (!source || target?.kind !== "request") return;
      openEditor({
        mode: "create",
        sourceRequestId: source.kind === "user" ? null : source.id,
        targetRequestId: target.id,
      });
    },
    [openEditor],
  );

  const onNodeDragStop: OnNodeDrag<AppNode> = useCallback(
    (_event, node) => {
      if (projectId === null || activeFocus !== null) return;
      setPosition(node.id, node.position);
      graphApi
        .savePosition(projectId, node.id, node.position.x, node.position.y)
        .catch((error: unknown) => toast.error(errorMessage(error)));
    },
    [projectId, activeFocus, setPosition],
  );

  const onEdgesDelete = useCallback(
    (deleted: DataFlowEdgeType[]) => {
      for (const edge of deleted) {
        for (const link of edge.data?.links ?? []) {
          graphApi
            .deleteLink(link.id)
            .then(() => removeLink(link.id))
            .catch((error: unknown) => toast.error(errorMessage(error)));
        }
      }
    },
    [removeLink],
  );

  const onNodeDoubleClick = useCallback(
    (_event: MouseEvent, node: AppNode) => {
      if (node.type === "request") openRequest(node.data.request.id);
    },
    [openRequest],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <ReactFlow<AppNode, DataFlowEdgeType>
        nodes={shownNodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={activeFocus === null ? onNodesChange : onFocusNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onEdgesDelete={onEdgesDelete}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={closeMenu}
        onPaneContextMenu={closeMenu}
        onMoveStart={closeMenu}
        onInit={(instance) => applyRingWidth(containerRef.current, instance.getZoom())}
        onMove={(_event, viewport) => applyRingWidth(containerRef.current, viewport.zoom)}
        deleteKeyCode={DELETE_KEYS}
        onlyRenderVisibleElements
        minZoom={0.05}
        maxZoom={2}
        colorMode="dark"
        proOptions={PRO_OPTIONS}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-card" />
        <Panel
          position="top-left"
          className="max-w-[calc(100%-24rem)] truncate rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground"
          title={t.graph.help}
        >
          {t.graph.stats({ blocks: plural(t.graph.blocks, shownNodes.length), links: plural(t.graph.links, shownEdges.length) })} ·{" "}
          {t.graph.help}
        </Panel>
        <Panel position="top-right" className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={recenter} title={t.graph.recenterTitle}>
            <Crosshair /> {t.graph.recenter}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={arrangeInCircle}
            title={activeFocus === null ? t.graph.arrangeAllTitle : t.graph.arrangeFocusTitle}
          >
            <LayoutGrid /> {t.graph.arrange}
          </Button>
        </Panel>
        {matchIds !== null && (
          <Panel position="bottom-center" className="flex items-center gap-2 rounded-md border border-primary/40 bg-card/95 px-3 py-1.5 text-xs">
            <Search className="size-3.5 text-primary" />
            <span>
              {t.graph.searchSummary({ matches: matchIds.size, total: shownRequestCount })}
              {filtering ? t.graph.othersHidden : ""}
            </span>
          </Panel>
        )}
        {activeFocus !== null && (
          <Panel position="top-center" className="flex items-center gap-2 rounded-md border border-primary/40 bg-card/95 px-3 py-1.5 text-xs">
            <GitFork className="size-3.5 text-primary" />
            <span className="max-w-[360px] truncate">
              {t.graph.viewFrom}{" "}
              <span dir="ltr" className="font-mono">
                {nodeLabel(nodes.find((n) => n.id === activeFocus), t)}
              </span>
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={showAll}>
              <X /> {t.graph.showAll}
            </Button>
          </Panel>
        )}
      </ReactFlow>

      {!loading && nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex max-w-sm flex-col items-center gap-2 text-center text-muted-foreground">
            <Network className="size-10 opacity-40" />
            <p className="text-sm">
              {t.graph.empty}
            </p>
          </div>
        </div>
      )}
      {menu !== null && (
        <>
          <div className="absolute inset-0 z-40" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          <div
            className="absolute z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 text-sm shadow-lg"
            style={{ left: menu.x, top: menu.y }}
          >
            <div dir="ltr" className="truncate px-2 py-1 text-start font-mono text-xs text-muted-foreground">
              {nodeLabel(nodes.find((n) => n.id === menu.nodeId), t)}
            </div>
            <MenuItem
              onClick={() => {
                showFrom(menu.nodeId);
                closeMenu();
              }}
            >
              <GitFork className="size-4" /> {t.graph.showFromNode}
            </MenuItem>
            {parseNodeId(menu.nodeId)?.kind === "request" && (
              <MenuItem
                onClick={() => {
                  const parsed = parseNodeId(menu.nodeId);
                  if (parsed?.kind === "request") openRequest(parsed.id);
                  closeMenu();
                }}
              >
                <Eye className="size-4" /> {t.graph.openDetail}
              </MenuItem>
            )}
            {activeFocus !== null && (
              <MenuItem
                onClick={() => {
                  showAll();
                  closeMenu();
                }}
              >
                <Network className="size-4" /> {t.graph.showAll}
              </MenuItem>
            )}
          </div>
        </>
      )}
      <LinkEditorDialog />
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </button>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}
