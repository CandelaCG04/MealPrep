import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, type Ingredient, type PantryItem } from "@/lib/types";
import { addPantryItem } from "../actions";
import { Submit } from "@/components/submit";
import { IngredientFields } from "@/components/ingredient-input";
import { aiEnabled } from "@/lib/ai";
import { QuickAdd } from "./quick-add";
import { PantryBoard } from "./pantry-board";
import { RanOutCard } from "./pantry-card";

// Same categories as the shopping list; cooked meals first since they need eating soonest.
const CATEGORY_ORDER = ["cooked", ...CATEGORIES.filter((c) => c !== "cooked")];

export default async function PantryPage() {
  const supabase = await createClient();
  const [{ data: items }, { data: ingredients }, { data: onList }] = await Promise.all([
    supabase
      .from("pantry_items")
      .select("*, ingredients(id, name, unit, category)")
      .order("position")
      .returns<PantryItem[]>(),
    supabase.from("ingredients").select("id, name, unit, category").order("name").returns<Ingredient[]>(),
    supabase.from("shopping_list").select("ingredient_id").returns<{ ingredient_id: string }[]>(),
  ]);

  const all = items ?? [];
  const isOut = (i: PantryItem) => i.quantity !== null && Number(i.quantity) <= 0;
  const inStock = all.filter((i) => !isOut(i));
  const ranOut = all.filter(isOut).sort((a, b) => a.ingredients.name.localeCompare(b.ingredients.name));
  const listed = new Set((onList ?? []).map((r) => r.ingredient_id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="h1">Pantry</h1>
        {inStock.length > 1 && <p className="text-sm text-muted">Drag ⠿ to reorder or move items between categories.</p>}
      </div>

      {aiEnabled() && <QuickAdd />}

      <details className="card" open={!all.length || undefined}>
        <summary className="cursor-pointer font-medium">➕ Add to pantry</summary>
        <form action={addPantryItem} className="mt-3 grid grid-cols-2 gap-3">
          <IngredientFields catalog={ingredients ?? []} quantityPlaceholder="some" />
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_restock" />
            Add to shopping list when I run out
          </label>
          <p className="col-span-2 text-xs text-muted">Leave the amount blank for things you don&apos;t measure, like salt or oil.</p>
          <Submit className="btn-primary col-span-2">Add</Submit>
        </form>
      </details>

      <PantryBoard items={inStock} categories={CATEGORY_ORDER} />

      {ranOut.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-baseline gap-2 font-semibold">
            🚫 Ran out <span className="text-sm font-normal text-muted">{ranOut.length}</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {ranOut.map((item) => (
              <li key={item.id}>
                <RanOutCard item={item} onList={listed.has(item.ingredient_id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!all.length && <p className="text-muted">Your pantry is empty. Add what you have above.</p>}
    </div>
  );
}
