import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Conversion, Ingredient, RecipeIngredientStatus, RecipeSummary } from "@/lib/types";
import { RecipeEditor } from "../../recipe-editor";

export default async function EditRecipePage({ params }: PageProps<"/recipes/[id]/edit">) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: recipe }, { data: lines }, { data: catalog }, { data: conversions }] = await Promise.all([
    supabase.from("recipes").select("*").eq("id", id).maybeSingle<RecipeSummary>(),
    supabase.from("recipe_ingredient_status").select("*").eq("recipe_id", id).order("position").returns<RecipeIngredientStatus[]>(),
    supabase.from("ingredients").select("id, name, unit, category").order("name").returns<Ingredient[]>(),
    supabase.from("ingredient_conversions").select("id, ingredient_id, unit, amount, equals_amount, equals_unit").returns<Conversion[]>(),
  ]);
  if (!recipe) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`/recipes/${id}`} className="text-sm text-muted">‹ {recipe.title}</Link>
        <h1 className="h1 mt-1">Edit recipe</h1>
      </div>
      <RecipeEditor
        catalog={catalog ?? []}
        conversions={conversions ?? []}
        initial={{
          id,
          title: recipe.title,
          servings: recipe.servings,
          prep_minutes: recipe.prep_minutes,
          cook_minutes: recipe.cook_minutes,
          freezable: recipe.freezable,
          steps: recipe.steps,
          source_url: recipe.source_url,
          notes: recipe.notes,
          ingredients: (lines ?? []).map((l) => ({
            name: l.name,
            quantity: l.quantity === null ? null : Number(l.quantity),
            unit: l.unit,
            category: l.category,
            note: l.note,
            optional: l.optional,
          })),
        }}
      />
    </div>
  );
}
