import { ArrowRight } from "lucide-react";

import { useT } from "@/i18n";
import { locationLabel, valueTypeLabel } from "@/lib/format";
import type { LinkVariable } from "@/types/domain";

/** Compact list of variables flowing through a link (`token: JWT`). */
export function VariableList({ variables }: { variables: readonly LinkVariable[] }) {
  const t = useT();
  if (variables.length === 0) {
    return <p className="text-muted-foreground">{t.graph.noVariables}</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {variables.map((v, i) => (
        <li key={`${v.name}-${v.targetName}-${i}`} className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
          <span dir="ltr" className="text-start font-mono">
            <span className="text-foreground">{v.name}</span>
            <span className="text-muted-foreground">: </span>
            <span className="text-sky-300">{valueTypeLabel(v.valueType)}</span>
          </span>
          {(v.targetName !== v.name || v.targetLocation !== "unknown") && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ArrowRight className="size-3 shrink-0 rtl:rotate-180" />
              <span className="min-w-0">
                {v.targetName} ({locationLabel(v.targetLocation)})
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
