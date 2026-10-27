import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { statusTone } from "@/lib/format";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-secondary text-secondary-foreground",
        success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
        redirect: "border-sky-500/40 bg-sky-500/15 text-sky-400",
        clientError: "border-amber-500/40 bg-amber-500/15 text-amber-400",
        serverError: "border-red-500/40 bg-red-500/15 text-red-400",
        pending: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function StatusBadge({ status, failed, className }: { status: number | null; failed: boolean; className?: string }) {
  return (
    <Badge tone={statusTone(status, failed)} className={className}>
      {failed ? "ERR" : (status ?? "…")}
    </Badge>
  );
}

const METHOD_COLORS: Record<string, string> = {
  GET: "text-sky-400",
  POST: "text-emerald-400",
  PUT: "text-amber-400",
  PATCH: "text-violet-400",
  DELETE: "text-red-400",
};

export function MethodLabel({ method, className }: { method: string; className?: string }) {
  return (
    <span className={cn("font-mono text-[11px] font-bold", METHOD_COLORS[method] ?? "text-muted-foreground", className)}>
      {method}
    </span>
  );
}
