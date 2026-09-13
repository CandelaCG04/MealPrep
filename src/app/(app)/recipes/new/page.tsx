import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Conversion, Ingredient } from "@/lib/types";
import { aiEnabled } from "@/lib/ai";
import { RecipeEditor } from "../recipe-editor";

export default async function NewRecipePage() {
  const supabase = await createClient();
  const [{ data }, { data: conversions }] = await Promise.all([
    supabase.from("ingredients").select("id, name, unit, category").order("name").returns<Ingredient[]>(),
    supabase.from("ingredient_conversions").select("id, ingredient_id, unit, amount, equals_amount, equals_unit").returns<Conversion[]>(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/recipes" className="text-sm text-muted">‹ Recipes</Link>
        <h1 className="h1 mt-1">New recipe</h1>
      </div>
      <RecipeEditor catalog={data ?? []} conversions={conversions ?? []} aiEnabled={aiEnabled()} />
    </div>
  );
}
