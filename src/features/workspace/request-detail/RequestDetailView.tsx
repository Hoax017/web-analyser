import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Loader2, Terminal } from "lucide-react";

import { requestsApi } from "@/api";
import { MethodLabel, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toCurl } from "@/lib/curl";
import { useT } from "@/i18n";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import { errorMessage } from "@/lib/tauri";
import { useGraphStore } from "@/stores/graphStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Link, RequestDetail, RequestId } from "@/types/domain";

import { VariableList } from "../graph/VariableList";
import { OccurrenceTabs } from "./OccurrenceTabs";
import { BodyViewer, CopyButton, KeyValueTable, Section } from "./parts";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: RequestDetail };

export function RequestDetailView({ requestId }: { requestId: RequestId }) {
  const t = useT();
  const showGraph = useWorkspaceStore((s) => s.showGraph);
  const [loaded, setLoaded] = useState<{ id: RequestId; state: LoadState } | null>(null);
  // A result for a previously selected request means the current one is still loading.
  const state: LoadState = loaded?.id === requestId ? loaded.state : { status: "loading" };

  useEffect(() => {
    let cancelled = false;
    requestsApi
      .get(requestId)
      .then((detail) => !cancelled && setLoaded({ id: requestId, state: { status: "ready", detail } }))
      .catch(
        (error: unknown) =>
          !cancelled && setLoaded({ id: requestId, state: { status: "error", message: errorMessage(error) } }),
      );
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Button variant="outline" size="sm" onClick={showGraph}>
          <ArrowLeft className="rtl:rotate-180" /> {t.detail.back}
        </Button>
        {state.status === "ready" && <DetailHeader detail={state.detail} />}
      </div>
      <OccurrenceTabs requestId={requestId} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {state.status === "loading" && <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" />}
        {state.status === "error" && <p className="text-sm text-red-400">{state.message}</p>}
        {state.status === "ready" && <DetailBody detail={state.detail} />}
      </div>
    </div>
  );
}

function DetailHeader({ detail }: { detail: RequestDetail }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <MethodLabel method={detail.method} className="text-sm" />
      <span dir="ltr" className="truncate text-start font-mono text-sm select-text" title={detail.url}>
        {detail.url}
      </span>
      <CopyButton text={detail.url} />
      <StatusBadge status={detail.status} failed={detail.failed} className="ms-auto" />
    </div>
  );
}

function DetailBody({ detail }: { detail: RequestDetail }) {
  const t = useT();
  const links = useGraphStore((s) => s.links);
  const { incoming, outgoing } = useMemo(() => {
    const inc: Link[] = [];
    const out: Link[] = [];
    for (const l of links.values()) {
      if (l.targetRequestId === detail.id) inc.push(l);
      if (l.sourceRequestId === detail.id) out.push(l);
    }
    return { incoming: inc, outgoing: out };
  }, [links, detail.id]);

  const overview: [string, string][] = [
    [
      t.detail.status,
      detail.failed ? t.detail.failed({ reason: detail.failureText ?? "" }) : `${detail.status ?? "—"} ${detail.statusText ?? ""}`,
    ],
    [t.detail.host, detail.host],
    [t.detail.type, detail.resourceType],
    ["Content-Type", detail.mimeType ?? "—"],
    [t.detail.duration, formatDuration(detail.durationMs)],
    [t.detail.responseSize, formatBytes(detail.responseSize)],
    [t.detail.date, formatDate(detail.startedAt)],
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-4 text-sm md:grid-cols-4">
        {overview.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <Tabs defaultValue="request">
        <TabsList>
          <TabsTrigger value="request">{t.detail.request}</TabsTrigger>
          <TabsTrigger value="response">{t.detail.response}</TabsTrigger>
          <TabsTrigger value="flows">{t.detail.flows({ count: incoming.length + outgoing.length })}</TabsTrigger>
        </TabsList>

        <TabsContent value="request" className="flex flex-col gap-6">
          <Section title={t.detail.queryParams({ count: detail.queryParams.length })}>
            <KeyValueTable rows={detail.queryParams} empty={t.detail.noParams} />
          </Section>
          <Section title={t.detail.headers({ count: detail.requestHeaders.length })}>
            <KeyValueTable rows={detail.requestHeaders} empty={t.detail.noHeaders} />
          </Section>
          <Section title={t.detail.body}>
            <BodyViewer body={detail.requestBody} encoding={detail.requestBody === null ? "none" : "utf8"} mimeType={null} size={null} />
          </Section>
        </TabsContent>

        <TabsContent value="response" className="flex flex-col gap-6">
          <Section title={t.detail.headers({ count: detail.responseHeaders.length })}>
            <KeyValueTable rows={detail.responseHeaders} empty={t.detail.noHeaders} />
          </Section>
          <Section title={t.detail.body}>
            <BodyViewer
              body={detail.responseBody}
              encoding={detail.responseBodyEncoding}
              mimeType={detail.mimeType}
              size={detail.responseSize}
            />
          </Section>
        </TabsContent>

        <TabsContent value="flows" className="grid gap-6 md:grid-cols-2">
          <FlowColumn title={t.detail.received} icon={<ArrowDownToLine className="size-4" />} links={incoming} side="source" />
          <FlowColumn title={t.detail.provided} icon={<ArrowUpFromLine className="size-4" />} links={outgoing} side="target" />
        </TabsContent>
      </Tabs>

      <CurlSnippet detail={detail} />
    </div>
  );
}

function CurlSnippet({ detail }: { detail: RequestDetail }) {
  const t = useT();
  const command = useMemo(
    () => toCurl({ method: detail.method, url: detail.url, headers: detail.requestHeaders, body: detail.requestBody }),
    [detail],
  );
  return (
    <Section
      title={t.detail.curl}
      actions={
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Terminal className="size-4" /> <CopyButton text={command} />
        </span>
      }
    >
      <pre dir="ltr" className="max-h-80 overflow-auto text-start rounded-md border border-border bg-card p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere] select-text">
        {command}
      </pre>
    </Section>
  );
}

function FlowColumn({
  title,
  icon,
  links,
  side,
}: {
  title: string;
  icon: ReactNode;
  links: Link[];
  side: "source" | "target";
}) {
  const t = useT();
  const requests = useGraphStore((s) => s.requests);
  const openRequest = useWorkspaceStore((s) => s.openRequest);
  return (
    <Section title={title} actions={icon}>
      {links.length === 0 && <p className="text-sm text-muted-foreground">{t.detail.noLinks}</p>}
      {links.map((l) => {
        const otherId = side === "source" ? l.sourceRequestId : l.targetRequestId;
        const other = otherId === null ? null : requests.get(otherId);
        return (
          <div key={l.id} className="min-w-0 rounded-md border border-border bg-card p-3 text-sm">
            {otherId === null ? (
              <p className="mb-2 font-medium text-sky-300">{t.detail.userInput}</p>
            ) : (
              <button
                type="button"
                title={other?.url ?? ""}
                className="group mb-2 flex w-full min-w-0 items-start gap-2 text-start"
                onClick={() => openRequest(otherId)}
              >
                {other ? (
                  <>
                    <MethodLabel method={other.method} className="mt-px shrink-0" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[11px] text-muted-foreground">{other.host}</span>
                      <span className="font-mono text-xs [overflow-wrap:anywhere] group-hover:underline">{other.path}</span>
                    </span>
                  </>
                ) : (
                  <span className="font-mono group-hover:underline">#{otherId}</span>
                )}
              </button>
            )}
            <VariableList variables={l.variables} />
          </div>
        );
      })}
    </Section>
  );
}
