import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2, Network, Settings, Trash2 } from "lucide-react";

import { projectsApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { BrowserSettingsDialog } from "@/features/settings/BrowserSettingsDialog";
import { LanguageSelect } from "@/features/settings/LanguageSelect";
import { messages, plural, useT } from "@/i18n";
import { formatDate } from "@/lib/format";
import { errorMessage } from "@/lib/tauri";
import type { Project, ProjectId } from "@/types/domain";

import { NewProjectDialog } from "./NewProjectDialog";

export function HomePage({ onOpen }: { onOpen: (projectId: ProjectId) => void }) {
  const t = useT();
  const [projects, setProjects] = useState<Project[] | null>(null);

  const refresh = useCallback(() => {
    projectsApi
      .list()
      .then(setProjects)
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        setProjects([]);
      });
  }, []);

  useEffect(refresh, [refresh]);

  const remove = async (project: Project) => {
    const m = messages();
    if (!window.confirm(m.home.confirmDelete({ name: project.name, requests: plural(m.home.requestCount, project.requestCount) }))) return;
    try {
      await projectsApi.remove(project.id);
      refresh();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-center gap-3">
        <Network className="size-7 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Web Analyser</h1>
          <p className="text-sm text-muted-foreground">{t.home.tagline}</p>
        </div>
        <LanguageSelect />
        <BrowserSettingsDialog
          trigger={
            <Button variant="outline" title={t.home.browserButtonTitle}>
              <Settings /> {t.home.browserButton}
            </Button>
          }
        />
        <NewProjectDialog onCreated={(p) => onOpen(p.id)} />
      </header>

      {projects === null ? (
        <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" />
      ) : projects.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
          <FolderOpen className="size-10 opacity-40" />
          <p>{t.home.empty}</p>
        </Card>
      ) : (
        <ul className="grid gap-3 overflow-y-auto sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Card
                role="button"
                tabIndex={0}
                onClick={() => onOpen(p.id)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(p.id)}
                className="group flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.startUrl ?? t.home.noStartUrl}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t.home.projectMeta({ requests: plural(t.home.requestCount, p.requestCount), date: formatDate(p.updatedAt) })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={t.home.deleteProject}
                  className="opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(p);
                  }}
                >
                  <Trash2 />
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
