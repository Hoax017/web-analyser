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
import { messages, useT } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { errorMessage } from "@/lib/tauri";
import { useCaptureStore } from "@/stores/captureStore";
import { useGraphStore } from "@/stores/graphStore";
import { useRequestListStore } from "@/stores/requestListStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Project } from "@/types/domain";

import { DisplayFilterDialog } from "./DisplayFilterDialog";

export function TopBar({ project, onHome }: { project: Project; onHome: () => void }) {
  const t = useT();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
      <Button variant="secondary" onClick={onHome}>
        <Home /> {t.topBar.home}
      </Button>
      <span className="max-w-48 truncate text-sm font-semibold" title={project.name}>
        {project.name}
      </span>
      <GlobalSearch />
      <DisplayFilterDialog projectId={project.id} />
      <RecomputeButton project={project} />
      <BrowserSettingsDialog
        trigger={
          <Button variant="ghost" size="icon" title={t.home.browserButtonTitle}>
            <Settings />
          </Button>
        }
      />
      <CaptureControls project={project} />
    </header>
  );
}

function GlobalSearch() {
  const t = useT();
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
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t.topBar.searchPlaceholder}
        className="ps-9 pe-9"
      />
      {value && (
        <button
          type="button"
          aria-label={t.common.clear}
          onClick={() => setValue("")}
          className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
      <label
        className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        title={t.topBar.filterGraphTitle}
      >
        <input
          type="checkbox"
          className="accent-primary"
          checked={graphFilter}
          onChange={(e) => setGraphFilter(e.target.checked)}
        />
        {t.topBar.filterGraph}
      </label>
    </div>
  );
}

function RecomputeButton({ project }: { project: Project }) {
  const t = useT();
  const status = useCaptureStore((s) => s.status);
  const [busy, setBusy] = useState(false);
  const capturingHere = status.state !== "idle" && status.projectId === project.id;

  const run = async () => {
    setBusy(true);
    try {
      useGraphStore.getState().applyGraph(await graphApi.recompute(project.id));
      toast.success(messages().topBar.recomputeDone);
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
      title={capturingHere ? t.topBar.recomputeBlocked : t.topBar.recompute}
      disabled={busy || capturingHere}
      onClick={() => void run()}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
    </Button>
  );
}

function CaptureControls({ project }: { project: Project }) {
  const t = useT();
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
      <Button disabled title={t.topBar.captureBusyTitle}>
        <Play /> {t.topBar.captureBusy}
      </Button>
    );
  } else if (status.state === "starting") {
    primary = (
      <Button disabled>
        <Loader2 className="animate-spin" /> {t.topBar.starting}
      </Button>
    );
  } else if (status.state === "running") {
    primary = (
      <Button variant="secondary" disabled={busy} onClick={() => void act(captureApi.pause)}>
        <Pause /> {t.topBar.pause}
      </Button>
    );
  } else if (status.state === "paused") {
    primary = (
      <Button disabled={busy} onClick={() => void act(captureApi.resume)}>
        <Play /> {t.topBar.resume}
      </Button>
    );
  } else {
    primary = (
      <Button disabled={busy} onClick={() => void start()}>
        <Play /> {t.topBar.resume}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isHere && status.state !== "idle" && (
        <>
          <Badge tone={status.state === "running" ? "success" : "pending"} title={status.browserVersion ?? undefined}>
            {status.state === "running" ? t.topBar.recording : status.state === "paused" ? t.topBar.paused : "…"} · {formatNumber(status.captured)}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            title={t.topBar.stop}
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
