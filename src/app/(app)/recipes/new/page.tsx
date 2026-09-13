import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Ingredient } from "@/lib/types";
import { aiEnabled } from "@/lib/ai";
import { RecipeEditor } from "../recipe-editor";

export default async function NewRecipePage() {
  const supabase = await createClient();
  const { data } = await supabase.from("ingredients").select("id, name, unit, category").order("name").returns<Ingredient[]>();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/recipes" className="text-sm text-muted">‹ Recipes</Link>
        <h1 className="h1 mt-1">New recipe</h1>
      </div>
      <RecipeEditor catalog={data ?? []} aiEnabled={aiEnabled()} />
    </div>
  );
}
