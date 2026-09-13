import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, fmtQty, type PlannedMeal, type ShoppingExtra, type ShoppingListRow } from "@/lib/types";
import { addExtra, buyItem, removeExtra, unplanMeal } from "../actions";
import { Submit } from "@/components/submit";

export default async function ShoppingPage() {
  const supabase = await createClient();
  const [{ data: list }, { data: extras }, { data: plans }] = await Promise.all([
    supabase.from("shopping_list").select("*").returns<ShoppingListRow[]>(),
    supabase.from("shopping_extras").select("*").order("created_at").returns<ShoppingExtra[]>(),
    supabase.from("planned_meals").select("id, recipe_id, batches, recipes(title)").order("created_at").returns<PlannedMeal[]>(),
  ]);

  const rows = list ?? [];
  const byCategory = CATEGORIES.map((c) => ({
    category: c,
    items: rows.filter((r) => r.category === c).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.items.length);
  const other = rows.filter((r) => !(CATEGORIES as readonly string[]).includes(r.category));
  if (other.length) byCategory.push({ category: "other", items: other });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="h1">Shopping list</h1>

      {rows.length === 0 && !extras?.length && (
        <p className="text-muted">
          Nothing to buy. Open a <Link className="text-accent underline" href="/recipes">recipe</Link> and tap
          &ldquo;Add missing to list&rdquo;.
        </p>
      )}

      {byCategory.map((group) => (
        <section key={group.category}>
          <h2 className="label">{group.category}</h2>
          <ul className="card divide-y divide-border p-0">
            {group.items.map((item) => (
              <li key={item.ingredient_id} className="flex items-center gap-3 px-4 py-3">
                <form action={buyItem}>
                  <input type="hidden" name="ingredient_id" value={item.ingredient_id} />
                  <input type="hidden" name="amount" value={item.to_buy ?? ""} />
                  <Submit
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-accent text-accent hover:bg-accent-soft"
                    aria-label={`Bought ${item.name}`}
                    title="Bought — adds it to the pantry"
                    pendingText="✓"
                  >
                    {""}
                  </Submit>
                </form>
                <div className="flex-1">
                  <div>
                    <span className="font-medium">{item.name}</span>
                    {item.to_buy !== null && <span className="text-muted"> · {fmtQty(item.to_buy, item.unit)}</span>}
                  </div>
                  <div className="text-xs text-muted">
                    for {item.for_recipes.join(", ")}
                    {item.on_hand !== null && Number(item.on_hand) > 0 && ` · have ${fmtQty(item.on_hand, item.unit)}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2 className="label">Extras</h2>
        <div className="card flex flex-col gap-3">
          {extras?.map((e) => (
            <div key={e.id} className="flex items-center gap-3">
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
            </div>
          ))}
          <form action={addExtra} className="flex gap-2">
            <input className="input" name="name" placeholder="Add something else…" required />
            <input className="input w-20" name="quantity" type="number" step="any" min="0" placeholder="qty" />
            <Submit className="btn-primary">Add</Submit>
          </form>
        </div>
      </section>

      {!!plans?.length && (
        <section>
          <h2 className="label">Planned meals driving this list</h2>
          <ul className="card divide-y divide-border p-0">
            {plans.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2">
                <Link href={`/recipes/${p.recipe_id}`}>
                  {p.recipes.title}
                  {Number(p.batches) !== 1 && <span className="text-muted"> × {fmtQty(p.batches)}</span>}
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
