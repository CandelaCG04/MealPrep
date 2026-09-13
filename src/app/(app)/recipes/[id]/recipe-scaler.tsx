"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtQty, type Ingredient, type RecipeIngredientStatus, type RecipeSummary } from "@/lib/types";
import { cookRecipe, planRecipe } from "../../actions";
import { Submit } from "@/components/submit";
import { MadeFrom, type SourceWithName } from "./made-from";

type Shortfall = {
  have: boolean;
  missing: number | null; // in stock_unit
  viaSource: boolean;
  sourceNeeded: number | null; // in source_unit
};

/**
 * Mirrors the recipe_ingredient_status view, but for a scaled amount.
 * Compares in the pantry unit; when the ingredient itself falls short, checks what it's made from.
 */
function shortfall(line: RecipeIngredientStatus, factor: number): Shortfall {
  const need = line.stock_quantity === null ? null : Number(line.stock_quantity) * factor;
  const onHand = line.on_hand === null ? null : Number(line.on_hand);

  let own: { have: boolean; missing: number | null };
  if (!line.in_pantry) own = { have: false, missing: null };
  else if (onHand === null) own = { have: true, missing: null }; // untracked stock counts as enough
  else if (onHand <= 0) own = { have: false, missing: null };
  else if (need === null) own = { have: true, missing: null }; // "to taste" or units can't be compared
  else own = onHand >= need ? { have: true, missing: null } : { have: false, missing: need - onHand };

  if (own.have || !line.source_name) return { ...own, viaSource: false, sourceNeeded: null };

  const ownShort = need === null ? null : Math.max(need - Math.max(onHand ?? 0, 0), 0);
  const sourceNeeded = ownShort !== null && line.source_factor !== null ? ownShort * Number(line.source_factor) : null;
  const sourceOnHand = line.source_on_hand === null ? null : Number(line.source_on_hand);
  const viaSource =
    line.source_in_pantry &&
    // tiny tolerance: ratios like 1/30 make "need exactly what you have" land a hair above it
    (sourceOnHand === null || (sourceOnHand > 0 && (sourceNeeded === null || sourceOnHand >= sourceNeeded - 1e-9)));
  return { have: viaSource, missing: own.missing, viaSource, sourceNeeded };
}

export function RecipeScaler({
  recipe,
  ingredients,
  planCount,
  sources,
  catalog,
}: {
  recipe: RecipeSummary;
  ingredients: RecipeIngredientStatus[];
  planCount: number;
  sources: Record<string, SourceWithName>;
  catalog: Ingredient[];
}) {
  const base = recipe.servings ?? 1;
  const unitWord = recipe.servings ? "portions" : "batches";
  const [amount, setAmount] = useState(base);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const toggleStep = (i: number) =>
    setDone((d) => {
      const next = new Set(d);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  const factor = amount / base;

  const lines = ingredients.map((l) => ({ ...l, ...shortfall(l, factor) }));
  const missing = lines.filter((l) => !l.have && !l.optional);
  const scaled = amount !== base;

  const step = (delta: number) => setAmount((a) => Math.max(1, a + delta));

  return (
    <>
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium capitalize">{unitWord}</span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost h-9 w-9 p-0 text-lg" onClick={() => step(-1)} disabled={amount <= 1} aria-label={`Fewer ${unitWord}`}>
              −
            </button>
            <input
              className="input w-16 text-center"
              type="number"
              min="1"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
              aria-label={unitWord}
            />
            <button type="button" className="btn-ghost h-9 w-9 p-0 text-lg" onClick={() => step(1)} aria-label={`More ${unitWord}`}>
              +
            </button>
          </div>
        </div>
        {scaled && (
          <p className="-mt-2 text-sm text-muted">
            Scaled ×{fmtQty(factor)} from {base} {unitWord}.{" "}
            <button type="button" className="underline" onClick={() => setAmount(base)}>Reset</button>
          </p>
        )}

        {missing.length === 0 ? (
          <p className="font-medium text-accent">✓ You have everything for {amount} {unitWord}.</p>
        ) : (
          <p className="font-medium text-warn">
            Missing {missing.length} of {recipe.required_count} ingredients for {amount} {unitWord}.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <form action={planRecipe}>
            <input type="hidden" name="recipe_id" value={recipe.id} />
            <input type="hidden" name="batches" value={factor} />
            <Submit className={missing.length ? "btn-primary" : "btn-ghost"} pendingText="Adding…">
              {missing.length ? "🛒 Add missing to list" : "📌 Plan this meal"}
            </Submit>
          </form>
          <Link href={`/recipes/${recipe.id}/edit`} className="btn-ghost">Edit</Link>
        </div>
        {planCount > 0 && (
          <p className="text-sm text-muted">
            📌 Planned {planCount > 1 ? `${planCount}×` : ""} — its missing ingredients are on your{" "}
            <Link href="/shopping" className="underline">shopping list</Link>.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Ingredients</h2>
        <ul className="card divide-y divide-border p-0">
          {lines.map((l) => {
            const editing = editingSource === l.ingredient_id;
            const sourceUnit = l.source_unit ?? undefined;
            return (
              <li key={l.id} className="flex items-start gap-3 px-4 py-2">
                <span className={`mt-0.5 ${l.have ? "text-accent" : l.optional ? "text-muted" : "text-warn"}`}>
                  {l.have ? "✓" : "○"}
                </span>
                <div className="min-w-0 flex-1">
                  <span className={l.optional ? "text-muted" : ""}>
                    {l.quantity !== null && <span className="font-medium">{fmtQty(Number(l.quantity) * factor, l.unit)} </span>}
                    {l.name}
                    {l.note && <span className="text-muted">, {l.note}</span>}
                    {l.optional && <span className="text-muted"> (optional)</span>}
                  </span>

                  {!l.have && l.in_pantry && l.on_hand !== null && Number(l.on_hand) > 0 && (
                    <div className="text-xs text-muted">
                      have {fmtQty(l.on_hand, l.stock_unit)}
                      {l.missing !== null && ` · need ${fmtQty(l.missing, l.stock_unit)} more`}
                    </div>
                  )}

                  {l.source_name && !editing && (l.viaSource || !l.have) && (
                    <div className={`text-xs ${l.viaSource ? "text-accent" : "text-muted"}`}>
                      {l.viaSource ? "from " : "or from "}
                      {l.source_name}
                      {l.sourceNeeded !== null && ` · ${l.viaSource ? "uses" : "needs"} ${fmtQty(l.sourceNeeded, sourceUnit)}`}
                      {!l.viaSource &&
                        (!l.source_in_pantry
                          ? " (none in pantry)"
                          : l.source_on_hand !== null
                            ? ` (have ${fmtQty(l.source_on_hand, sourceUnit)})`
                            : "")}
                      {" · "}
                      <button type="button" className="underline" onClick={() => setEditingSource(l.ingredient_id)}>
                        edit
                      </button>
                    </div>
                  )}

                  {!l.source_name && !l.have && !l.optional && !editing && (
                    <button type="button" className="text-xs text-muted underline" onClick={() => setEditingSource(l.ingredient_id)}>
                      Made from something you have?
                    </button>
                  )}

                  <MadeFrom
                    key={`${l.ingredient_id}-${sources[l.ingredient_id]?.id ?? "new"}`}
                    ingredientId={l.ingredient_id}
                    ingredientName={l.name}
                    defaultUnit={l.stock_unit}
                    source={sources[l.ingredient_id]}
                    catalog={catalog}
                    open={editing}
                    onOpenChange={(o) => setEditingSource(o ? l.ingredient_id : null)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {recipe.steps.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Steps</h2>
          <p className="mb-2 text-xs text-muted">
            Tap a step to tick it off while you cook.
            {scaled && ` Amounts written in the steps are for ${base} ${unitWord}.`}
          </p>
          <ol className="card flex flex-col gap-1 p-2">
            {recipe.steps.map((stepText, i) => {
              const isDone = done.has(i);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => toggleStep(i)}
                    className={`flex w-full items-start gap-3 rounded-xl p-2 text-left transition hover:bg-background ${isDone ? "text-muted" : ""}`}
                    aria-pressed={isDone}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        isDone ? "bg-accent text-white dark:text-black" : "bg-accent-soft text-accent"
                      }`}
                    >
                      {isDone ? "✓" : i + 1}
                    </span>
                    <span className={`pt-0.5 leading-relaxed whitespace-pre-line ${isDone ? "line-through" : ""}`}>{stepText}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {recipe.notes && (
        <section>
          <h2 className="mb-2 font-semibold">Notes</h2>
          <div className="card whitespace-pre-line">{recipe.notes}</div>
        </section>
      )}

      <section className="card">
        <h2 className="font-semibold">I cooked this</h2>
        <p className="mb-3 text-sm text-muted">
          Deducts the ingredients for {amount} {unitWord} from the pantry and clears one plan.
        </p>
        <form action={cookRecipe} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="recipe_id" value={recipe.id} />
          <input type="hidden" name="batches" value={factor} />
          <div>
            <label className="label" htmlFor="freeze_portions">Portions to freeze</label>
            <input
              key={amount}
              className="input w-32"
              id="freeze_portions"
              name="freeze_portions"
              type="number"
              min="0"
              defaultValue={recipe.freezable && recipe.servings ? amount : 0}
            />
          </div>
          <Submit className="btn-primary" pendingText="Saving…">Cooked {amount} {unitWord}</Submit>
        </form>
      </section>
    </>
  );
}
