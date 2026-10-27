/** Any value produced by `JSON.parse`. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonSegment = string | number;
export type JsonPath = readonly JsonSegment[];
export type PathFormat = "js" | "jsonpath" | "jq";

export function parseJson(text: string): JsonValue | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    // JSON.parse only ever produces JSON values.
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return undefined;
  }
}

export function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return value !== null && typeof value === "object";
}

export function childCount(value: JsonValue): number {
  if (Array.isArray(value)) return value.length;
  return isContainer(value) ? Object.keys(value).length : 0;
}

export function children(value: JsonValue): [JsonSegment, JsonValue][] {
  if (Array.isArray(value)) return value.map((v, i) => [i, v]);
  return isContainer(value) ? Object.entries(value) : [];
}

/** Stable identifier of a node, used for folding state and DOM lookups. */
export function pathId(path: JsonPath): string {
  return JSON.stringify(path);
}

export function valueAt(root: JsonValue, path: JsonPath): JsonValue | undefined {
  let current: JsonValue | undefined = root;
  for (const segment of path) {
    if (current === undefined || !isContainer(current)) return undefined;
    current = Array.isArray(current)
      ? typeof segment === "number" ? current[segment] : undefined
      : current[String(segment)];
  }
  return current;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function formatPath(path: JsonPath, format: PathFormat): string {
  const parts = path.map((segment) => {
    if (typeof segment === "number") return `[${segment}]`;
    if (IDENTIFIER.test(segment)) return `.${segment}`;
    return format === "jsonpath" ? `['${segment.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']` : `[${JSON.stringify(segment)}]`;
  });
  switch (format) {
    case "js": {
      const joined = parts.join("");
      return joined.startsWith(".") ? joined.slice(1) : joined || "(racine)";
    }
    case "jsonpath":
      return `$${parts.join("")}`;
    case "jq":
      // jq needs a dot before brackets at the start: `.[0]`, `.["a-b"]`.
      return parts.length === 0 ? "." : parts.map((p, i) => (i === 0 && p.startsWith("[") ? `.${p}` : p)).join("");
  }
}

export interface JsonSearchResult {
  /** Matching nodes, in display (depth-first) order. */
  matches: string[];
  /** Containers holding at least one match, to unfold them. */
  ancestors: Set<string>;
}

/** Case-insensitive search on object keys and primitive values. */
export function searchJson(root: JsonValue, query: string): JsonSearchResult {
  const q = query.trim().toLowerCase();
  const result: JsonSearchResult = { matches: [], ancestors: new Set() };
  if (q === "") return result;

  const walk = (value: JsonValue, path: JsonSegment[]): boolean => {
    const key = path[path.length - 1];
    const id = pathId(path);
    const self =
      (typeof key === "string" && key.toLowerCase().includes(q)) ||
      (!isContainer(value) && String(value).toLowerCase().includes(q));
    if (self) result.matches.push(id);
    let below = false;
    for (const [segment, child] of children(value)) {
      path.push(segment);
      if (walk(child, path)) below = true;
      path.pop();
    }
    if (below) result.ancestors.add(id);
    return self || below;
  };
  walk(root, []);
  return result;
}
