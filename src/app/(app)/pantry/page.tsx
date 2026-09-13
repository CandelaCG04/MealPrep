import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, LOCATIONS, categoryLabel, unitLabel, type Ingredient, type PantryItem } from "@/lib/types";
import { CategorySelect } from "@/components/category-select";
import {
  addIngredientToList,
  addPantryItem,
  deletePantryItem,
  markRanOut,
  restockItem,
  setAutoRestock,
  setPantryQuantity,
} from "../actions";
import { Submit } from "@/components/submit";
import { IngredientFields } from "@/components/ingredient-input";
import { aiEnabled } from "@/lib/ai";
import { QuickAdd } from "./quick-add";

const LOCATION_TAG = { pantry: "cupboard", fridge: "❄️ fridge", freezer: "🧊 freezer" } as const;

export default async function PantryPage() {
  const supabase = await createClient();
  const [{ data: items }, { data: ingredients }, { data: onList }] = await Promise.all([
    supabase.from("pantry_items").select("*, ingredients(id, name, unit, category)").returns<PantryItem[]>(),
    supabase.from("ingredients").select("id, name, unit, category").order("name").returns<Ingredient[]>(),
    supabase.from("shopping_list").select("ingredient_id").returns<{ ingredient_id: string }[]>(),
  ]);

  const sorted = (items ?? []).sort((a, b) => a.ingredients.name.localeCompare(b.ingredients.name));
  const isOut = (i: PantryItem) => i.quantity !== null && Number(i.quantity) <= 0;
  const inStock = sorted.filter((i) => !isOut(i));
  const ranOut = sorted.filter(isOut);
  const listed = new Set((onList ?? []).map((r) => r.ingredient_id));

  // Same categories as the shopping list; cooked meals first since they need eating soonest.
  const order = ["cooked", ...CATEGORIES.filter((c) => c !== "cooked")];
  const extra = [...new Set(inStock.map((i) => i.ingredients.category))].filter((c) => !order.includes(c));
  const groups = [...order, ...extra]
    .map((category) => ({ category, items: inStock.filter((i) => i.ingredients.category === category) }))
    .filter((g) => g.items.length);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="h1">Pantry</h1>

      {aiEnabled() && <QuickAdd />}

      <details className="card" open={!aiEnabled() || undefined}>
        <summary className="cursor-pointer font-medium">Add to pantry</summary>
        <form action={addPantryItem} className="mt-3 grid grid-cols-2 gap-3">
          <IngredientFields catalog={ingredients ?? []} quantityPlaceholder="some" />
          <div>
            <label className="label" htmlFor="location">Where</label>
            <select className="input" id="location" name="location">
              {LOCATIONS.map((l) => <option key={l} value={l}>{l === "pantry" ? "cupboard" : l}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="auto_restock" />
            Add to shopping list when I run out
          </label>
          <p className="col-span-2 text-xs text-muted">Leave the amount blank for things you don&apos;t measure, like salt or oil.</p>
          <Submit className="btn-primary col-span-2">Add</Submit>
        </form>
      </details>

      {groups.map(({ category, items: group }) => {
        return (
          <section key={category}>
            <h2 className="mb-2 font-semibold">
              {categoryLabel(category)} <span className="text-sm font-normal text-muted">{group.length}</span>
            </h2>
            <ul className="card divide-y divide-border p-0">
              {group.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">
                      {item.ingredients.name}
                      {item.location !== "pantry" && (
                        <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-xs text-muted">{LOCATION_TAG[item.location]}</span>
                      )}
                    </span>
                    <form action={setPantryQuantity} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={item.id} />
                      <input
                        className="input w-20 py-1 text-right"
                        name="quantity"
                        type="number"
                        step="any"
                        min="0"
                        defaultValue={item.quantity === null ? "" : Number(item.quantity)}
                        placeholder="some"
                        aria-label={`${item.ingredients.name} amount`}
                      />
                      <span className="w-12 text-sm text-muted">{unitLabel(item.ingredients.unit)}</span>
                      <Submit className="btn-ghost px-2 py-1" aria-label="Save amount">✓</Submit>
                    </form>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <form action={markRanOut}>
                      <input type="hidden" name="id" value={item.id} />
                      <Submit className="text-warn underline">Ran out</Submit>
                    </form>
                    <AutoToggle item={item} />
                    <span className="ml-auto">
                      <CategorySelect ingredientId={item.ingredient_id} category={item.ingredients.category} name={item.ingredients.name} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {ranOut.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">🚫 Ran out</h2>
          <ul className="card divide-y divide-border p-0">
            {ranOut.map((item) => {
              const unit = item.ingredients.unit;
              return (
                <li key={item.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-muted">{item.ingredients.name}</span>
                    {listed.has(item.ingredient_id) ? (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">🛒 on list</span>
                    ) : (
                      <form action={addIngredientToList}>
                        <input type="hidden" name="ingredient_id" value={item.ingredient_id} />
                        <input type="hidden" name="name" value={item.ingredients.name} />
                        <input type="hidden" name="quantity" value={item.usual_quantity ?? ""} />
                        <Submit className="btn-ghost px-3 py-1 text-xs" pendingText="Adding…">🛒 Add to list</Submit>
                      </form>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <form action={restockItem} className="flex items-center gap-1">
                      <input type="hidden" name="ingredient_id" value={item.ingredient_id} />
                      <input
                        className="input w-20 py-1 text-right text-sm"
                        name="quantity"
                        type="number"
                        step="any"
                        min="0"
                        defaultValue={item.usual_quantity ?? ""}
                        placeholder="some"
                        aria-label={`Restock ${item.ingredients.name} amount`}
                      />
                      <span className="text-muted">{unitLabel(unit)}</span>
                      <Submit className="btn-ghost px-2 py-1 text-xs">Restock</Submit>
                    </form>
                    <AutoToggle item={item} />
                    <form action={deletePantryItem} className="ml-auto">
                      <input type="hidden" name="id" value={item.id} />
                      <Submit className="text-muted underline" title="Remove from the pantry completely">Forget</Submit>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!sorted.length && <p className="text-muted">Your pantry is empty. Add what you have above.</p>}
    </div>
  );
}

function AutoToggle({ item }: { item: PantryItem }) {
  return (
    <form action={setAutoRestock}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="value" value={String(!item.auto_restock)} />
      <Submit
        className={item.auto_restock ? "text-accent" : "text-muted"}
        title="Automatically add to the shopping list when this runs out"
      >
        {item.auto_restock ? "🔁 Auto-add to list: on" : "🔁 Auto-add to list: off"}
      </Submit>
    </form>
  );
}
