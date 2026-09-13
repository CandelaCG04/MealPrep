import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, LOCATIONS, UNITS, fmtQty, type Ingredient, type PantryItem } from "@/lib/types";
import { addPantryItem, deletePantryItem, setPantryQuantity } from "../actions";
import { Submit } from "@/components/submit";
import { aiEnabled } from "@/lib/ai";
import { QuickAdd } from "./quick-add";

const LOCATION_LABEL = { pantry: "🥫 Pantry", fridge: "🧀 Fridge", freezer: "🧊 Freezer (raw)" } as const;

export default async function PantryPage() {
  const supabase = await createClient();
  const [{ data: items }, { data: ingredients }] = await Promise.all([
    supabase
      .from("pantry_items")
      .select("*, ingredients(id, name, unit, category)")
      .returns<PantryItem[]>(),
    supabase.from("ingredients").select("id, name, unit, category").order("name").returns<Ingredient[]>(),
  ]);

  const sorted = (items ?? []).sort((a, b) => a.ingredients.name.localeCompare(b.ingredients.name));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="h1">Pantry</h1>

      {aiEnabled() && <QuickAdd />}

      <details className="card" open={!aiEnabled() || undefined}>
        <summary className="cursor-pointer font-medium">Add manually</summary>
        <form action={addPantryItem} className="mt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor="name">Ingredient</label>
            <input className="input" id="name" name="name" list="ingredient-names" required />
            <datalist id="ingredient-names">
              {ingredients?.map((i) => <option key={i.id} value={i.name} />)}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="quantity">Amount</label>
            <input className="input" id="quantity" name="quantity" type="number" step="any" min="0" placeholder="blank = untracked" />
          </div>
          <div>
            <label className="label" htmlFor="unit">Unit</label>
            <select className="input" id="unit" name="unit" defaultValue="g">
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="location">Where</label>
            <select className="input" id="location" name="location">
              {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="category">Category</label>
            <select className="input" id="category" name="category">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <p className="col-span-2 text-xs text-muted">Unit and category only apply to new ingredients; existing ones keep their unit.</p>
          <Submit className="btn-primary col-span-2">Add to pantry</Submit>
        </form>
      </details>

      {LOCATIONS.map((loc) => {
        const group = sorted.filter((i) => i.location === loc);
        if (!group.length) return null;
        return (
          <section key={loc}>
            <h2 className="mb-2 font-semibold">{LOCATION_LABEL[loc]}</h2>
            <ul className="card divide-y divide-border p-0">
              {group.map((item) => {
                const out = item.quantity !== null && Number(item.quantity) <= 0;
                return (
                  <li key={item.id} className="flex items-center gap-2 px-4 py-2">
                    <span className={`flex-1 ${out ? "text-muted line-through" : ""}`}>{item.ingredients.name}</span>
                    <form action={setPantryQuantity} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={item.id} />
                      <input
                        className="input w-20 py-1 text-right"
                        name="quantity"
                        type="number"
                        step="any"
                        min="0"
                        defaultValue={item.quantity === null ? "" : fmtQty(item.quantity)}
                        placeholder="some"
                        aria-label={`${item.ingredients.name} amount`}
                      />
                      <span className="w-10 text-sm text-muted">{item.ingredients.unit}</span>
                      <Submit className="btn-ghost px-2 py-1" aria-label="Save">✓</Submit>
                    </form>
                    <form action={deletePantryItem}>
                      <input type="hidden" name="id" value={item.id} />
                      <Submit className="btn px-2 py-1 text-muted" aria-label="Remove">✕</Submit>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {!sorted.length && <p className="text-muted">Your pantry is empty. Add what you have above.</p>}
    </div>
  );
}
