"use client";

import { useOptimistic, useState } from "react";
import { fmtQty, unitFactor, unitLabel, type ShoppingListRow } from "@/lib/types";
import { buyItem, removeFromList, setBuyAmount } from "../actions";
import { SaveError, fd, useAction } from "@/components/use-action";

/** Units packages come in: the item's own unit plus convertible ones among g/kg/ml/l (no spoons or cups). */
const PACKAGE_UNITS = ["g", "kg", "ml", "l"];
function buyUnits(unit: string) {
  return [unit, ...PACKAGE_UNITS.filter((u) => u !== unit && unitFactor(u, unit) !== null)];
}

export function ShoppingItem({ item, reason }: { item: ShoppingListRow; reason: string }) {
  const [hidden, setHidden] = useOptimistic(false);
  const [editing, setEditing] = useState(false);
  const { pending, failed, run } = useAction();

  const buy = (amount: number | null) =>
    run(async () => {
      setHidden(true);
      await buyItem(fd({ ingredient_id: item.ingredient_id, amount }));
    });

  if (hidden) return null;

  const listed = item.to_buy === null ? null : Number(item.to_buy);
  const suggested = item.suggested === null ? null : Number(item.suggested);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <button
        type="button"
        onClick={() => buy(listed)}
        disabled={pending}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-accent text-accent hover:bg-accent-soft"
        aria-label={`Bought ${item.name}`}
        title={listed === null ? "Bought — adds it to the pantry" : `Bought ${fmtQty(listed, item.unit)} — adds it to the pantry`}
      />

      <div className="min-w-0 flex-1">
        <div>
          <span className="font-medium">{item.name}</span>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className={`ml-1 rounded-md px-1 underline decoration-dotted underline-offset-4 hover:bg-background hover:text-foreground ${
              item.adjusted ? "text-accent" : "text-muted"
            }`}
            aria-label={`Change how much ${item.name} to buy`}
            aria-expanded={editing}
            title="Change how much to buy"
          >
            {listed !== null ? fmtQty(listed, item.unit) : "some"} ✏️
          </button>
        </div>
        {(reason || item.adjusted) && (
          <div className="text-xs text-muted">
            {item.adjusted && (
              <span className="text-accent">
                your amount{suggested !== null && ` · list says ${fmtQty(suggested, item.unit)}`}
              </span>
            )}
            {item.adjusted && reason && " · "}
            {reason}
          </div>
        )}
      </div>

      {(item.manual || item.restock) && !item.planned_short && (
        <button
          type="button"
          onClick={() => run(() => removeFromList(fd({ ingredient_id: item.ingredient_id })))}
          disabled={pending}
          className="btn px-2 text-muted"
          aria-label={`Remove ${item.name} from list`}
          title={item.restock ? "Remove and stop auto-adding this item" : "Remove from list"}
        >
          ✕
        </button>
      )}

      {editing && (
        <AmountPanel
          item={item}
          onCancel={() => setEditing(false)}
          onBuy={(amount) => {
            setEditing(false);
            buy(amount);
          }}
          onSave={(amount) => {
            setEditing(false);
            run(() => setBuyAmount(item.ingredient_id, amount));
          }}
        />
      )}
      {failed && <SaveError className="basis-full pl-10" />}
    </li>
  );
}

/** How much to buy: keep it for the shop, or tick it off as bought right away. */
function AmountPanel({
  item,
  onBuy,
  onSave,
  onCancel,
}: {
  item: ShoppingListRow;
  onBuy: (amount: number | null) => void;
  onSave: (amount: number | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(item.to_buy === null ? "" : String(Number(item.to_buy)));
  const [unit, setUnit] = useState(item.unit);
  const units = buyUnits(item.unit);

  const entered = value.trim() === "" ? null : Number(value);
  const inStockUnit = entered === null ? null : entered * (unitFactor(unit, item.unit) ?? 1);
  const suggested = item.suggested === null ? null : Number(item.suggested);
  // Buying less than the plan is short of leaves the rest on the list.
  const short = item.planned_short && suggested !== null && inStockUnit !== null && inStockUnit < suggested;
  const valid = inStockUnit === null || inStockUnit >= 0;

  return (
    <form
      className="basis-full rounded-xl bg-background p-3 sm:ml-10"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(inStockUnit);
      }}
    >
      <label className="label" htmlFor={`buy-${item.ingredient_id}`}>How much do you want to buy?</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`buy-${item.ingredient_id}`}
          className="input w-24 py-1.5 text-right"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          placeholder="some"
          value={value}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
        />
        {units.length > 1 ? (
          <select className="input w-auto py-1.5" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
            {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
          </select>
        ) : (
          <span className="text-sm text-muted">{unitLabel(unit)}</span>
        )}
        <span className="flex flex-wrap items-center gap-1">
          <button type="submit" className="btn-primary py-1.5" disabled={!valid}>
            Save
          </button>
          <button type="button" className="btn py-1.5" disabled={!valid} onClick={() => onBuy(inStockUnit)}>
            Bought it
          </button>
          <button type="button" className="btn px-2 py-1.5 text-muted" onClick={onCancel} aria-label="Cancel">✕</button>
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">
        {unit !== item.unit && inStockUnit !== null && `= ${fmtQty(inStockUnit, item.unit)} in the pantry. `}
        <b>Save</b> keeps this amount on the list for when you shop. <b>Bought it</b> adds it to the pantry and ticks it off
        {short && ` — the remaining ${fmtQty(suggested - inStockUnit, item.unit)} stays on the list`}.
      </p>
      {item.adjusted && (
        <button type="button" className="mt-1 text-xs text-accent underline" onClick={() => onSave(null)}>
          Back to {suggested === null ? "no set amount" : fmtQty(suggested, item.unit)}
        </button>
      )}
    </form>
  );
}
