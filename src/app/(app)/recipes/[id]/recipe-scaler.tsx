"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtQty, type RecipeIngredientStatus, type RecipeSummary } from "@/lib/types";
import { cookRecipe, planRecipe } from "../../actions";
import { Submit } from "@/components/submit";

/**
 * Mirrors the recipe_ingredient_status view's `have`, but for a scaled amount.
 * Compares in the pantry's unit; `missing` is in stock_unit.
 */
function shortfall(line: RecipeIngredientStatus, factor: number): { have: boolean; missing: number | null } {
  if (!line.in_pantry) return { have: false, missing: null };
  if (line.on_hand === null) return { have: true, missing: null }; // untracked stock counts as enough
  const onHand = Number(line.on_hand);
  if (onHand <= 0) return { have: false, missing: null };
  if (line.stock_quantity === null) return { have: true, missing: null }; // "to taste" or units can't be compared
  const need = Number(line.stock_quantity) * factor;
  return onHand >= need ? { have: true, missing: null } : { have: false, missing: need - onHand };
}

export function RecipeScaler({
  recipe,
  ingredients,
  planCount,
}: {
  recipe: RecipeSummary;
  ingredients: RecipeIngredientStatus[];
  planCount: number;
}) {
  const base = recipe.servings ?? 1;
  const unitWord = recipe.servings ? "portions" : "batches";
  const [amount, setAmount] = useState(base);
  const [done, setDone] = useState<Set<number>>(new Set());
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
          {lines.map((l) => (
            <li key={l.id} className="flex items-start gap-3 px-4 py-2">
              <span className={`mt-0.5 ${l.have ? "text-accent" : l.optional ? "text-muted" : "text-warn"}`}>
                {l.have ? "✓" : "○"}
              </span>
              <div className="flex-1">
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
              </div>
            </li>
          ))}
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
            {recipe.steps.map((step, i) => {
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
                    <span className={`pt-0.5 leading-relaxed whitespace-pre-line ${isDone ? "line-through" : ""}`}>{step}</span>
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
