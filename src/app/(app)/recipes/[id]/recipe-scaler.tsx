"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PHASES, fmtQty, unitLabel, type CookPhase, type CookingSession, type Ingredient, type RecipeIngredientStatus, type RecipeSummary } from "@/lib/types";
import { cancelCooking, planRecipe, setCookingPhase, setCookingSteps, setCookingTimer, startCooking } from "../../actions";
import { fmtClock, fmtMinutes, fmtSince, fmtUntil } from "@/lib/dates";
import { useAction } from "@/components/use-action";
import { Submit } from "@/components/submit";
import { MadeFrom, type SourceWithName } from "./made-from";
import { renderStep } from "@/lib/steps";
import { CookSection, type Unmeasured } from "./cook-section";

type Shortfall = {
  have: boolean;
  missing: number | null; // in stock_unit
  viaSource: boolean;
  sourceNeeded: number | null; // in source_unit
};

/**
 * Mirrors the recipe_ingredient_status view, but for a scaled amount.
 * Compares in the pantry unit; when the ingredient itself falls short, checks what it's made from.
 */
function shortfall(line: RecipeIngredientStatus, factor: number): Shortfall {
  const need = line.stock_quantity === null ? null : Number(line.stock_quantity) * factor;
  const onHand = line.on_hand === null ? null : Number(line.on_hand);

  let own: { have: boolean; missing: number | null };
  if (!line.in_pantry) own = { have: false, missing: null };
  else if (onHand === null) own = { have: true, missing: null }; // untracked stock counts as enough
  else if (onHand <= 0) own = { have: false, missing: null };
  else if (need === null) own = { have: true, missing: null }; // "to taste" or units can't be compared
  else own = onHand >= need ? { have: true, missing: null } : { have: false, missing: need - onHand };

  if (own.have || !line.source_name) return { ...own, viaSource: false, sourceNeeded: null };

  const ownShort = need === null ? null : Math.max(need - Math.max(onHand ?? 0, 0), 0);
  const sourceNeeded = ownShort !== null && line.source_factor !== null ? ownShort * Number(line.source_factor) : null;
  const sourceOnHand = line.source_on_hand === null ? null : Number(line.source_on_hand);
  const viaSource =
    line.source_in_pantry &&
    // tiny tolerance: ratios like 1/30 make "need exactly what you have" land a hair above it
    (sourceOnHand === null || (sourceOnHand > 0 && (sourceNeeded === null || sourceOnHand >= sourceNeeded - 1e-9)));
  return { have: viaSource, missing: own.missing, viaSource, sourceNeeded };
}

/**
 * Ingredients cooking can't deduct by amount, so it's worth asking whether they ran out:
 * pantry stock without an amount ("some"), recipe lines without an amount, units that don't convert —
 * and the same for a "made from" source that's being used instead.
 */
function unmeasuredIngredients(lines: (RecipeIngredientStatus & Shortfall)[], sources: Record<string, SourceWithName>): Unmeasured[] {
  const found = new Map<string, Unmeasured>();
  for (const l of lines) {
    const onHand = l.on_hand === null ? null : Number(l.on_hand);
    if (l.in_pantry && (onHand === null || onHand > 0)) {
      const reason =
        onHand === null ? "amount not tracked"
        : l.quantity === null ? "no amount in the recipe"
        : l.stock_quantity === null ? `${unitLabel(l.unit)} don't convert to ${unitLabel(l.stock_unit)}`
        : null;
      if (reason && !found.has(l.ingredient_id)) found.set(l.ingredient_id, { ingredientId: l.ingredient_id, name: l.name, reason });
    }
    const source = sources[l.ingredient_id];
    if (l.viaSource && source && !found.has(source.source_ingredient_id)) {
      const reason = l.source_on_hand === null ? "amount not tracked" : l.sourceNeeded === null ? `used for ${l.name}` : null;
      if (reason) found.set(source.source_ingredient_id, { ingredientId: source.source_ingredient_id, name: source.source_name, reason });
    }
  }
  return [...found.values()];
}

export function RecipeScaler({
  recipe,
  ingredients,
  planCount,
  sources,
  catalog,
  session,
}: {
  recipe: RecipeSummary;
  ingredients: RecipeIngredientStatus[];
  planCount: number;
  sources: Record<string, SourceWithName>;
  catalog: Ingredient[];
  /** Set while this recipe is being cooked (steps ticked so far, optional timer). */
  session: CookingSession | null;
}) {
  const base = recipe.servings ?? 1;
  const unitWord = recipe.servings ? "portions" : "batches";
  const [amount, setAmount] = useState(session ? Math.max(1, Math.round(Number(session.batches) * base)) : base);
  const [done, setDone] = useState<Set<number>>(new Set(session?.done_steps ?? []));
  const cooking = useAction();
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const toggleStep = (i: number) => {
    const next = new Set(done);
    if (!next.delete(i)) next.add(i);
    setDone(next);
    // While cooking, remember the ticks so you can close the app mid-marinade.
    if (session) cooking.run(() => setCookingSteps(session.id, [...next].sort((a, b) => a - b)));
  };
  const factor = amount / base;

  const lines = ingredients.map((l) => ({ ...l, ...shortfall(l, factor) }));
  const missing = lines.filter((l) => !l.have && !l.optional);
  const scaled = amount !== base;

  const step = (delta: number) => setAmount((a) => Math.max(1, a + delta));

  /** "60 ml soy sauce" for the ingredient bits inside steps, scaled to the chosen portions. */
  const amountOf = (ingredientId: string) => {
    const line = lines.find((l) => l.ingredient_id === ingredientId);
    if (!line) return null;
    // Names are stored capitalised ("Soy sauce"); mid-sentence they read better in lower case.
    const name = /^[A-Z][a-z]/.test(line.name) ? line.name[0].toLowerCase() + line.name.slice(1) : line.name;
    return line.quantity === null ? name : `${fmtQty(Number(line.quantity) * factor, line.unit)} ${name}`;
  };

  return (
    <>
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium capitalize">{unitWord}</span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost h-9 w-9 p-0 text-lg" onClick={() => step(-1)} disabled={amount <= 1} aria-label={`Fewer ${unitWord}`}>
              −
            </button>
            <input
              className="input w-16 text-center"
              type="number"
              min="1"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
              aria-label={unitWord}
            />
            <button type="button" className="btn-ghost h-9 w-9 p-0 text-lg" onClick={() => step(1)} aria-label={`More ${unitWord}`}>
              +
            </button>
          </div>
        </div>
        {scaled && (
          <p className="-mt-2 text-sm text-muted">
            Scaled ×{fmtQty(factor)} from {base} {unitWord}.{" "}
            <button type="button" className="underline" onClick={() => setAmount(base)}>Reset</button>
          </p>
        )}

        {missing.length === 0 ? (
          <p className="font-medium text-accent">✓ You have everything for {amount} {unitWord}.</p>
        ) : (
          <p className="font-medium text-warn">
            Missing {missing.length} of {recipe.required_count} ingredients for {amount} {unitWord}.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <form action={planRecipe}>
            <input type="hidden" name="recipe_id" value={recipe.id} />
            <input type="hidden" name="batches" value={factor} />
            <Submit className={missing.length ? "btn-primary" : "btn-ghost"} pendingText="Adding…">
              {missing.length ? "🛒 Add missing to list" : "📌 Plan this meal"}
            </Submit>
          </form>
          <Link href={`/recipes/${recipe.id}/edit`} className="btn-ghost">Edit</Link>
        </div>
        {planCount > 0 && (
          <p className="text-sm text-muted">
            📌 Planned {planCount > 1 ? `${planCount}×` : ""} — its missing ingredients are on your{" "}
            <Link href="/shopping" className="underline">shopping list</Link>.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Ingredients</h2>
        <ul className="card divide-y divide-border p-0">
          {lines.map((l) => {
            const editing = editingSource === l.ingredient_id;
            const sourceUnit = l.source_unit ?? undefined;
            return (
              <li key={l.id} className="flex items-start gap-3 px-4 py-2">
                <span className={`mt-0.5 ${l.have ? "text-accent" : l.optional ? "text-muted" : "text-warn"}`}>
                  {l.have ? "✓" : "○"}
                </span>
                <div className="min-w-0 flex-1">
                  <span className={l.optional ? "text-muted" : ""}>
                    {l.quantity !== null && <span className="font-medium">{fmtQty(Number(l.quantity) * factor, l.unit)} </span>}
                    {l.name}
                    {l.note && <span className="text-muted">, {l.note}</span>}
                    {l.optional && <span className="text-muted"> (optional)</span>}
                  </span>

                  {!l.have && l.in_pantry && l.on_hand !== null && Number(l.on_hand) > 0 && (
                    <div className="text-xs text-muted">
                      have {fmtQty(l.on_hand, l.stock_unit)}
                      {l.missing !== null && ` · need ${fmtQty(l.missing, l.stock_unit)} more`}
                    </div>
                  )}

                  {l.source_name && !editing && (l.viaSource || !l.have) && (
                    <div className={`text-xs ${l.viaSource ? "text-accent" : "text-muted"}`}>
                      {l.viaSource ? "from " : "or from "}
                      {l.source_name}
                      {l.sourceNeeded !== null && ` · ${l.viaSource ? "uses" : "needs"} ${fmtQty(l.sourceNeeded, sourceUnit)}`}
                      {!l.viaSource &&
                        (!l.source_in_pantry
                          ? " (none in pantry)"
                          : l.source_on_hand !== null
                            ? ` (have ${fmtQty(l.source_on_hand, sourceUnit)})`
                            : "")}
                      {" · "}
                      <button type="button" className="underline" onClick={() => setEditingSource(l.ingredient_id)}>
                        edit
                      </button>
                    </div>
                  )}

                  {!l.source_name && !l.have && !l.optional && !editing && (
                    <button type="button" className="block text-xs text-muted underline" onClick={() => setEditingSource(l.ingredient_id)}>
                      Made from something you have?
                    </button>
                  )}

                  <MadeFrom
                    key={`${l.ingredient_id}-${sources[l.ingredient_id]?.id ?? "new"}`}
                    ingredientId={l.ingredient_id}
                    ingredientName={l.name}
                    defaultUnit={l.stock_unit}
                    source={sources[l.ingredient_id]}
                    catalog={catalog}
                    open={editing}
                    onOpenChange={(o) => setEditingSource(o ? l.ingredient_id : null)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {recipe.steps.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Steps</h2>
            {!session && (
              <button
                type="button"
                className="btn-ghost py-1.5 text-sm"
                onClick={() => cooking.run(() => startCooking(recipe.id, factor))}
                title="Keeps your ticked steps and a timer, for recipes with long waits"
              >
                ▶️ Start cooking
              </button>
            )}
          </div>
          {session && <CookingBanner session={session} doneCount={done.size} total={recipe.steps.length} run={cooking.run} />}
          <p className="mb-2 text-xs text-muted">
            Tap a step to tick it off while you cook.
            {scaled && ` Highlighted amounts follow the portions; any you typed by hand are for ${base} ${unitWord}.`}
          </p>
          <ol className="card flex flex-col gap-1 p-2">
            {recipe.steps.map((stepText, i) => {
              const isDone = done.has(i);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => toggleStep(i)}
                    className={`flex w-full items-start gap-3 rounded-xl p-2 text-left transition hover:bg-background ${isDone ? "text-muted" : ""}`}
                    aria-pressed={isDone}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        isDone ? "bg-accent text-white dark:text-black" : "bg-accent-soft text-accent"
                      }`}
                    >
                      {isDone ? "✓" : i + 1}
                    </span>
                    <span className={`pt-0.5 leading-relaxed whitespace-pre-line ${isDone ? "line-through" : ""}`}>
                      {renderStep(stepText, amountOf).map((part, j) =>
                        part.kind === "amount" ? (
                          <b key={j} className={isDone ? "" : "text-accent"}>{part.text}</b>
                        ) : (
                          <span key={j}>{part.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {recipe.notes && (
        <section>
          <h2 className="mb-2 font-semibold">Notes</h2>
          <div className="card whitespace-pre-line">{recipe.notes}</div>
        </section>
      )}

      <CookSection
        recipeId={recipe.id}
        factor={factor}
        amount={amount}
        unitWord={unitWord}
        freezeDefault={recipe.freezable && recipe.servings ? amount : 0}
        unmeasured={unmeasuredIngredients(lines, sources)}
      />
    </>
  );
}

/** While a recipe is in progress: when it started, how far along, and an optional "back in…" timer. */
function CookingBanner({
  session,
  doneCount,
  total,
  run,
}: {
  session: CookingSession;
  doneCount: number;
  total: number;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const left = session.wait_until ? fmtUntil(session.wait_until) : null;
  const ready = session.wait_until !== null && left === null;

  return (
    <div className={`mb-2 flex flex-col gap-2 rounded-2xl border p-3 text-sm ${ready ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">🍳 Cooking</span>
        <span className="text-muted">
          started {fmtSince(session.started_at)} · {doneCount} of {total} steps
        </span>
      </div>

      <PhaseTracker session={session} run={run} />
      {session.wait_until && (
        <p className={ready ? "font-medium text-accent" : "text-muted"}>
          {ready ? "⏰ Wait is over — carry on." : `⏲ Back in ${left} (around ${fmtClock(session.wait_until)})`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">{session.wait_until ? "Change timer:" : "Set a timer:"}</span>
        {[15, 30, 60, 120, 480].map((minutes) => (
          <button
            key={minutes}
            type="button"
            className="rounded-full border border-border bg-background px-2 py-1 text-xs hover:border-accent"
            onClick={() => run(() => setCookingTimer(session.id, minutes))}
          >
            {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
          </button>
        ))}
        {session.wait_until && (
          <button type="button" className="px-1 text-xs text-muted underline" onClick={() => run(() => setCookingTimer(session.id, null))}>
            clear
          </button>
        )}
        <button type="button" className="ml-auto px-1 text-xs text-muted underline" onClick={() => run(() => cancelCooking(session.id))}>
          Stop cooking
        </button>
      </div>
    </div>
  );
}

/** Seconds banked in each phase, plus the stretch running right now. */
function phaseSeconds(session: CookingSession, now: number) {
  const banked = { prep: session.prep_seconds, wait: session.wait_seconds, cook: session.cook_seconds };
  if (session.phase && session.phase_started_at) {
    banked[session.phase] += Math.max(0, Math.round((now - new Date(session.phase_started_at).getTime()) / 1000));
  }
  return banked;
}

const asMinutes = (seconds: number) => (seconds < 60 ? "under a minute" : fmtMinutes(Math.round(seconds / 60)));

/** What you're doing right now (prepping / waiting / cooking) and how long each has taken. */
function PhaseTracker({ session, run }: { session: CookingSession; run: (fn: () => Promise<unknown>) => void }) {
  // Re-render every 15 s so the running phase keeps counting up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!session.phase) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [session.phase]);

  const seconds = phaseSeconds(session, now);
  const totalSeconds = seconds.prep + seconds.wait + seconds.cook;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {PHASES.map(({ key, label, icon }) => {
          const active = session.phase === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => run(() => setCookingPhase(session.id, active ? null : (key as CookPhase)))}
              title={active ? "Tap again to pause the clock" : `Start timing ${label.toLowerCase()}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active ? "border-accent bg-accent text-white dark:text-black" : "border-border bg-background hover:border-accent"
              }`}
            >
              {icon} {label}
              {seconds[key] > 0 && <span className={active ? "" : "text-muted"}> · {asMinutes(seconds[key])}</span>}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        {session.phase
          ? `Timing ${PHASES.find((p) => p.key === session.phase)?.label.toLowerCase()} — tap it again to pause.`
          : totalSeconds > 0
            ? "Paused. Tap a phase to carry on timing."
            : "Tap what you're doing so the app learns how long this recipe takes you."}
        {totalSeconds > 0 && ` Total so far ${asMinutes(totalSeconds)}.`}
      </p>
    </div>
  );
}
