import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { RecipeIngredientStatus, RecipeSummary } from "@/lib/types";
import { deleteRecipe } from "../../actions";
import { Submit } from "@/components/submit";
import { RecipeScaler } from "./recipe-scaler";
import { fmtMinutes, totalMinutes } from "@/lib/dates";

function TimeChip({ label, minutes, strong }: { label: string; minutes: number | null; strong?: boolean }) {
  if (!minutes) return null;
  return (
    <div className={`rounded-xl border px-3 py-1.5 ${strong ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface"}`}>
      <div className="text-[10px] font-medium tracking-wide uppercase opacity-70">{label}</div>
      <div className="text-sm font-semibold">{fmtMinutes(minutes)}</div>
    </div>
  );
}

export default async function RecipePage({ params }: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: recipe }, { data: lines }, { count: planCount }] = await Promise.all([
    supabase.from("recipe_summary").select("*").eq("id", id).maybeSingle<RecipeSummary>(),
    supabase.from("recipe_ingredient_status").select("*").eq("recipe_id", id).order("position").returns<RecipeIngredientStatus[]>(),
    supabase.from("planned_meals").select("id", { count: "exact", head: true }).eq("recipe_id", id),
  ]);
  if (!recipe) notFound();

  return (
    <article className="flex flex-col gap-6">
      <div>
        <Link href="/recipes" className="text-sm text-muted">‹ Recipes</Link>
        <h1 className="h1 mt-1">{recipe.title}</h1>
        {totalMinutes(recipe) > 0 && (
          <div className="mt-3 flex gap-2">
            <TimeChip label="Prep" minutes={recipe.prep_minutes} />
            <TimeChip label="Cook" minutes={recipe.cook_minutes} />
            <TimeChip label="Total" minutes={totalMinutes(recipe)} strong />
          </div>
        )}
        <p className="mt-2 text-muted">
          {recipe.freezable && "🧊 freezes well"}
          {recipe.freezable && recipe.source_url && " · "}
          {recipe.source_url && (
            <a href={recipe.source_url} target="_blank" rel="noreferrer" className="underline">source</a>
          )}
        </p>
      </div>

      <RecipeScaler recipe={recipe} ingredients={lines ?? []} planCount={planCount ?? 0} />

      <form action={deleteRecipe}>
        <input type="hidden" name="id" value={recipe.id} />
        <Submit className="btn text-danger">Delete recipe</Submit>
      </form>
    </article>
  );
}
