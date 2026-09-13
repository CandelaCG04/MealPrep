"use client";

import { useState } from "react";
import { cookRecipe } from "../../actions";
import { Submit } from "@/components/submit";

/** An ingredient the app can't deduct by amount, so it asks whether it ran out. */
export type Unmeasured = { ingredientId: string; name: string; reason: string };

export function CookSection({
  recipeId,
  factor,
  amount,
  unitWord,
  freezeDefault,
  unmeasured,
}: {
  recipeId: string;
  factor: number;
  amount: number;
  unitWord: string;
  freezeDefault: number;
  unmeasured: Unmeasured[];
}) {
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();

  async function cook(fd: FormData) {
    setError(undefined);
    try {
      await cookRecipe(fd);
      const ranOut = fd.getAll("ran_out").length;
      setDone(ranOut ? `Saved — ${ranOut} marked as ran out.` : "Saved.");
      setAsking(false);
    } catch {
      setError("Couldn't save — check your connection and try again.");
    }
  }

  return (
    <section className="card">
      <h2 className="font-semibold">I cooked this</h2>
      <p className="mb-3 text-sm text-muted">
        Deducts the ingredients for {amount} {unitWord} from the pantry and clears one plan.
      </p>
      <form
        action={cook}
        onSubmit={(e) => {
          // First press: if some ingredients can't be measured, ask about them before saving.
          if (unmeasured.length && !asking) {
            e.preventDefault();
            setDone(undefined);
            setAsking(true);
          }
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="recipe_id" value={recipeId} />
        <input type="hidden" name="batches" value={factor} />
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="freeze_portions">Portions to freeze</label>
            <input key={amount} className="input w-32" id="freeze_portions" name="freeze_portions" type="number" min="0" defaultValue={freezeDefault} />
          </div>
          {!asking && (
            <Submit className="btn-primary" pendingText="Saving…">
              Cooked {amount} {unitWord}
            </Submit>
          )}
        </div>

        {asking && (
          <fieldset className="flex flex-col gap-2 rounded-xl bg-background p-3">
            <legend className="sr-only">Did any of these run out?</legend>
            <p className="font-medium">Did any of these run out?</p>
            <p className="-mt-1 text-xs text-muted">The app can&apos;t tell on its own — their amounts aren&apos;t measured.</p>
            <ul className="flex flex-col gap-1">
              {unmeasured.map((u) => (
                <li key={u.ingredientId}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface">
                    <input type="checkbox" name="ran_out" value={u.ingredientId} className="h-5 w-5 accent-[var(--accent)]" />
                    <span className="flex-1">
                      {u.name} <span className="text-xs text-muted">· {u.reason}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Submit className="btn-primary" pendingText="Saving…">
                Save — cooked {amount} {unitWord}
              </Submit>
              <button type="button" className="btn text-muted" onClick={() => setAsking(false)}>
                Back
              </button>
            </div>
            <p className="text-xs text-muted">Leave everything unticked if nothing ran out.</p>
          </fieldset>
        )}

        {done && <p className="text-sm text-accent">✓ {done}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </section>
  );
}
