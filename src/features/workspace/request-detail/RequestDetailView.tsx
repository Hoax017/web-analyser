import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Loader2, Terminal } from "lucide-react";

import { requestsApi } from "@/api";
import { MethodLabel, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toCurl } from "@/lib/curl";
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
          <ArrowLeft /> Revenir au graphique
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
      <span className="truncate font-mono text-sm select-text" title={detail.url}>
        {detail.url}
      </span>
      <CopyButton text={detail.url} />
      <StatusBadge status={detail.status} failed={detail.failed} className="ml-auto" />
    </div>
  );
}

function DetailBody({ detail }: { detail: RequestDetail }) {
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
    ["Statut", detail.failed ? `Échec : ${detail.failureText ?? ""}` : `${detail.status ?? "—"} ${detail.statusText ?? ""}`],
    ["Hôte", detail.host],
    ["Type", detail.resourceType],
    ["Content-Type", detail.mimeType ?? "—"],
    ["Durée", formatDuration(detail.durationMs)],
    ["Taille réponse", formatBytes(detail.responseSize)],
    ["Date", formatDate(detail.startedAt)],
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
          <TabsTrigger value="request">Requête</TabsTrigger>
          <TabsTrigger value="response">Réponse</TabsTrigger>
          <TabsTrigger value="flows">Flux de données ({incoming.length + outgoing.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="request" className="flex flex-col gap-6">
          <Section title={`Paramètres d'URL (${detail.queryParams.length})`}>
            <KeyValueTable rows={detail.queryParams} empty="Aucun paramètre" />
          </Section>
          <Section title={`En-têtes (${detail.requestHeaders.length})`}>
            <KeyValueTable rows={detail.requestHeaders} empty="Aucun en-tête" />
          </Section>
          <Section title="Corps">
            <BodyViewer body={detail.requestBody} encoding={detail.requestBody === null ? "none" : "utf8"} mimeType={null} size={null} />
          </Section>
        </TabsContent>

        <TabsContent value="response" className="flex flex-col gap-6">
          <Section title={`En-têtes (${detail.responseHeaders.length})`}>
            <KeyValueTable rows={detail.responseHeaders} empty="Aucun en-tête" />
          </Section>
          <Section title="Corps">
            <BodyViewer
              body={detail.responseBody}
              encoding={detail.responseBodyEncoding}
              mimeType={detail.mimeType}
              size={detail.responseSize}
            />
          </Section>
        </TabsContent>

        <TabsContent value="flows" className="grid gap-6 md:grid-cols-2">
          <FlowColumn title="Données reçues" icon={<ArrowDownToLine className="size-4" />} links={incoming} side="source" />
          <FlowColumn title="Données fournies" icon={<ArrowUpFromLine className="size-4" />} links={outgoing} side="target" />
        </TabsContent>
      </Tabs>

      <CurlSnippet detail={detail} />
    </div>
  );
}

function CurlSnippet({ detail }: { detail: RequestDetail }) {
  const command = useMemo(
    () => toCurl({ method: detail.method, url: detail.url, headers: detail.requestHeaders, body: detail.requestBody }),
    [detail],
  );
  return (
    <Section
      title="Reproduire avec curl (POSIX)"
      actions={
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Terminal className="size-4" /> <CopyButton text={command} />
        </span>
      }
    >
      <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere] select-text">
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
  const requests = useGraphStore((s) => s.requests);
  const openRequest = useWorkspaceStore((s) => s.openRequest);
  return (
    <Section title={title} actions={icon}>
      {links.length === 0 && <p className="text-sm text-muted-foreground">Aucun lien</p>}
      {links.map((l) => {
        const otherId = side === "source" ? l.sourceRequestId : l.targetRequestId;
        const other = otherId === null ? null : requests.get(otherId);
        return (
          <div key={l.id} className="min-w-0 rounded-md border border-border bg-card p-3 text-sm">
            {otherId === null ? (
              <p className="mb-2 font-medium text-sky-300">Saisie utilisateur</p>
            ) : (
              <button
                type="button"
                title={other?.url ?? ""}
                className="group mb-2 flex w-full min-w-0 items-start gap-2 text-left"
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
