import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Copy, Loader2, PlugZap, Rocket, Save, XCircle } from "lucide-react";

import { settingsApi } from "@/api";
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
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { BrowserDefaults, BrowserMode, BrowserSettings } from "@/types/domain";

const MODES: readonly { mode: BrowserMode; title: string; description: string }[] = [
  {
    mode: "managed",
    title: "Chrome piloté",
    description: "L'application lance Chrome via Playwright avec un profil dédié.",
  },
  {
    mode: "attach",
    title: "Mon vrai Chrome",
    description: "Connexion à votre Chrome via le port de débogage (CDP), sans automatisation au lancement.",
  },
];

type Probe =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "ok"; version: string }
  | { state: "error"; message: string };

function debugPort(endpoint: string): string {
  try {
    return new URL(endpoint).port || "9222";
  } catch {
    return "9222";
  }
}

export function browserModeLabel(settings: BrowserSettings): string {
  return settings.mode === "managed" ? "Chrome piloté (profil dédié)" : `Mon Chrome · ${settings.cdpEndpoint}`;
}

/** Global browser configuration: managed Chrome vs. the user's own Chrome over CDP. */
export function BrowserSettingsDialog({
  trigger,
  onSaved,
}: {
  trigger: ReactNode;
  onSaved?: (settings: BrowserSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BrowserSettings | null>(null);
  const [defaults, setDefaults] = useState<BrowserDefaults | null>(null);
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([settingsApi.browser(), settingsApi.browserDefaults()])
      .then(([settings, defs]) => {
        setDraft(settings);
        setDefaults(defs);
        setProbe({ state: "idle" });
      })
      .catch((error: unknown) => toast.error(errorMessage(error)));
  }, [open]);

  const update = (patch: Partial<BrowserSettings>) => {
    setDraft((d) => (d === null ? d : { ...d, ...patch }));
    setProbe({ state: "idle" });
  };

  const runProbe = async (action: () => Promise<string>) => {
    setProbe({ state: "busy" });
    try {
      setProbe({ state: "ok", version: await action() });
    } catch (error: unknown) {
      setProbe({ state: "error", message: errorMessage(error) });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // This dialog can be nested in another form: React submit events bubble through portals.
    event.stopPropagation();
    if (draft === null) return;
    setSaving(true);
    try {
      const saved = await settingsApi.saveBrowser(draft);
      toast.success("Réglages du navigateur enregistrés");
      onSaved?.(saved);
      setOpen(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const chrome = draft?.chromePath ?? defaults?.chromePath ?? "chrome.exe";
  const profile = draft?.profileDir ?? defaults?.profileDir ?? "";
  const manualCommand = `"${chrome}" --remote-debugging-port=${debugPort(draft?.cdpEndpoint ?? "")} --user-data-dir="${profile}"`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Navigateur de capture</DialogTitle>
            <DialogDescription>
              Utilisé pour toutes les captures (création de projet et « Reprendre l'analyse »).
            </DialogDescription>
          </DialogHeader>

          {draft === null ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.mode}
                    type="button"
                    onClick={() => update({ mode: m.mode })}
                    className={cn(
                      "rounded-md border p-3 text-left text-sm transition-colors",
                      draft.mode === m.mode ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
                    )}
                  >
                    <p className="font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">{m.description}</p>
                  </button>
                ))}
              </div>

              {draft.mode === "attach" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="cdp-endpoint">Endpoint CDP</Label>
                    <Input
                      id="cdp-endpoint"
                      value={draft.cdpEndpoint}
                      onChange={(e) => update({ cdpEndpoint: e.target.value })}
                      placeholder="http://127.0.0.1:9222"
                    />
                  </div>

                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-primary"
                      checked={draft.autoLaunch}
                      onChange={(e) => update({ autoLaunch: e.target.checked })}
                    />
                    <span>
                      Ouvrir Chrome automatiquement en mode débogage s'il n'écoute pas déjà
                      <span className="block text-xs text-muted-foreground">
                        Sinon, lancez-le vous-même avec la commande ci-dessous.
                      </span>
                    </span>
                  </label>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="chrome-path">Exécutable Chrome</Label>
                    <Input
                      id="chrome-path"
                      value={draft.chromePath ?? ""}
                      onChange={(e) => update({ chromePath: e.target.value || null })}
                      placeholder={defaults?.chromePath ?? "Introuvable : indiquez le chemin de chrome.exe"}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="profile-dir">Dossier de profil</Label>
                    <Input
                      id="profile-dir"
                      value={draft.profileDir ?? ""}
                      onChange={(e) => update({ profileDir: e.target.value || null })}
                      placeholder={defaults?.profileDir ?? ""}
                    />
                    <p className="text-xs text-muted-foreground">
                      Sessions, cookies et extensions y sont conservés d'une capture à l'autre. Chrome (≥ 136) refuse le
                      débogage sur son profil par défaut « User Data » : utilisez un dossier dédié.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Lancement manuel</Label>
                    <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-2">
                      <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-muted-foreground">
                        {manualCommand}
                      </code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="iconSm"
                        title="Copier"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(manualCommand)
                            .then(() => toast.info("Commande copiée"))
                            .catch((error: unknown) => toast.error(errorMessage(error)))
                        }
                      >
                        <Copy />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={probe.state === "busy"}
                      onClick={() => void runProbe(() => settingsApi.testConnection(draft.cdpEndpoint))}
                    >
                      <PlugZap /> Tester la connexion
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={probe.state === "busy"}
                      title="Pratique pour vous connecter aux sites avant de lancer la capture"
                      onClick={() => void runProbe(() => settingsApi.openDebugBrowser(draft))}
                    >
                      <Rocket /> Ouvrir Chrome maintenant
                    </Button>
                    <ProbeResult probe={probe} />
                  </div>
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="submit" disabled={saving || draft === null}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProbeResult({ probe }: { probe: Probe }) {
  switch (probe.state) {
    case "idle":
      return null;
    case "busy":
      return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
    case "ok":
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="size-4" /> {probe.version}
        </span>
      );
    case "error":
      return (
        <span className="flex basis-full items-start gap-1 text-xs text-red-300">
          <XCircle className="mt-px size-4 shrink-0" /> {probe.message}
        </span>
      );
  }
}
