"use client";

import { useActionState, useState, useTransition } from "react";
import { importRecipe, saveRecipe, type ImportState, type RecipeInput } from "../actions";
import { CATEGORIES, UNITS, type Ingredient } from "@/lib/types";

type Line = RecipeInput["ingredients"][number] & { key: string };

const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  name: "",
  quantity: null,
  unit: "g",
  category: "other",
  note: null,
  optional: false,
});

export function RecipeEditor({
  initial,
  catalog,
  aiEnabled = false,
}: {
  initial?: RecipeInput;
  catalog: Ingredient[];
  aiEnabled?: boolean;
}) {
  const [recipe, setRecipe] = useState<Omit<RecipeInput, "ingredients">>(
    initial ?? { title: "", servings: 4, prep_minutes: null, freezable: false, instructions: "", source_url: null, notes: null },
  );
  const [lines, setLines] = useState<Line[]>(
    initial?.ingredients.map((i) => ({ ...i, key: crypto.randomUUID() })) ?? [blankLine()],
  );
  const [importState, importAction, importing] = useActionState<ImportState, FormData>(importRecipe, {});
  const [saveError, setSaveError] = useState<string>();
  const [saving, startSaving] = useTransition();

  // When Claude returns a parsed recipe, load it into the form for review.
  const [loadedNonce, setLoadedNonce] = useState<number>();
  if (importState.recipe && importState.nonce !== loadedNonce) {
    const parsed = importState.recipe;
    setLoadedNonce(importState.nonce);
    setRecipe((r) => ({
      ...r,
      title: parsed.title,
      servings: parsed.servings,
      prep_minutes: parsed.prep_minutes,
      freezable: parsed.freezable,
      instructions: parsed.instructions,
    }));
    setLines(parsed.ingredients.map((i) => ({ ...i, key: crypto.randomUUID() })));
  }

  const byName = new Map(catalog.map((i) => [i.name.toLowerCase(), i]));

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // Picking an existing ingredient locks in its unit and category.
        const known = patch.name !== undefined ? byName.get(patch.name.trim().toLowerCase()) : undefined;
        return known ? { ...next, unit: known.unit, category: known.category } : next;
      }),
    );
  }

  function save() {
    setSaveError(undefined);
    startSaving(async () => {
      const result = await saveRecipe({ ...recipe, id: initial?.id, ingredients: lines });
      if (result?.error) setSaveError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {!initial?.id && aiEnabled && (
        <form action={importAction} className="card flex flex-col gap-3" onSubmit={shrinkPhoto}>
          <div>
            <h2 className="font-semibold">✨ Import with Claude</h2>
            <p className="text-sm text-muted">Paste a link, the recipe text, or snap a photo of a cookbook page. You can review before saving.</p>
          </div>
          <input className="input" name="url" type="url" placeholder="https://…" onChange={(e) => setRecipe((r) => ({ ...r, source_url: e.target.value || null }))} />
          <textarea className="input" name="text" rows={3} placeholder="…or paste recipe text" />
          <input className="text-sm" name="photo" type="file" accept="image/*" capture="environment" />
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={importing}>{importing ? "Reading recipe…" : "Import"}</button>
            {importState.error && <span className="text-sm text-danger">{importState.error}</span>}
            {importState.recipe && !importing && <span className="text-sm text-accent">Imported — review below.</span>}
          </div>
        </form>
      )}

      <div className="card flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input className="input" id="title" value={recipe.title} onChange={(e) => setRecipe({ ...recipe, title: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="servings">Servings</label>
            <input className="input" id="servings" type="number" min="1" value={recipe.servings ?? ""} onChange={(e) => setRecipe({ ...recipe, servings: e.target.value ? Number(e.target.value) : null })} />
          </div>
          <div>
            <label className="label" htmlFor="prep">Minutes</label>
            <input className="input" id="prep" type="number" min="0" value={recipe.prep_minutes ?? ""} onChange={(e) => setRecipe({ ...recipe, prep_minutes: e.target.value ? Number(e.target.value) : null })} />
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={recipe.freezable} onChange={(e) => setRecipe({ ...recipe, freezable: e.target.checked })} />
          Freezes well
        </label>
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="font-semibold">Ingredients</h2>
        <datalist id="catalog">
          {catalog.map((i) => <option key={i.id} value={i.name} />)}
        </datalist>
        {lines.map((l) => {
          const known = byName.get(l.name.trim().toLowerCase());
          return (
            <div key={l.key} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-2 border-b border-border pb-3 last:border-0">
              <input className="input" list="catalog" placeholder="Ingredient" value={l.name} onChange={(e) => updateLine(l.key, { name: e.target.value })} />
              <input className="input" type="number" step="any" min="0" placeholder="qty" value={l.quantity ?? ""} onChange={(e) => updateLine(l.key, { quantity: e.target.value ? Number(e.target.value) : null })} />
              <select className="input px-1" value={l.unit} disabled={!!known} onChange={(e) => updateLine(l.key, { unit: e.target.value })}>
                {[...new Set([l.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}
              </select>
              <button type="button" className="btn px-2 text-muted" aria-label="Remove ingredient" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>✕</button>
              <input className="input col-span-2 py-1 text-sm" placeholder="note (e.g. diced)" value={l.note ?? ""} onChange={(e) => updateLine(l.key, { note: e.target.value || null })} />
              <div className="col-span-2 flex items-center gap-2 text-sm">
                {!known && l.name.trim() && (
                  <select className="input py-1 text-sm" value={l.category} onChange={(e) => updateLine(l.key, { category: e.target.value })} aria-label="Category">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                )}
                <label className="flex shrink-0 items-center gap-1 text-muted">
                  <input type="checkbox" checked={l.optional} onChange={(e) => updateLine(l.key, { optional: e.target.checked })} />
                  optional
                </label>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn-ghost" onClick={() => setLines([...lines, blankLine()])}>+ Ingredient</button>
      </div>

      <div className="card flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="instructions">Method</label>
          <textarea className="input" id="instructions" rows={8} value={recipe.instructions} onChange={(e) => setRecipe({ ...recipe, instructions: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <textarea className="input" id="notes" rows={2} value={recipe.notes ?? ""} onChange={(e) => setRecipe({ ...recipe, notes: e.target.value || null })} />
        </div>
      </div>

      <div className="sticky bottom-20 flex items-center gap-3 md:bottom-4">
        <button className="btn-primary shadow-lg" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save recipe"}</button>
        {saveError && <span className="text-sm text-danger">{saveError}</span>}
      </div>
    </div>
  );
}

/** Downscale phone photos before upload so they fit the server action body limit. */
function shrinkPhoto(e: React.FormEvent<HTMLFormElement>) {
  const input = e.currentTarget.elements.namedItem("photo") as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || file.size < 1_500_000) return;

  e.preventDefault();
  const form = e.currentTarget;
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        URL.revokeObjectURL(img.src);
        if (!blob) return;
        const dt = new DataTransfer();
        dt.items.add(new File([blob], "photo.jpg", { type: "image/jpeg" }));
        input.files = dt.files;
        form.requestSubmit();
      },
      "image/jpeg",
      0.85,
    );
  };
  img.src = URL.createObjectURL(file);
}
