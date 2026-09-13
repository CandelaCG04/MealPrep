import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { RecipeIngredientStatus, RecipeSummary } from "@/lib/types";
import { deleteRecipe } from "../../actions";
import { Submit } from "@/components/submit";
import { RecipeScaler } from "./recipe-scaler";

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
        <p className="text-muted">
          {[recipe.prep_minutes && `${recipe.prep_minutes} min`, recipe.freezable && "🧊 freezes well"]
            .filter(Boolean)
            .join(" · ")}
          {recipe.source_url && (
            <>
              {recipe.prep_minutes || recipe.freezable ? " · " : ""}
              <a href={recipe.source_url} target="_blank" rel="noreferrer" className="underline">source</a>
            </>
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
