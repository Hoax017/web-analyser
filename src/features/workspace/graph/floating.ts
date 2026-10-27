import { Position, type InternalNode, type Node } from "@xyflow/react";

export interface FloatingGeometry {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}

interface Rect {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

function rectOf(node: InternalNode<Node>): Rect | null {
  const width = node.measured.width ?? 0;
  const height = node.measured.height ?? 0;
  if (width === 0 || height === 0) return null;
  const { x, y } = node.internals.positionAbsolute;
  return { cx: x + width / 2, cy: y + height / 2, halfW: width / 2, halfH: height / 2 };
}

/** Point where the line from `from`'s center towards `to`'s center crosses `from`'s border. */
function borderPoint(from: Rect, to: Rect): { x: number; y: number; position: Position } {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy + from.halfH, position: Position.Bottom };

  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : from.halfW / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : from.halfH / Math.abs(dy),
  );
  // The side is chosen by comparing slopes relative to the node's aspect ratio.
  const horizontal = Math.abs(dx) * from.halfH > Math.abs(dy) * from.halfW;
  const position = horizontal ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
  return { x: from.cx + dx * scale, y: from.cy + dy * scale, position };
}

/**
 * Floating edge endpoints: each end sticks to the side of its node facing the
 * other node, so links stay readable wherever nodes are dragged.
 */
export function floatingGeometry(source: InternalNode<Node>, target: InternalNode<Node>): FloatingGeometry | null {
  const s = rectOf(source);
  const t = rectOf(target);
  if (!s || !t) return null;
  const start = borderPoint(s, t);
  const end = borderPoint(t, s);
  return {
    sourceX: start.x,
    sourceY: start.y,
    targetX: end.x,
    targetY: end.y,
    sourcePosition: start.position,
    targetPosition: end.position,
  };
}
