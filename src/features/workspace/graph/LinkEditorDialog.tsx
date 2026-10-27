import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { graphApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { valueTypeLabel } from "@/lib/format";
import { errorMessage } from "@/lib/tauri";
import { useGraphStore, type LinkEditorState } from "@/stores/graphStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { VALUE_TYPES, type LinkVariable, type RequestId, type ValueType } from "@/types/domain";

function isValueType(value: string): value is ValueType {
  return (VALUE_TYPES as readonly string[]).includes(value);
}

function emptyVariable(fromUser: boolean): LinkVariable {
  return {
    name: "",
    targetName: "",
    valueType: "string",
    sourceLocation: fromUser ? "userInput" : "unknown",
    targetLocation: "unknown",
    sample: null,
  };
}

/** Create / edit / delete a link between two blocks. */
export function LinkEditorDialog() {
  const editor = useGraphStore((s) => s.editor);
  const closeEditor = useGraphStore((s) => s.closeEditor);
  const editorKey = editor
    ? editor.mode === "edit"
      ? `edit:${editor.link.id}`
      : `create:${editor.sourceRequestId ?? "user"}:${editor.targetRequestId}`
    : "closed";

  return (
    <Dialog open={editor !== null} onOpenChange={(open) => !open && closeEditor()}>
      <DialogContent className="max-w-2xl">
        {editor && <LinkEditorForm key={editorKey} editor={editor} onDone={closeEditor} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkEditorForm({ editor, onDone }: { editor: LinkEditorState; onDone: () => void }) {
  const projectId = useWorkspaceStore((s) => s.projectId);
  const requests = useGraphStore((s) => s.requests);
  const upsertLink = useGraphStore((s) => s.upsertLink);
  const removeLink = useGraphStore((s) => s.removeLink);

  const sourceId: RequestId | null = editor.mode === "edit" ? editor.link.sourceRequestId : editor.sourceRequestId;
  const targetId: RequestId = editor.mode === "edit" ? editor.link.targetRequestId : editor.targetRequestId;
  const fromUser = sourceId === null;

  const [variables, setVariables] = useState<LinkVariable[]>(() =>
    editor.mode === "edit" && editor.link.variables.length > 0
      ? editor.link.variables
      : [emptyVariable(fromUser)],
  );
  const [busy, setBusy] = useState(false);

  const label = (id: RequestId | null): string => {
    if (id === null) return "Utilisateur";
    const r = requests.get(id);
    return r ? `${r.method} ${r.path}` : `#${id}`;
  };

  const update = (index: number, patch: Partial<LinkVariable>) =>
    setVariables((vs) => vs.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const valid = variables.length > 0 && variables.every((v) => v.name.trim() !== "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || projectId === null) return;
    const cleaned = variables.map((v) => ({
      ...v,
      name: v.name.trim(),
      targetName: v.targetName.trim() || v.name.trim(),
    }));
    setBusy(true);
    try {
      const link =
        editor.mode === "edit"
          ? await graphApi.updateLink(editor.link.id, cleaned)
          : await graphApi.createLink({ projectId, sourceRequestId: sourceId, targetRequestId: targetId, variables: cleaned });
      upsertLink(link);
      toast.success(editor.mode === "edit" ? "Lien mis à jour" : "Lien créé");
      onDone();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (editor.mode !== "edit") return;
    setBusy(true);
    try {
      await graphApi.deleteLink(editor.link.id);
      removeLink(editor.link.id);
      toast.success("Lien supprimé");
      onDone();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{editor.mode === "edit" ? "Modifier le lien" : "Nouveau lien"}</DialogTitle>
        <DialogDescription className="font-mono">
          {label(sourceId)} → {label(targetId)}
        </DialogDescription>
      </DialogHeader>

      <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
        <div className="grid grid-cols-[1fr_1fr_130px_36px] gap-2 text-xs text-muted-foreground">
          <span>Variable (source)</span>
          <span>Nom côté cible</span>
          <span>Type</span>
          <span />
        </div>
        {variables.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_130px_36px] items-center gap-2">
            <Input value={v.name} placeholder="token" onChange={(e) => update(i, { name: e.target.value })} required />
            <Input
              value={v.targetName}
              placeholder={v.name || "authorization"}
              onChange={(e) => update(i, { targetName: e.target.value })}
            />
            <Select
              value={v.valueType}
              onChange={(e) => {
                const next = e.target.value;
                if (isValueType(next)) update(i, { valueType: next });
              }}
            >
              {VALUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {valueTypeLabel(t)}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Retirer la variable"
              disabled={variables.length === 1}
              onClick={() => setVariables((vs) => vs.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
            {v.sample !== null && (
              <p className="col-span-4 -mt-1 truncate font-mono text-[11px] text-muted-foreground" title={v.sample}>
                valeur observée : {v.sample}
              </p>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setVariables((vs) => [...vs, emptyVariable(fromUser)])}
        >
          <Plus /> Ajouter une variable
        </Button>
      </div>

      <DialogFooter className="justify-between sm:justify-between">
        {editor.mode === "edit" ? (
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
            <Trash2 /> Supprimer le lien
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Annuler
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            Enregistrer
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
