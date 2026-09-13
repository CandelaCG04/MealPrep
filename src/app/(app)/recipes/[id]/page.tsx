import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtQty, type RecipeIngredientStatus, type RecipeSummary } from "@/lib/types";
import { cookRecipe, deleteRecipe, planRecipe } from "../../actions";
import { Submit } from "@/components/submit";

export default async function RecipePage({ params }: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: recipe }, { data: lines }, { count: planCount }] = await Promise.all([
    supabase.from("recipe_summary").select("*").eq("id", id).maybeSingle<RecipeSummary>(),
    supabase.from("recipe_ingredient_status").select("*").eq("recipe_id", id).order("position").returns<RecipeIngredientStatus[]>(),
    supabase.from("planned_meals").select("id", { count: "exact", head: true }).eq("recipe_id", id),
  ]);
  if (!recipe) notFound();

  const ingredients = lines ?? [];
  const missing = ingredients.filter((l) => !l.have && !l.optional);

  return (
    <article className="flex flex-col gap-6">
      <div>
        <Link href="/recipes" className="text-sm text-muted">‹ Recipes</Link>
        <h1 className="h1 mt-1">{recipe.title}</h1>
        <p className="text-muted">
          {[recipe.servings && `${recipe.servings} servings`, recipe.prep_minutes && `${recipe.prep_minutes} min`, recipe.freezable && "🧊 freezes well"]
            .filter(Boolean)
            .join(" · ")}
          {recipe.source_url && (
            <>
              {" · "}
              <a href={recipe.source_url} target="_blank" rel="noreferrer" className="underline">source</a>
            </>
          )}
        </p>
      </div>

      <section className="card flex flex-col gap-3">
        {missing.length === 0 ? (
          <p className="font-medium text-accent">✓ You have everything for this recipe.</p>
        ) : (
          <p className="font-medium text-warn">Missing {missing.length} of {recipe.required_count} ingredients.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <form action={planRecipe}>
            <input type="hidden" name="recipe_id" value={recipe.id} />
            <Submit className={missing.length ? "btn-primary" : "btn-ghost"} pendingText="Adding…">
              {missing.length ? "🛒 Add missing to list" : "📌 Plan this meal"}
            </Submit>
          </form>
          <Link href={`/recipes/${recipe.id}/edit`} className="btn-ghost">Edit</Link>
        </div>
        {!!planCount && (
          <p className="text-sm text-muted">
            📌 Planned {planCount > 1 ? `${planCount}×` : ""} — its missing ingredients are on your{" "}
            <Link href="/shopping" className="underline">shopping list</Link>.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Ingredients</h2>
        <ul className="card divide-y divide-border p-0">
          {ingredients.map((l) => (
            <li key={l.id} className="flex items-start gap-3 px-4 py-2">
              <span className={`mt-0.5 ${l.have ? "text-accent" : l.optional ? "text-muted" : "text-warn"}`}>
                {l.have ? "✓" : "○"}
              </span>
              <div className="flex-1">
                <span className={l.optional ? "text-muted" : ""}>
                  {l.quantity !== null && <span className="font-medium">{fmtQty(l.quantity, l.unit)} </span>}
                  {l.name}
                  {l.note && <span className="text-muted">, {l.note}</span>}
                  {l.optional && <span className="text-muted"> (optional)</span>}
                </span>
                {!l.have && l.in_pantry && l.on_hand !== null && (
                  <div className="text-xs text-muted">have {fmtQty(l.on_hand, l.unit)}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {recipe.instructions && (
        <section>
          <h2 className="mb-2 font-semibold">Method</h2>
          <div className="card leading-relaxed whitespace-pre-line">{recipe.instructions}</div>
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
        <p className="mb-3 text-sm text-muted">Deducts ingredients from the pantry and clears one plan.</p>
        <form action={cookRecipe} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="recipe_id" value={recipe.id} />
          <div>
            <label className="label" htmlFor="batches">Batches</label>
            <input className="input w-24" id="batches" name="batches" type="number" min="0.5" step="0.5" defaultValue={1} />
          </div>
          <div>
            <label className="label" htmlFor="freeze_portions">Portions to freeze</label>
            <input
              className="input w-32"
              id="freeze_portions"
              name="freeze_portions"
              type="number"
              min="0"
              defaultValue={recipe.freezable ? recipe.servings ?? 0 : 0}
            />
          </div>
          <Submit className="btn-primary" pendingText="Saving…">Cooked it</Submit>
        </form>
      </section>

      <form action={deleteRecipe}>
        <input type="hidden" name="id" value={recipe.id} />
        <Submit className="btn text-danger">Delete recipe</Submit>
      </form>
    </article>
  );
}
