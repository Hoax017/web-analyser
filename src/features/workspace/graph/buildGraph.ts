import { MarkerType } from "@xyflow/react";

import { USER_NODE_ID, parseNodeId, requestNodeId, type XY } from "@/stores/graphStore";
import { requestGroupKey, type Link, type LinkId, type LinkVariable, type RequestId, type RequestSummary } from "@/types/domain";

import { radialLayout } from "./layout";
import type { AppNode, DataFlowEdgeType } from "./types";

export interface DerivedGraph {
  nodes: AppNode[];
  edges: DataFlowEdgeType[];
}

/**
 * Pure projection of the store into React Flow nodes/edges (without positions).
 * Identical requests (same method + host + path) share a single node, and the
 * links between two nodes are merged into one edge. A node is displayed when
 * one of its occurrences is linked or pinned; the user node appears only when
 * at least one link originates from user input.
 */
export function deriveGraph(
  requests: ReadonlyMap<RequestId, RequestSummary>,
  links: ReadonlyMap<LinkId, Link>,
  positions: ReadonlyMap<string, XY | null>,
): DerivedGraph {
  // Group occurrences; the representative is the pinned one, else the oldest.
  const groups = new Map<string, RequestSummary[]>();
  for (const request of requests.values()) {
    const key = requestGroupKey(request);
    const members = groups.get(key);
    if (members) members.push(request);
    else groups.set(key, [request]);
  }
  const nodeOf = new Map<RequestId, string>();
  const representatives: { request: RequestSummary; memberIds: RequestId[] }[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.id - b.id);
    const first = members[0];
    if (!first) continue;
    const request = members.find((m) => positions.get(requestNodeId(m.id))) ?? first;
    const nodeId = requestNodeId(request.id);
    for (const m of members) nodeOf.set(m.id, nodeId);
    representatives.push({ request, memberIds: members.map((m) => m.id) });
  }
  const resolve = (id: RequestId): string => nodeOf.get(id) ?? requestNodeId(id);

  const visible = new Set<string>();
  const merged = new Map<string, { source: string; target: string; links: Link[] }>();
  for (const link of links.values()) {
    const source = link.sourceRequestId === null ? USER_NODE_ID : resolve(link.sourceRequestId);
    const target = resolve(link.targetRequestId);
    if (source === target) continue;
    visible.add(source).add(target);
    const key = `${source}->${target}`;
    const entry = merged.get(key);
    if (entry) entry.links.push(link);
    else merged.set(key, { source, target, links: [link] });
  }
  for (const key of positions.keys()) visible.add(nodeOf.get(parseRequestKey(key) ?? -1) ?? key);

  const edges: DataFlowEdgeType[] = [];
  for (const { source, target, links: group } of merged.values()) {
    const link = group.find((l) => l.origin === "manual") ?? group[0];
    if (!link) continue;
    edges.push({
      id: `link:${link.id}`,
      type: "dataFlow",
      source,
      target,
      data: { link, links: group, variables: unionVariables(group) },
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    });
  }

  const nodes: AppNode[] = [];
  if (visible.has(USER_NODE_ID)) {
    nodes.push({
      id: USER_NODE_ID,
      type: "user",
      position: { x: 0, y: 0 },
      data: { label: "Utilisateur" },
      deletable: false,
    });
  }
  for (const { request, memberIds } of representatives) {
    const id = requestNodeId(request.id);
    if (!visible.has(id)) continue;
    nodes.push({
      id,
      type: "request",
      position: { x: 0, y: 0 },
      data: { request, memberIds },
      deletable: false,
    });
  }
  return { nodes, edges };
}

function parseRequestKey(key: string): RequestId | null {
  const parsed = parseNodeId(key);
  return parsed?.kind === "request" ? parsed.id : null;
}

function unionVariables(links: readonly Link[]): LinkVariable[] {
  const seen = new Map<string, LinkVariable>();
  for (const link of links) {
    for (const v of link.variables) {
      const key = JSON.stringify([v.name, v.targetName, v.sourceLocation, v.targetLocation]);
      if (!seen.has(key)) seen.set(key, v);
    }
  }
  return [...seen.values()];
}

/**
 * Reuses a React Flow node (keeps measured size and selection) with fresh data and position.
 */
export function mergeNode(prev: AppNode | undefined, node: AppNode, position: XY): AppNode {
  if (prev?.type === "request" && node.type === "request") return { ...prev, data: node.data, position };
  if (prev?.type === "user" && node.type === "user") return { ...prev, data: node.data, position };
  return { ...node, position };
}

/**
 * Merges freshly derived nodes with the current React Flow nodes:
 * persisted position > current on-screen position > auto layout.
 */
export function placeNodes(
  derived: DerivedGraph,
  previous: readonly AppNode[],
  positions: ReadonlyMap<string, XY | null>,
): AppNode[] {
  const prevById = new Map(previous.map((n) => [n.id, n]));
  const needsLayout = derived.nodes.some((n) => !positions.get(n.id) && !prevById.has(n.id));
  const auto = needsLayout ? radialLayout(derived.nodes.map((n) => n.id), derived.edges) : null;

  return derived.nodes.map((node): AppNode => {
    const prev = prevById.get(node.id);
    const position = positions.get(node.id) ?? prev?.position ?? auto?.get(node.id) ?? { x: 0, y: 0 };
    return mergeNode(prev, node, position);
  });
}
