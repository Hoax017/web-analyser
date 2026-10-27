import type { Edge, Node } from "@xyflow/react";

import type { Link, LinkVariable, RequestId, RequestSummary } from "@/types/domain";

export type RequestNodeData = {
  /** Representative request of the group (oldest one, or the one pinned). */
  request: RequestSummary;
  /** Every captured occurrence of this resource (same method + host + path). */
  memberIds: RequestId[];
};
export type UserNodeData = { label: string };
export type DataFlowEdgeData = {
  /** Representative link (used by the editor). */
  link: Link;
  /** All links merged into this edge (occurrences of the same resources). */
  links: Link[];
  /** Union of the variables carried by `links`. */
  variables: LinkVariable[];
};

export type RequestNodeType = Node<RequestNodeData, "request">;
export type UserNodeType = Node<UserNodeData, "user">;
export type AppNode = RequestNodeType | UserNodeType;
export type DataFlowEdgeType = Edge<DataFlowEdgeData, "dataFlow">;

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 72;
