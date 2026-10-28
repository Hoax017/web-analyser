import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { formatBytes, prettyBody } from "@/lib/format";
import { parseJson } from "@/lib/json";
import { cn } from "@/lib/utils";
import type { BodyEncoding, HttpHeader, QueryParam } from "@/types/domain";

import { JsonTree } from "./JsonTree";

/** Above this size, only a preview is rendered to keep the DOM light. */
const PREVIEW_LIMIT = 200_000;

export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="iconSm"
      aria-label={t.common.copy}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function KeyValueTable({ rows, empty }: { rows: readonly (HttpHeader | QueryParam)[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table dir="ltr" className="w-full table-fixed text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.name}-${i}`} className="border-b border-border last:border-0 odd:bg-muted/30">
              <td className="w-1/3 px-3 py-1.5 align-top font-mono text-xs text-sky-300 break-all">{row.name}</td>
              <td className="px-3 py-1.5 font-mono text-xs break-all select-text">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BodyViewer({
  body,
  encoding,
  mimeType,
  size,
}: {
  body: string | null;
  encoding: BodyEncoding;
  mimeType: string | null;
  size: number | null;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const json = useMemo(() => (body !== null && encoding === "utf8" ? parseJson(body) : undefined), [body, encoding]);
  const formatted = useMemo(
    () => (json !== undefined ? JSON.stringify(json, null, 2) : body !== null && encoding === "utf8" ? prettyBody(body).text : null),
    [json, body, encoding],
  );

  if (body === null || encoding === "none") {
    return (
      <p className="text-sm text-muted-foreground">
        {size !== null ? t.detail.bodyNotKept({ size: formatBytes(size) }) : t.detail.noBody}
      </p>
    );
  }

  if (encoding === "base64") {
    if (mimeType?.startsWith("image/")) {
      return <img alt={t.detail.preview} className="max-h-96 rounded border border-border" src={`data:${mimeType};base64,${body}`} />;
    }
    return (
      <p className="text-sm text-muted-foreground">
        {t.detail.binary({ mime: mimeType ?? t.detail.unknownType, size: formatBytes(size) })}
      </p>
    );
  }

  const text = formatted ?? body;
  const modeToggle =
    json === undefined ? null : (
      <div className="flex shrink-0 rounded-md border border-border text-xs">
        {(["tree", "raw"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={cn("px-2 py-1", mode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setMode(m)}
          >
            {m === "tree" ? t.detail.tree : t.detail.raw}
          </button>
        ))}
      </div>
    );
  if (json !== undefined && mode === "tree") {
    return <JsonTree value={json} toolbar={<>{modeToggle}<CopyButton text={text} /></>} />;
  }

  const truncated = !expanded && text.length > PREVIEW_LIMIT;
  return (
    <div className="flex flex-col gap-2">
      {modeToggle && <div className="flex">{modeToggle}</div>}
      <div className="relative">
        <div className="absolute end-2 top-2">
          <CopyButton text={text} />
        </div>
        <pre dir="ltr" className="max-h-[60vh] overflow-auto rounded-md border border-border bg-muted/30 p-3 pe-10 text-start font-mono text-xs leading-relaxed whitespace-pre-wrap break-all select-text">
          {truncated ? text.slice(0, PREVIEW_LIMIT) : text}
        </pre>
        {truncated && (
          <Button variant="link" size="sm" className="mt-1" onClick={() => setExpanded(true)}>
            {t.detail.showAll({ size: formatBytes(text.length) })}
          </Button>
        )}
      </div>
    </div>
  );
}
