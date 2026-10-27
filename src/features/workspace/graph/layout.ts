import type { XYPosition } from "@xyflow/react";

import { NODE_HEIGHT, NODE_WIDTH } from "./types";

/** Minimum distance between two node centers along a ring. */
const SPACING = NODE_WIDTH + 30;
/** Radial distance between two consecutive rings (nodes are wider than tall). */
const RING_GAP = NODE_WIDTH + 80;
const TAU = Math.PI * 2;
/** Rings start at the top of the circle. */
const START_ANGLE = -Math.PI / 2;

interface EdgeLike {
  source: string;
  target: string;
}

/**
 * Breadth-first levels from the given roots (or from nodes without incoming
 * edges). Nodes only reachable through cycles become extra roots.
 */
function levelsOf(
  nodeIds: readonly string[],
  children: ReadonlyMap<string, readonly string[]>,
  roots: readonly string[],
): { levels: string[][]; parent: Map<string, string> } {
  const depth = new Map<string, number>();
  const parent = new Map<string, string>();
  const levels: string[][] = [];

  const visit = (seeds: readonly string[]) => {
    const queue: string[] = [];
    for (const seed of seeds) {
      if (depth.has(seed)) continue;
      depth.set(seed, 0);
      (levels[0] ??= []).push(seed);
      queue.push(seed);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (id === undefined) continue;
      const d = (depth.get(id) ?? 0) + 1;
      for (const child of children.get(id) ?? []) {
        if (depth.has(child)) continue;
        depth.set(child, d);
        parent.set(child, id);
        (levels[d] ??= []).push(child);
        queue.push(child);
      }
    }
  };

  visit(roots);
  for (const id of nodeIds) if (!depth.has(id)) visit([id]);
  return { levels, parent };
}

/** Spreads nodes around their desired angles while keeping a minimum gap. */
function spreadAngles(desired: readonly number[], minGap: number): number[] {
  const out: number[] = [];
  for (const [i, angle] of desired.entries()) {
    const previous = out[i - 1];
    out.push(previous === undefined ? angle : Math.max(angle, previous + minGap));
  }
  // Center the pushed sequence on the desired angles so groups stay near their parent.
  const shift = out.reduce((sum, a, i) => sum + (a - (desired[i] ?? a)), 0) / Math.max(out.length, 1);
  return out.map((a) => a - shift);
}

/**
 * Radial layout: roots in the middle, each generation on a wider concentric
 * ring, children placed as close as possible to their parent's angle.
 * Returns top-left positions for React Flow.
 */
export function radialLayout(
  nodeIds: readonly string[],
  edges: readonly EdgeLike[],
  roots?: readonly string[],
): Map<string, XYPosition> {
  const known = new Set(nodeIds);
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const { source, target } of edges) {
    if (source === target || !known.has(source) || !known.has(target)) continue;
    const list = children.get(source) ?? [];
    if (!list.includes(target)) list.push(target);
    children.set(source, list);
    hasParent.add(target);
  }

  const seedRoots = roots ?? nodeIds.filter((id) => !hasParent.has(id));
  const { levels, parent } = levelsOf(nodeIds, children, seedRoots);

  const angle = new Map<string, number>();
  const radius = new Map<string, number>();
  let previousRadius = 0;

  for (const [d, level] of levels.entries()) {
    const count = level.length;
    if (count === 0) continue;

    if (d === 0 && count === 1) {
      const [only] = level;
      if (only !== undefined) {
        angle.set(only, START_ANGLE);
        radius.set(only, 0);
      }
      continue;
    }

    let r = d === 0 ? 0 : previousRadius + RING_GAP;
    r = Math.max(r, (count * SPACING) / TAU);

    // Desired angle = parent's angle; children of a centered node are spread evenly.
    const desired = level.map((id, i) => {
      const p = parent.get(id);
      const parentAngle = p === undefined ? undefined : angle.get(p);
      const parentRadius = p === undefined ? undefined : radius.get(p);
      if (parentAngle === undefined || parentRadius === 0) return START_ANGLE + (i * TAU) / count;
      return parentAngle;
    });
    const order = level.map((id, i) => ({ id, want: desired[i] ?? 0 })).sort((a, b) => a.want - b.want);

    const minGap = SPACING / r;
    const angles =
      count * minGap >= TAU
        ? order.map((_, i) => START_ANGLE + (i * TAU) / count)
        : spreadAngles(
            order.map((o) => o.want),
            minGap,
          );

    for (const [i, { id }] of order.entries()) {
      angle.set(id, angles[i] ?? 0);
      radius.set(id, r);
    }
    previousRadius = r;
  }

  const out = new Map<string, XYPosition>();
  for (const id of nodeIds) {
    const a = angle.get(id) ?? 0;
    const r = radius.get(id) ?? 0;
    out.set(id, { x: r * Math.cos(a) - NODE_WIDTH / 2, y: r * Math.sin(a) - NODE_HEIGHT / 2 });
  }
  return out;
}

/** `root` and every node reachable from it by following link directions. */
export function descendantsOf(root: string, edges: readonly EdgeLike[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const { source, target } of edges) {
    const list = children.get(source) ?? [];
    list.push(target);
    children.set(source, list);
  }
  const seen = new Set<string>([root]);
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    for (const child of children.get(id) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}
