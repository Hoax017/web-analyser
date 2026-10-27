import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { User } from "lucide-react";

import { MethodLabel, StatusBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { NODE_WIDTH, type RequestNodeType, type UserNodeType } from "./types";

const handleClass = "!size-2.5 !border-2 !border-background !bg-primary";

export const RequestNode = memo(function RequestNode({ data, selected }: NodeProps<RequestNodeType>) {
  const { request, memberIds } = data;
  return (
    <div
      style={{ width: NODE_WIDTH }}
      title={memberIds.length > 1 ? `${request.url}\n${memberIds.length} occurrences` : request.url}
      className={cn(
        "graph-node-card relative rounded-lg border border-border bg-card px-3 py-2",
        selected && "is-selected",
      )}
    >
      {memberIds.length > 1 && (
        <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground shadow">
          {memberIds.length > 99 ? "99+" : memberIds.length}
        </span>
      )}
      <Handle type="target" position={Position.Top} className={handleClass} />
      <div className="flex items-center gap-2">
        <MethodLabel method={request.method} />
        <span className="truncate font-mono text-sm">{request.path || "/"}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{request.host}</span>
        <StatusBadge status={request.status} failed={request.failed} />
      </div>
      <Handle type="source" position={Position.Bottom} className={handleClass} />
    </div>
  );
});

export const UserNode = memo(function UserNode({ data, selected }: NodeProps<UserNodeType>) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "graph-node-card grid size-14 place-items-center rounded-xl border border-sky-400/50 bg-sky-400/20",
          selected && "is-selected",
        )}
      >
        <User className="size-6 text-sky-300" />
      </div>
      <span className="text-xs text-muted-foreground">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className={handleClass} />
    </div>
  );
});
