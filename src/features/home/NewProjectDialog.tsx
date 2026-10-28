import { useEffect, useState, type FormEvent } from "react";
import { Plus, Settings } from "lucide-react";

import { captureApi, projectsApi, settingsApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { BrowserSettingsDialog, browserModeLabel } from "@/features/settings/BrowserSettingsDialog";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/tauri";
import type { BrowserSettings, Project } from "@/types/domain";

/** Creates a project and immediately starts a capture session with the configured browser. */
export function NewProjectDialog({ onCreated }: { onCreated: (project: Project) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startUrl, setStartUrl] = useState("https://");
  const [browser, setBrowser] = useState<BrowserSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    settingsApi
      .browser()
      .then(setBrowser)
      .catch((error: unknown) => toast.error(errorMessage(error)));
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const url = startUrl.trim() === "https://" ? "" : startUrl.trim();
      const project = await projectsApi.create({ name, startUrl: url || null });
      try {
        await captureApi.start(project.id);
      } catch (error: unknown) {
        // The project exists: open it anyway, capture can be restarted from the workspace.
        toast.error(errorMessage(error));
      }
      setOpen(false);
      onCreated(project);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> {t.newProject.button}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t.newProject.title}</DialogTitle>
            <DialogDescription>{t.newProject.description}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">{t.newProject.name}</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.newProject.namePlaceholder} required autoFocus />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="start-url">{t.newProject.startUrl}</Label>
            <Input id="start-url" dir="ltr" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} />
          </div>

          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t.newProject.browser}</span>
            <span className="min-w-0 flex-1 truncate">{browser === null ? "…" : browserModeLabel(browser, t)}</span>
            <BrowserSettingsDialog
              onSaved={setBrowser}
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  <Settings /> {t.common.edit}
                </Button>
              }
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy || name.trim() === ""}>
              {browser?.mode === "attach" ? t.newProject.submitAttach : t.newProject.submitManaged}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
