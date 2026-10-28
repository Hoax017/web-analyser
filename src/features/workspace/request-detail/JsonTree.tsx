import type { ReactNode } from "react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ChevronUp, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { plural, useT } from "@/i18n";
import type { JsonPath, JsonSegment, JsonValue, PathFormat } from "@/lib/json";
import { childCount, children, formatPath, isContainer, pathId, searchJson, valueAt } from "@/lib/json";
import { cn } from "@/lib/utils";

import { CopyButton } from "./parts";

/** Children rendered per container before a "show more" button. */
const CHILD_PAGE = 200;
const DEFAULT_DEPTH = 2;
const INDENT_PX = 14;
const PATH_FORMATS: { id: PathFormat; label: string }[] = [
  { id: "js", label: "JS" },
  { id: "jsonpath", label: "JSONPath" },
  { id: "jq", label: "jq" },
];

interface TreeContext {
  query: string;
  depthLimit: number;
  overrides: ReadonlyMap<string, boolean>;
  ancestors: ReadonlySet<string>;
  selectedId: string | null;
  currentMatchId: string | null;
  toggle: (id: string, open: boolean) => void;
  select: (path: JsonPath) => void;
}

/** Foldable JSON tree with search highlighting and click-to-copy access paths. */
export function JsonTree({ value, toolbar }: { value: JsonValue; toolbar: ReactNode }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [depthLimit, setDepthLimit] = useState(DEFAULT_DEPTH);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [selected, setSelected] = useState<JsonPath | null>(null);
  const [format, setFormat] = useState<PathFormat>("js");
  const [matchIndex, setMatchIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const search = useMemo(() => searchJson(value, deferredQuery), [value, deferredQuery]);
  const matchCount = search.matches.length;
  const current = matchCount > 0 ? Math.min(matchIndex, matchCount - 1) : -1;
  const currentMatchId = current >= 0 ? (search.matches[current] ?? null) : null;

  useEffect(() => {
    if (currentMatchId === null) return;
    scroller.current
      ?.querySelector(`[data-path-id="${CSS.escape(currentMatchId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [currentMatchId]);

  const ctx = useMemo<TreeContext>(
    () => ({
      query: deferredQuery.trim().toLowerCase(),
      depthLimit,
      overrides,
      ancestors: search.ancestors,
      selectedId: selected === null ? null : pathId(selected),
      currentMatchId,
      toggle: (id, open) => setOverrides((prev) => new Map(prev).set(id, open)),
      select: setSelected,
    }),
    [deferredQuery, depthLimit, overrides, search.ancestors, selected, currentMatchId],
  );

  const changeQuery = (next: string) => {
    setQuery(next);
    setMatchIndex(0);
    // Manual folds would hide new matches.
    setOverrides(new Map());
  };
  const step = (delta: number) => setMatchIndex((current + delta + matchCount) % matchCount);
  const foldAll = (limit: number) => {
    setDepthLimit(limit);
    setOverrides(new Map());
  };

  const selectedValue = selected === null ? undefined : valueAt(value, selected);
  const selectedPath = selected === null ? "" : formatPath(selected, format);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matchCount > 0) step(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") changeQuery("");
            }}
            placeholder={t.json.search}
            className="h-8 ps-8 pe-8 text-xs"
          />
          {query && (
            <button
              type="button"
              aria-label={t.common.clear}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => changeQuery("")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {deferredQuery.trim() !== "" && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{matchCount === 0 ? t.json.noResult : `${current + 1}/${matchCount}`}</span>
            <Button variant="ghost" size="iconSm" aria-label={t.json.previous} disabled={matchCount === 0} onClick={() => step(-1)}>
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="iconSm" aria-label={t.json.next} disabled={matchCount === 0} onClick={() => step(1)}>
              <ChevronDown />
            </Button>
          </div>
        )}
        <Button variant="ghost" size="iconSm" title={t.json.expandAll} onClick={() => foldAll(Number.POSITIVE_INFINITY)}>
          <ChevronsUpDown />
        </Button>
        <Button variant="ghost" size="iconSm" title={t.json.collapseAll} onClick={() => foldAll(1)}>
          <ChevronsDownUp />
        </Button>
      </div>

      <div className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs">
        <span className="shrink-0 text-muted-foreground">{t.json.path}</span>
        <div className="flex shrink-0 rounded border border-border">
          {PATH_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={cn("px-1.5 py-0.5", format === f.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setFormat(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {selected === null ? (
          <span className="text-muted-foreground italic">{t.json.clickHint}</span>
        ) : (
          <>
            <code dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono text-amber-200 select-text" title={selectedPath}>
              {selectedPath}
            </code>
            <span className="flex shrink-0 items-center text-muted-foreground" title={t.json.copyPath}>
              <CopyButton text={selectedPath} />
            </span>
            {selectedValue !== undefined && (
              <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground" title={t.json.copyValue}>
                {t.json.value}
                <CopyButton text={typeof selectedValue === "string" ? selectedValue : JSON.stringify(selectedValue, null, 2)} />
              </span>
            )}
          </>
        )}
      </div>

      <div
        ref={scroller}
        dir="ltr"
        className="max-h-[60vh] overflow-auto rounded-md border border-border bg-muted/30 py-2 text-start font-mono text-xs leading-relaxed"
      >
        <JsonNode name={null} value={value} path={[]} depth={0} ctx={ctx} />
      </div>
    </div>
  );
}

const JsonNode = memo(function JsonNode({
  name,
  value,
  path,
  depth,
  ctx,
}: {
  name: JsonSegment | null;
  value: JsonValue;
  path: JsonPath;
  depth: number;
  ctx: TreeContext;
}) {
  const t = useT();
  const [limit, setLimit] = useState(CHILD_PAGE);
  const id = pathId(path);
  const container = isContainer(value);
  const open = container && (ctx.overrides.get(id) ?? (ctx.ancestors.has(id) || depth < ctx.depthLimit));
  const isArray = Array.isArray(value);
  const count = childCount(value);
  const [openBracket, closeBracket] = isArray ? ["[", "]"] : ["{", "}"];
  const entries = open ? children(value) : [];

  return (
    <div>
      <div
        data-path-id={id}
        className={cn(
          "flex items-start gap-1 rounded-sm pr-2 hover:bg-muted/60",
          ctx.selectedId === id && "bg-sky-500/15",
          ctx.currentMatchId === id && "outline outline-1 outline-amber-400",
        )}
        style={{ paddingLeft: depth * INDENT_PX + 4 }}
      >
        {container ? (
          <button
            type="button"
            aria-label={open ? t.json.collapse : t.json.expand}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => ctx.toggle(id, !open)}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {name !== null && (
            <>
              <button type="button" className="text-left text-sky-300 hover:underline" onClick={() => ctx.select(path)}>
                {typeof name === "number" ? (
                  <span className="text-muted-foreground">{name}</span>
                ) : (
                  <>
                    &quot;<Highlight text={name} query={ctx.query} />&quot;
                  </>
                )}
              </button>
              <span className="text-muted-foreground">: </span>
            </>
          )}
          {container ? (
            open ? (
              <span className="text-muted-foreground">{openBracket}</span>
            ) : (
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => ctx.toggle(id, true)}>
                {openBracket}…{closeBracket}{" "}
                <span className="text-[10px] italic">
                  {plural(isArray ? t.json.items : t.json.keys, count)}
                </span>
              </button>
            )
          ) : (
            <button type="button" className={cn("text-left hover:underline", primitiveClass(value))} onClick={() => ctx.select(path)}>
              <Highlight text={typeof value === "string" ? `"${value}"` : String(value)} query={ctx.query} />
            </button>
          )}
        </span>
      </div>
      {open && (
        <>
          {entries.slice(0, limit).map(([segment, child]) => (
            <JsonNode key={segment} name={segment} value={child} path={[...path, segment]} depth={depth + 1} ctx={ctx} />
          ))}
          {entries.length > limit && (
            <button
              type="button"
              className="text-sky-400 hover:underline"
              style={{ paddingLeft: (depth + 1) * INDENT_PX + 22 }}
              onClick={() => setLimit((l) => l + CHILD_PAGE)}
            >
              {t.json.showMore({ more: Math.min(CHILD_PAGE, entries.length - limit), remaining: entries.length - limit })}
            </button>
          )}
          <div className="text-muted-foreground" style={{ paddingLeft: depth * INDENT_PX + 22 }}>
            {closeBracket}
          </div>
        </>
      )}
    </div>
  );
});

function primitiveClass(value: JsonValue): string {
  if (typeof value === "string") return "text-emerald-300";
  if (typeof value === "number") return "text-amber-300";
  return "text-violet-300";
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (query === "") return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-amber-400/80 text-black">
        {text.slice(at, at + query.length)}
      </mark>,
    );
    from = at + query.length;
  }
  if (parts.length === 0) return text;
  parts.push(text.slice(from));
  return <>{parts}</>;
}
