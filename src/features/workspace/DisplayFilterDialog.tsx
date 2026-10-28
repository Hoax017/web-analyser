import { useEffect, useState } from "react";
import { Filter, Plus } from "lucide-react";

import { projectsApi } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/tauri";
import { useGraphStore } from "@/stores/graphStore";
import { useRequestListStore } from "@/stores/requestListStore";
import type { ProjectId } from "@/types/domain";

const PRESETS: readonly string[] = ["*.js", "*.css", "*.map", "*.svg", "*.png", "*.woff2", "/_nuxt/*", "/_next/*"];

function parsePatterns(text: string): string[] {
  return [...new Set(text.split("\n").map((l) => l.trim()).filter((l) => l !== ""))];
}

/** Edits the display-only exclusion globs of a project, then reloads list and graph. */
export function DisplayFilterDialog({ projectId }: { projectId: ProjectId }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .hiddenPatterns(projectId)
      .then((patterns) => !cancelled && setActive(patterns))
      .catch((error: unknown) => toast.error(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const onOpenChange = (next: boolean) => {
    if (next) setText(active.join("\n"));
    setOpen(next);
  };

  const addPreset = (preset: string) => {
    const current = parsePatterns(text);
    if (!current.includes(preset)) setText([...current, preset].join("\n"));
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await projectsApi.setHiddenPatterns(projectId, parsePatterns(text));
      setActive(saved);
      setOpen(false);
      useRequestListStore.getState().reset(projectId);
      await useGraphStore.getState().load(projectId);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t.filters.title} className="relative">
          <Filter />
          {active.length > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {active.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.filters.title}</DialogTitle>
          <DialogDescription>
            {t.filters.description} <code>*</code> {t.filters.wildcards} <code>?</code> {t.filters.singleChar}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="hidden-patterns">{t.filters.patterns}</Label>
          <textarea
            id="hidden-patterns"
            dir="ltr"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={"/_nuxt/*.js\n*.css\n*://www.google-analytics.com/*"}
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <Button key={preset} variant="outline" size="sm" className="h-7 font-mono text-xs" onClick={() => addPreset(preset)}>
                <Plus /> {preset}
              </Button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button disabled={busy} onClick={() => void save()}>
            {t.common.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
