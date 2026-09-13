import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  CATEGORIES,
  categoryLabel,
  fmtQty,
  type Ingredient,
  type PlannedMeal,
  type ShoppingExtra,
  type ShoppingListRow,
} from "@/lib/types";
import { addExtra, removeExtra, unplanMeal } from "../actions";
import { Submit } from "@/components/submit";
import { IngredientFields } from "@/components/ingredient-input";
import { ShoppingItem } from "./shopping-item";

export default async function ShoppingPage() {
  const supabase = await createClient();
  const [{ data: list }, { data: legacyExtras }, { data: plans }, { data: catalog }] = await Promise.all([
    supabase.from("shopping_list").select("*").returns<ShoppingListRow[]>(),
    supabase.from("shopping_extras").select("*").is("ingredient_id", null).order("created_at").returns<ShoppingExtra[]>(),
    supabase.from("planned_meals").select("id, recipe_id, batches, recipes(title, servings)").order("created_at").returns<PlannedMeal[]>(),
    supabase.from("ingredients").select("id, name, unit, category").order("name").returns<Ingredient[]>(),
  ]);

  const rows = list ?? [];
  const groups = [...CATEGORIES, ...new Set(rows.map((r) => r.category).filter((c) => !(CATEGORIES as readonly string[]).includes(c)))]
    .map((category) => ({
      category,
      items: rows.filter((r) => r.category === category).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.items.length);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="h1">Shopping list</h1>

      <form action={addExtra} className="card grid grid-cols-2 gap-3">
        <IngredientFields catalog={catalog ?? []} defaultUnit="pc" quantityPlaceholder="some" />
        <Submit className="btn-primary col-span-2">Add to list</Submit>
      </form>

      {rows.length === 0 && !legacyExtras?.length && (
        <p className="text-muted">
          Nothing to buy. Open a <Link className="text-accent underline" href="/recipes">recipe</Link> and tap
          &ldquo;Add missing to list&rdquo;, or mark pantry items as ran out.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.category}>
          <h2 className="mb-2 font-semibold">{categoryLabel(group.category)}</h2>
          <ul className="card divide-y divide-border p-0">
            {group.items.map((item) => (
              <ShoppingItem key={item.ingredient_id} item={item} reason={reason(item)} />
            ))}
          </ul>
        </section>
      ))}

      {!!legacyExtras?.length && (
        <section>
          <h2 className="label">Other</h2>
          <ul className="card divide-y divide-border p-0">
            {legacyExtras.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <form action={removeExtra}>
                  <input type="hidden" name="id" value={e.id} />
                  <Submit
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-border hover:bg-accent-soft"
                    aria-label={`Got ${e.name}`}
                    pendingText="✓"
                  >
                    {""}
                  </Submit>
                </form>
                <span className="flex-1">{e.name}{e.quantity && <span className="text-muted"> · {fmtQty(e.quantity)}</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!plans?.length && (
        <section>
          <h2 className="label">Planned meals driving this list</h2>
          <ul className="card divide-y divide-border p-0">
            {plans.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2">
                <Link href={`/recipes/${p.recipe_id}`}>
                  {p.recipes.title}
                  <span className="text-muted">
                    {p.recipes.servings
                      ? ` · ${Math.round(Number(p.batches) * p.recipes.servings)} portions`
                      : Number(p.batches) !== 1 && ` × ${fmtQty(p.batches)}`}
                  </span>
                </Link>
                <form action={unplanMeal}>
                  <input type="hidden" name="id" value={p.id} />
                  <Submit className="btn px-2 text-sm text-muted">Remove</Submit>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function reason(item: ShoppingListRow) {
  const parts: string[] = [];
  if (item.planned_short && item.for_recipes.length) parts.push(`for ${item.for_recipes.join(", ")}`);
  if (item.restock) parts.push("ran out 🔁");
  if (item.manual) parts.push("added by you");
  if (item.planned_short && item.on_hand !== null && Number(item.on_hand) > 0) {
    parts.push(`have ${fmtQty(item.on_hand, item.unit)}`);
  }
  return parts.join(" · ");
}
