import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { projectsApi } from "@/api";
import { toast } from "@/components/ui/toast";
import { useLiveExchanges } from "@/hooks/useCaptureEvents";
import { errorMessage } from "@/lib/tauri";
import { useGraphStore } from "@/stores/graphStore";
import { useRequestListStore } from "@/stores/requestListStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Project, ProjectId } from "@/types/domain";

import { GraphCanvas } from "./graph/GraphCanvas";
import { RequestDetailView } from "./request-detail/RequestDetailView";
import { RequestList } from "./request-list/RequestList";
import { ResizableSidebar } from "./ResizableSidebar";
import { TopBar } from "./TopBar";

export function WorkspacePage({ projectId, onHome }: { projectId: ProjectId; onHome: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const view = useWorkspaceStore((s) => s.view);

  useLiveExchanges();

  useEffect(() => {
    useWorkspaceStore.getState().enter(projectId);
    useRequestListStore.getState().reset(projectId);
    useGraphStore
      .getState()
      .load(projectId)
      .catch((error: unknown) => toast.error(errorMessage(error)));
    projectsApi
      .get(projectId)
      .then(setProject)
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        onHome();
      });
  }, [projectId, onHome]);

  if (!project) {
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar project={project} onHome={onHome} />
      <div className="flex min-h-0 flex-1">
        <ResizableSidebar>
          <RequestList />
        </ResizableSidebar>
        <main className="relative min-w-0 flex-1">
          {/* The graph stays mounted to preserve viewport and layout. */}
          <GraphCanvas />
          {view.kind === "request" && (
            <div className="absolute inset-0 z-10 bg-background">
              <RequestDetailView requestId={view.requestId} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
