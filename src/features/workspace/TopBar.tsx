import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Home, Loader2, Pause, Play, Search, Settings, Square, Wand2, X } from "lucide-react";

import { captureApi, graphApi } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { BrowserSettingsDialog } from "@/features/settings/BrowserSettingsDialog";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { errorMessage } from "@/lib/tauri";
import { useCaptureStore } from "@/stores/captureStore";
import { useGraphStore } from "@/stores/graphStore";
import { useRequestListStore } from "@/stores/requestListStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Project } from "@/types/domain";

import { DisplayFilterDialog } from "./DisplayFilterDialog";

export function TopBar({ project, onHome }: { project: Project; onHome: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
      <Button variant="secondary" onClick={onHome}>
        <Home /> Accueil
      </Button>
      <span className="max-w-48 truncate text-sm font-semibold" title={project.name}>
        {project.name}
      </span>
      <GlobalSearch />
      <DisplayFilterDialog projectId={project.id} />
      <RecomputeButton project={project} />
      <BrowserSettingsDialog
        trigger={
          <Button variant="ghost" size="icon" title="Réglages du navigateur de capture">
            <Settings />
          </Button>
        }
      />
      <CaptureControls project={project} />
    </header>
  );
}

function GlobalSearch() {
  const setQuery = useRequestListStore((s) => s.setQuery);
  const currentQuery = useRequestListStore((s) => s.query);
  const [value, setValue] = useState(currentQuery);
  const graphFilter = useWorkspaceStore((s) => s.graphSearchFilter);
  const setGraphFilter = useWorkspaceStore((s) => s.setGraphSearchFilter);
  const debounced = useDebouncedValue(value, 250);

  useEffect(() => {
    if (debounced !== useRequestListStore.getState().query) setQuery(debounced);
  }, [debounced, setQuery]);

  return (
    <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Rechercher dans les URLs, les valeurs de requête et de réponse…"
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          aria-label="Effacer"
          onClick={() => setValue("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
      <label
        className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        title="Masquer dans le graphique les blocs qui ne correspondent pas à la recherche"
      >
        <input
          type="checkbox"
          className="accent-primary"
          checked={graphFilter}
          onChange={(e) => setGraphFilter(e.target.checked)}
        />
        Filtrer le graphe
      </label>
    </div>
  );
}

function RecomputeButton({ project }: { project: Project }) {
  const status = useCaptureStore((s) => s.status);
  const [busy, setBusy] = useState(false);
  const capturingHere = status.state !== "idle" && status.projectId === project.id;

  const run = async () => {
    setBusy(true);
    try {
      useGraphStore.getState().applyGraph(await graphApi.recompute(project.id));
      toast.success("Analyse des liens terminée");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      title={capturingHere ? "Arrêtez la capture pour relancer l'analyse" : "Relancer la détection des liens"}
      disabled={busy || capturingHere}
      onClick={() => void run()}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
    </Button>
  );
}

function CaptureControls({ project }: { project: Project }) {
  const status = useCaptureStore((s) => s.status);
  const [busy, setBusy] = useState(false);
  const isHere = status.projectId === project.id;
  const elsewhere = status.state !== "idle" && !isHere;

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const start = () => act(() => captureApi.start(project.id));

  let primary: ReactNode;
  if (elsewhere) {
    primary = (
      <Button disabled title="Une capture est active sur un autre projet">
        <Play /> Capture occupée
      </Button>
    );
  } else if (status.state === "starting") {
    primary = (
      <Button disabled>
        <Loader2 className="animate-spin" /> Démarrage…
      </Button>
    );
  } else if (status.state === "running") {
    primary = (
      <Button variant="secondary" disabled={busy} onClick={() => void act(captureApi.pause)}>
        <Pause /> Mettre en pause
      </Button>
    );
  } else if (status.state === "paused") {
    primary = (
      <Button disabled={busy} onClick={() => void act(captureApi.resume)}>
        <Play /> Reprendre l'analyse
      </Button>
    );
  } else {
    primary = (
      <Button disabled={busy} onClick={() => void start()}>
        <Play /> Reprendre l'analyse
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isHere && status.state !== "idle" && (
        <>
          <Badge tone={status.state === "running" ? "success" : "pending"} title={status.browserVersion ?? undefined}>
            {status.state === "running" ? "● REC" : status.state === "paused" ? "PAUSE" : "…"} · {status.captured}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            title="Arrêter la capture (un Chrome connecté reste ouvert)"
            disabled={busy}
            onClick={() => void act(captureApi.stop)}
          >
            <Square />
          </Button>
        </>
      )}
      {primary}
    </div>
  );
}
