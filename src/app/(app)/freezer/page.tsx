import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ageLabel, daysSince, freezerTone } from "@/lib/dates";
import type { FrozenMeal } from "@/lib/types";
import { addFrozenMeal, deleteFrozenMeal, eatFrozenPortion } from "../actions";
import { Submit } from "@/components/submit";

export default async function FreezerPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("frozen_meals").select("*").order("frozen_on").returns<FrozenMeal[]>();
  const meals = data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="h1">Freezer</h1>
        <span className="text-muted">{meals.reduce((n, m) => n + m.portions, 0)} portions</span>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-medium">Add a frozen meal</summary>
        <form action={addFrozenMeal} className="mt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor="name">Meal</label>
            <input className="input" id="name" name="name" required placeholder="Lentil curry" />
          </div>
          <div>
            <label className="label" htmlFor="portions">Portions</label>
            <input className="input" id="portions" name="portions" type="number" min="1" defaultValue={4} required />
          </div>
          <div>
            <label className="label" htmlFor="frozen_on">Frozen on</label>
            <input className="input" id="frozen_on" name="frozen_on" type="date" defaultValue={today} max={today} />
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="notes">Notes</label>
            <input className="input" id="notes" name="notes" placeholder="Top drawer, blue tub" />
          </div>
          <Submit className="btn-primary col-span-2">Add</Submit>
        </form>
        <p className="mt-3 text-xs text-muted">Tip: cooking a recipe from its page can freeze portions automatically.</p>
      </details>

      {meals.length ? (
        <ul className="flex flex-col gap-3">
          {meals.map((m) => {
            const days = daysSince(m.frozen_on);
            const tone = freezerTone(days);
            return (
              <li
                key={m.id}
                className={`card flex items-center gap-3 ${tone === "old" ? "border-warn bg-warn-soft" : ""}`}
              >
                <div className="flex-1">
                  <div className="font-medium">
                    {m.recipe_id ? <Link href={`/recipes/${m.recipe_id}`}>{m.name}</Link> : m.name}
                  </div>
                  <div className={`text-sm ${tone === "fresh" ? "text-muted" : "text-warn"}`}>
                    Frozen {ageLabel(days)} · {new Date(m.frozen_on + "T00:00:00").toLocaleDateString()}
                    {tone === "old" && " · eat soon"}
                  </div>
                  {m.notes && <div className="text-sm text-muted">{m.notes}</div>}
                </div>
                <div className="text-2xl font-semibold tabular-nums">{m.portions}</div>
                <form action={eatFrozenPortion}>
                  <input type="hidden" name="id" value={m.id} />
                  <Submit className="btn-ghost" title="Take one portion out">−1</Submit>
                </form>
                <form action={deleteFrozenMeal}>
                  <input type="hidden" name="id" value={m.id} />
                  <Submit className="btn px-2 text-muted" aria-label="Remove">✕</Submit>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted">Nothing in the freezer yet.</p>
      )}
    </div>
  );
}
