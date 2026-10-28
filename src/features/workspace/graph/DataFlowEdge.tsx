import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";
import { Eye } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { plural, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useGraphStore } from "@/stores/graphStore";

import { floatingGeometry } from "./floating";
import type { DataFlowEdgeType } from "./types";
import { VariableList } from "./VariableList";

/**
 * Data-flow link. The "eye" bubble at mid-path shows transferred variables on
 * hover and opens the link editor on click.
 */
export const DataFlowEdge = memo(function DataFlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<DataFlowEdgeType>) {
  const t = useT();
  const openEditor = useGraphStore((s) => s.openEditor);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // Fall back to handle positions until both nodes are measured.
  const geometry = (sourceNode && targetNode && floatingGeometry(sourceNode, targetNode)) || {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  };
  const [path, labelX, labelY] = getBezierPath(geometry);

  const link = data?.link;
  const fromUser = link?.sourceRequestId === null;
  const manual = link?.origin === "manual";
  const stroke = fromUser ? "#38bdf8" : manual ? "#a78bfa" : "#94a3b8";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd !== undefined ? { markerEnd } : {})}
        style={{ stroke, strokeWidth: selected ? 2.5 : 1.5, strokeDasharray: manual ? "6 4" : undefined }}
      />
      {link && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <Tooltip delayDuration={80}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t.graph.showVariables}
                  onClick={() => openEditor({ mode: "edit", link })}
                  className={cn(
                    "grid size-7 place-items-center rounded-full border bg-background shadow transition-transform hover:scale-110",
                    selected ? "border-primary" : "border-border",
                  )}
                >
                  <Eye className="size-3.5" style={{ color: stroke }} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <VariableList variables={data?.variables ?? link.variables} />
                <p className="mt-2 border-t border-border pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {manual ? t.graph.manualLink : t.graph.autoLink}
                  {(data?.links.length ?? 1) > 1 ? ` · ${plural(t.list.occurrences, data?.links.length ?? 1)}` : ""} ·{" "}
                  {t.graph.clickToEdit}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
