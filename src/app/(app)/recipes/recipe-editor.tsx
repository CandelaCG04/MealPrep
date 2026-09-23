"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { importRecipe, saveRecipe, type ImportState, type RecipeInput } from "../actions";
import { CATEGORIES, UNITS, categoryLabel, ingredientFactor, unitLabel, type Conversion, type Ingredient } from "@/lib/types";
import { UnitHint } from "./unit-hint";
import { fmtMinutes } from "@/lib/dates";
import { IngredientInput } from "@/components/ingredient-input";
import { DragGrip, SortableList } from "@/components/sortable-list";
import { amountToken } from "@/lib/steps";

type Line = RecipeInput["ingredients"][number] & { key: string };
type Step = { key: string; text: string };
type Details = Omit<RecipeInput, "ingredients" | "steps">;

const newKey = () => crypto.randomUUID();
const blankLine = (): Line => ({ key: newKey(), name: "", quantity: null, unit: "g", category: "other", note: null, optional: false });
const toSteps = (texts: string[]): Step[] => (texts.length ? texts : [""]).map((text) => ({ key: newKey(), text }));

/** "1. Chop onions\n2) Fry" -> ["Chop onions", "Fry"] */
function splitSteps(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^(\d+\s*[.):-]|[-*•])\s*/, ""))
    .filter(Boolean);
}

export function RecipeEditor({
  initial,
  catalog,
  aiEnabled = false,
  conversions: initialConversions = [],
}: {
  initial?: RecipeInput;
  catalog: Ingredient[];
  conversions?: Conversion[];
  aiEnabled?: boolean;
}) {
  const [recipe, setRecipe] = useState<Details>(
    initial ?? { title: "", servings: 4, prep_minutes: null, cook_minutes: null, freezable: false, source_url: null, notes: null },
  );
  const [lines, setLines] = useState<Line[]>(initial?.ingredients.map((i) => ({ ...i, key: newKey() })) ?? [blankLine()]);
  const [steps, setSteps] = useState<Step[]>(toSteps(initial?.steps ?? []));
  const [importState, importAction, importing] = useActionState<ImportState, FormData>(importRecipe, {});
  const [saveError, setSaveError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const [conversions, setConversions] = useState(initialConversions);

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
      cook_minutes: parsed.cook_minutes,
      freezable: parsed.freezable,
    }));
    setLines(parsed.ingredients.map((i) => ({ ...i, key: newKey() })));
    setSteps(toSteps(parsed.steps));
  }

  const byName = new Map(catalog.map((i) => [i.name.toLowerCase(), i]));

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // Picking an existing ingredient: adopt its category, and its unit unless the
        // current unit converts to it (keep "tbsp" for oil stored in l).
        const known = patch.name !== undefined ? byName.get(patch.name.trim().toLowerCase()) : undefined;
        if (!known) return next;
        const own = conversions.filter((c) => c.ingredient_id === known.id);
        const keepUnit = l.name.trim() !== "" && ingredientFactor(own, next.unit, known.unit).factor !== null;
        return { ...next, category: known.category, unit: keepUnit ? next.unit : known.unit };
      }),
    );
  }

  function save() {
    setSaveError(undefined);
    startSaving(async () => {
      try {
        const result = await saveRecipe({ ...recipe, id: initial?.id, ingredients: lines, steps: steps.map((s) => s.text) });
        if (result?.error) setSaveError(result.error);
      } catch {
        setSaveError("Couldn't reach the server — check your connection. Your edits are still here; try saving again.");
      }
    });
  }

  const total = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);

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

      {/* Details */}
      <div className="card flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input className="input" id="title" value={recipe.title} onChange={(e) => setRecipe({ ...recipe, title: e.target.value })} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <NumberField id="servings" label="Portions" min={1} value={recipe.servings} onChange={(servings) => setRecipe({ ...recipe, servings })} />
          <NumberField id="prep" label="Prep (min)" value={recipe.prep_minutes} onChange={(prep_minutes) => setRecipe({ ...recipe, prep_minutes })} />
          <NumberField id="cook" label="Cook (min)" value={recipe.cook_minutes} onChange={(cook_minutes) => setRecipe({ ...recipe, cook_minutes })} />
        </div>
        {total > 0 && <p className="-mt-1 text-sm text-muted">⏱ Total {fmtMinutes(total)}</p>}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={recipe.freezable} onChange={(e) => setRecipe({ ...recipe, freezable: e.target.checked })} />
          Freezes well
        </label>
      </div>

      {/* Ingredients */}
      <div className="card flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Ingredients</h2>
          {lines.length > 1 && <p className="text-xs text-muted">Drag ⠿ to reorder</p>}
        </div>
        <SortableList
          id="recipe-ingredients"
          items={lines}
          onReorder={setLines}
          className="flex flex-col"
          itemClassName="border-b border-border py-3 first:pt-0 last:border-0"
          renderItem={(l, index, handle) => {
            const known = byName.get(l.name.trim().toLowerCase());
            return (
            <div className="flex gap-2">
              <DragGrip {...handle} label={`Drag ingredient ${index + 1}${l.name ? ` (${l.name})` : ""}`} className="h-9 w-7" />

              <div className="grid flex-1 grid-cols-[1fr_4.5rem_5.5rem] items-start gap-2">
                <IngredientInput catalog={catalog} value={l.name} onChange={(name) => updateLine(l.key, { name })} />
                <input className="input px-2" type="number" step="any" min="0" placeholder="qty" aria-label="Amount" value={l.quantity ?? ""} onChange={(e) => updateLine(l.key, { quantity: e.target.value ? Number(e.target.value) : null })} />
                <select className="input px-1" value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} aria-label="Unit">
                  {[...new Set([l.unit, ...UNITS])].map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select>

                {known && known.unit !== l.unit && (
                  <UnitHint
                    key={`${known.id}-${l.unit}`}
                    ingredient={known}
                    unit={l.unit}
                    quantity={l.quantity}
                    conversions={conversions}
                    onChange={setConversions}
                  />
                )}

                <input className="input col-span-2 py-1 text-sm" placeholder="note (e.g. diced)" value={l.note ?? ""} onChange={(e) => updateLine(l.key, { note: e.target.value || null })} />
                <label className="flex items-center gap-1 text-sm text-muted">
                  <input type="checkbox" checked={l.optional} onChange={(e) => updateLine(l.key, { optional: e.target.checked })} />
                  optional
                </label>
                {!known && l.name.trim() && (
                  <select className="input col-span-3 py-1 text-sm" value={l.category} onChange={(e) => updateLine(l.key, { category: e.target.value })} aria-label="Category">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                  </select>
                )}
              </div>

              <button type="button" className="btn h-9 w-7 p-0 text-muted" aria-label="Remove ingredient" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>
            </div>
            );
          }}
        />
        <button type="button" className="btn-ghost" onClick={() => setLines([...lines, blankLine()])}>+ Ingredient</button>
      </div>

      {/* Steps */}
      <StepsEditor steps={steps} setSteps={setSteps} ingredientNames={lines.map((l) => l.name.trim()).filter(Boolean)} />

      <div className="card">
        <label className="label" htmlFor="notes">Notes</label>
        <textarea className="input" id="notes" rows={2} value={recipe.notes ?? ""} onChange={(e) => setRecipe({ ...recipe, notes: e.target.value || null })} />
      </div>

      <div className="sticky bottom-20 flex items-center gap-3 md:bottom-4">
        <button className="btn-primary shadow-lg" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save recipe"}</button>
        {saveError && <span className="text-sm text-danger">{saveError}</span>}
      </div>
    </div>
  );
}

function NumberField({ id, label, value, onChange, min = 0 }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; min?: number }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input className="input" id={id} type="number" inputMode="numeric" min={min} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} />
    </div>
  );
}

function StepsEditor({ steps, setSteps, ingredientNames }: { steps: Step[]; setSteps: (s: Step[]) => void; ingredientNames: string[] }) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const [focused, setFocused] = useState<string | null>(null);
  // One-shot: which step to focus after the next render (set when adding/removing steps).
  // Cleared once used, so typing in any step never moves the cursor.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const el = refs.current.get(key);
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  });

  const update = (key: string, text: string) => setSteps(steps.map((s) => (s.key === key ? { ...s, text } : s)));

  function insertAfter(index: number, texts: string[]) {
    const added = texts.map((text) => ({ key: newKey(), text }));
    setSteps([...steps.slice(0, index + 1), ...added, ...steps.slice(index + 1)]);
    pendingFocus.current = added[added.length - 1].key;
  }

  /** Drops "{{Ingredient}}" into a step at the cursor; it becomes the scaled amount on the recipe page. */
  function insertAmount(stepKey: string, ingredient: string) {
    const el = refs.current.get(stepKey);
    if (!el) return;
    el.focus();
    const token = amountToken(ingredient);
    // execCommand keeps the caret and the browser's undo history; fall back to a plain splice.
    if (!document.execCommand?.("insertText", false, token)) {
      const { selectionStart: from, selectionEnd: to, value } = el;
      const text = value.slice(0, from) + token + value.slice(to);
      setSteps(steps.map((x) => (x.key === stepKey ? { ...x, text } : x)));
      requestAnimationFrame(() => el.setSelectionRange(from + token.length, from + token.length));
    }
  }

  function remove(index: number) {
    if (steps.length === 1) return setSteps([{ ...steps[0], text: "" }]);
    setSteps(steps.filter((_, i) => i !== index));
    pendingFocus.current = steps[Math.max(0, index - 1)].key;
  }

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">Steps</h2>
        <p className="text-xs text-muted">
          Enter starts a new step · Shift+Enter for a line break · pasting a whole method splits it into steps
          {steps.length > 1 && " · drag ⠿ to reorder"}
        </p>
        {ingredientNames.length > 0 && (
          <p className="text-xs text-muted">
            Tap an ingredient below a step to drop in its amount and name (e.g. 60 ml soy sauce) — it follows the portions on the recipe page.
          </p>
        )}
      </div>
      <SortableList
        id="recipe-steps"
        as="ol"
        items={steps}
        onReorder={setSteps}
        className="flex flex-col gap-2"
        itemClassName="flex flex-wrap items-start gap-1.5"
        renderItem={(s, index, handle) => (
          <>
            <DragGrip {...handle} label={`Drag step ${index + 1}`} className="mt-1 h-8 w-6" />
            <span className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {index + 1}
            </span>
            <textarea
              ref={(el) => {
                if (!el) return void refs.current.delete(s.key);
                refs.current.set(s.key, el);
                autoGrow(el);
              }}
              onInput={(e) => autoGrow(e.currentTarget)}
              onFocus={() => setFocused(s.key)}
              className="input min-h-10 resize-none [field-sizing:content]"
              rows={1}
              placeholder={index === 0 ? "e.g. Preheat the oven to 200°C" : "Next step"}
              value={s.text}
              onChange={(e) => update(s.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  insertAfter(index, [""]);
                }
                if (e.key === "Backspace" && s.text === "" && steps.length > 1) {
                  e.preventDefault();
                  remove(index);
                }
              }}
              onPaste={(e) => {
                const parts = splitSteps(e.clipboardData.getData("text"));
                if (parts.length < 2) return;
                e.preventDefault();
                const [first, ...rest] = parts;
                const merged = steps.map((x) => (x.key === s.key ? { ...x, text: (x.text ? x.text + " " : "") + first } : x));
                const added = rest.map((text) => ({ key: newKey(), text }));
                setSteps([...merged.slice(0, index + 1), ...added, ...merged.slice(index + 1)]);
                pendingFocus.current = added[added.length - 1].key;
              }}
            />
            <button type="button" className="btn mt-1 h-7 w-7 shrink-0 p-0 text-muted" onClick={() => remove(index)} aria-label={`Remove step ${index + 1}`}>✕</button>
            {focused === s.key && ingredientNames.length > 0 && (
              <div className="mt-1 flex basis-full flex-wrap gap-1 pl-14">
                <span className="self-center text-xs text-muted">Insert amount:</span>
                {ingredientNames.map((ingredient) => (
                  <button
                    key={ingredient}
                    type="button"
                    className="rounded-full border border-border bg-background px-2 py-0.5 text-xs hover:border-accent"
                    // mousedown fires before the textarea loses focus, so the caret is still where the user left it
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertAmount(s.key, ingredient);
                    }}
                  >
                    {ingredient}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      />
      <button type="button" className="btn-ghost" onClick={() => insertAfter(steps.length - 1, [""])}>+ Step</button>
    </div>
  );
}

/** Grow a textarea to fit its text (fallback for browsers without CSS field-sizing). */
function autoGrow(el: HTMLTextAreaElement) {
  if (CSS.supports("field-sizing", "content")) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
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
