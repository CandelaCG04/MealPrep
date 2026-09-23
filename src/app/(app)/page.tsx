import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ageLabel, daysSince, freezerTone, fmtClock, fmtSince, fmtUntil } from "@/lib/dates";
import type { CookingSession, FrozenMeal, RecipeSummary } from "@/lib/types";

export default async function Home() {
  const supabase = await createClient();
  const [frozen, recipes, list, pantry, cooking] = await Promise.all([
    supabase.from("frozen_meals").select("*").order("frozen_on").returns<FrozenMeal[]>(),
    supabase.from("recipe_summary").select("*").returns<RecipeSummary[]>(),
    supabase.from("shopping_list").select("ingredient_id", { count: "exact", head: true }),
    supabase.from("pantry_items").select("id", { count: "exact", head: true }).or("quantity.is.null,quantity.gt.0"),
    supabase.from("cooking_sessions").select("*, recipes(title, steps)").order("started_at").returns<(CookingSession & { recipes: { title: string; steps: string[] } })[]>(),
  ]);

  const frozenMeals = frozen.data ?? [];
  const portions = frozenMeals.reduce((n, m) => n + m.portions, 0);
  const allRecipes = recipes.data ?? [];
  const cookable = allRecipes.filter((r) => r.required_count > 0 && r.missing_count === 0);
  const planned = allRecipes.filter((r) => r.planned);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="h1">What&apos;s cooking</h1>

      {!!cooking.data?.length && (
        <section>
          <h2 className="mb-2 font-semibold">🍳 In progress</h2>
          <ul className="flex flex-col gap-2">
            {cooking.data.map((s) => {
              const left = s.wait_until ? fmtUntil(s.wait_until) : null;
              const ready = s.wait_until !== null && left === null;
              return (
                <li key={s.id}>
                  <Link href={`/recipes/${s.recipe_id}`} className={`card flex items-center gap-3 transition hover:border-accent ${ready ? "border-accent bg-accent-soft" : ""}`}>
                    <div className="flex-1">
                      <div className="font-medium">{s.recipes.title}</div>
                      <div className="text-sm text-muted">
                        started {fmtSince(s.started_at)} · {s.done_steps.length} of {s.recipes.steps.length} steps
                        {s.wait_until && (ready ? " · ⏰ wait is over" : ` · ⏲ back in ${left} (${fmtClock(s.wait_until)})`)}
                      </div>
                    </div>
                    <span className="text-muted">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat href="/freezer" value={portions} label="frozen portions" />
        <Stat href="/recipes?filter=cookable" value={cookable.length} label="cookable now" />
        <Stat href="/shopping" value={list.count ?? 0} label="to buy" />
        <Stat href="/pantry" value={pantry.count ?? 0} label="pantry items" />
      </div>

      {frozenMeals.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Eat these first</h2>
          <ul className="card divide-y divide-border p-0">
            {frozenMeals.slice(0, 3).map((m) => {
              const days = daysSince(m.frozen_on);
              const tone = freezerTone(days);
              return (
                <li key={m.id} className="flex items-center justify-between px-4 py-3">
                  <span>{m.name} <span className="text-muted">× {m.portions}</span></span>
                  <span className={`text-sm ${tone === "fresh" ? "text-muted" : "text-warn"}`}>{ageLabel(days)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {planned.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Planned</h2>
          <RecipeList recipes={planned} />
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">You can cook right now</h2>
        {cookable.length ? (
          <RecipeList recipes={cookable} />
        ) : (
          <p className="text-muted">
            Nothing fully stocked yet. <Link className="text-accent underline" href="/recipes">Browse recipes</Link> to see what&apos;s missing.
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({ href, value, label }: { href: string; value: number; label: string }) {
  return (
    <Link href={href} className="card flex flex-col transition hover:border-accent">
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-muted">{label}</span>
    </Link>
  );
}

function RecipeList({ recipes }: { recipes: RecipeSummary[] }) {
  return (
    <ul className="card divide-y divide-border p-0">
      {recipes.map((r) => (
        <li key={r.id}>
          <Link href={`/recipes/${r.id}`} className="flex items-center justify-between px-4 py-3">
            <span>{r.title}</span>
            <span className="text-muted">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
