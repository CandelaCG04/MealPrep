"use client";

import { useState, useTransition } from "react";
import { deleteConversion, saveConversion } from "../actions";
import { UNITS, fmtQty, ingredientFactor, unitLabel, type Conversion, type Ingredient } from "@/lib/types";

/**
 * Shown under a recipe line whose unit differs from how the pantry tracks the
 * ingredient: explains the conversion and lets you set a custom one
 * (e.g. 250 ml broth = 5 g powder).
 */
export function UnitHint({
  ingredient,
  unit,
  quantity,
  conversions,
  onChange,
}: {
  ingredient: Ingredient;
  unit: string;
  quantity: number | null;
  conversions: Conversion[];
  onChange: (next: Conversion[]) => void;
}) {
  const own = conversions.filter((c) => c.ingredient_id === ingredient.id);
  const { factor, via } = ingredientFactor(own, unit, ingredient.unit);
  const exact = own.find((c) => c.unit === unit);

  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState<number | "">(exact?.amount ?? quantity ?? 1);
  const [equalsAmount, setEqualsAmount] = useState<number | "">(exact?.equals_amount ?? "");
  const [equalsUnit, setEqualsUnit] = useState(exact?.equals_unit ?? ingredient.unit);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (unit === ingredient.unit) return null;

  function save() {
    setError(undefined);
    start(async () => {
      const res = await saveConversion({
        ingredient_id: ingredient.id,
        unit,
        amount: Number(amount),
        equals_amount: Number(equalsAmount),
        equals_unit: equalsUnit,
      });
      if ("error" in res) return setError(res.error);
      onChange([...conversions.filter((c) => c.id !== res.conversion.id && !(c.ingredient_id === ingredient.id && c.unit === unit)), res.conversion]);
      setEditing(false);
    });
  }

  function remove() {
    if (!exact) return;
    start(async () => {
      await deleteConversion(exact.id);
      onChange(conversions.filter((c) => c.id !== exact.id));
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div className="col-span-3 flex flex-col gap-2 rounded-xl bg-background p-2 text-sm">
        <p className="text-xs text-muted">
          How much {ingredient.name} from the pantry does this recipe amount use?
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <input className="input w-20 px-2 py-1" type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")} aria-label="Recipe amount" />
          <span>{unitLabel(unit)} in recipes</span>
          <span className="px-1">=</span>
          <input className="input w-20 px-2 py-1" type="number" step="any" min="0" value={equalsAmount} onChange={(e) => setEqualsAmount(e.target.value ? Number(e.target.value) : "")} aria-label="Pantry amount" autoFocus />
          <select className="input w-auto px-1 py-1" value={equalsUnit} onChange={(e) => setEqualsUnit(e.target.value)} aria-label="Pantry unit">
            {[...new Set([ingredient.unit, ...UNITS])].map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
          </select>
          <span className="text-muted">from the pantry</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary px-3 py-1" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</button>
          <button type="button" className="btn px-2 py-1 text-muted" onClick={() => setEditing(false)}>Cancel</button>
          {exact && <button type="button" className="btn ml-auto px-2 py-1 text-danger" onClick={remove} disabled={pending}>Remove</button>}
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
        <p className="text-xs text-muted">Applies to every recipe using {ingredient.name} in {unitLabel(unit)}.</p>
      </div>
    );
  }

  const link = (label: string) => (
    <button type="button" className="underline" onClick={() => setEditing(true)}>{label}</button>
  );

  return (
    <p className={`col-span-3 -mt-1 text-xs ${factor === null ? "text-warn" : "text-muted"}`}>
      {factor === null ? (
        <>
          Pantry counts {ingredient.name} in {unitLabel(ingredient.unit)}, so {unitLabel(unit)} can&apos;t be converted — it&apos;ll only check you have some. {link("Set a conversion")}
        </>
      ) : (
        <>
          {quantity ? `= ${fmtQty(quantity * factor, ingredient.unit)} from the pantry` : `Converted to ${unitLabel(ingredient.unit)} for the pantry`}
          {via && ` (using ${fmtQty(via.amount, via.unit)} = ${fmtQty(via.equals_amount, via.equals_unit)})`}
          {" · "}
          {link(via ? "edit" : "not right?")}
        </>
      )}
    </p>
  );
}
