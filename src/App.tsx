import { useCallback, useState } from "react";

import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HomePage } from "@/features/home/HomePage";
import { WorkspacePage } from "@/features/workspace/WorkspacePage";
import { useCaptureStatusSync } from "@/hooks/useCaptureEvents";
import type { ProjectId } from "@/types/domain";

type Route = { page: "home" } | { page: "workspace"; projectId: ProjectId };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "home" });
  const goHome = useCallback(() => setRoute({ page: "home" }), []);
  const openProject = useCallback((projectId: ProjectId) => setRoute({ page: "workspace", projectId }), []);

  useCaptureStatusSync();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        {route.page === "home" ? (
          <HomePage onOpen={openProject} />
        ) : (
          <WorkspacePage key={route.projectId} projectId={route.projectId} onHome={goHome} />
        )}
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
