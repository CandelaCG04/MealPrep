"use client";

import { useState, useTransition } from "react";
import { IngredientInput, findExact } from "@/components/ingredient-input";
import { UNITS, fmtQty, unitLabel, type Ingredient, type IngredientSource } from "@/lib/types";
import { deleteIngredientSource, saveIngredientSource } from "../../actions";

export type SourceWithName = IngredientSource & { source_name: string };

/**
 * Inline editor for "30 ml of Lime juice comes from 1 lime".
 * Shown under a recipe ingredient line.
 */
export function MadeFrom({
  ingredientId,
  ingredientName,
  defaultUnit,
  source,
  catalog,
  open,
  onOpenChange,
}: {
  ingredientId: string;
  ingredientName: string;
  defaultUnit: string;
  source: SourceWithName | undefined;
  catalog: Ingredient[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amount, setAmount] = useState<number | "">(source?.amount ?? "");
  const [unit, setUnit] = useState(source?.unit ?? defaultUnit);
  const [sourceName, setSourceName] = useState(source?.source_name ?? "");
  const [sourceAmount, setSourceAmount] = useState<number | "">(source?.source_amount ?? 1);
  const [sourceUnit, setSourceUnit] = useState(source?.source_unit ?? "pc");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (!open) return null;

  const others = catalog.filter((i) => i.id !== ingredientId);
  const known = findExact(others, sourceName);

  function save() {
    setError(undefined);
    start(async () => {
      try {
        const res = await saveIngredientSource({
          ingredient_id: ingredientId,
          amount: Number(amount),
          unit,
          source_name: sourceName,
          source_amount: Number(sourceAmount),
          source_unit: sourceUnit,
          source_category: known?.category ?? "produce",
        });
        if ("error" in res) return setError(res.error);
        onOpenChange(false);
      } catch {
        setError("Couldn't save — check your connection and try again.");
      }
    });
  }

  function remove() {
    start(async () => {
      try {
        await deleteIngredientSource(ingredientId);
        onOpenChange(false);
      } catch {
        setError("Couldn't remove — check your connection and try again.");
      }
    });
  }

  const unitOptions = (current: string) => [...new Set([current, ...UNITS])].map((u) => <option key={u} value={u}>{unitLabel(u)}</option>);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl bg-background p-3 text-sm">
      <p className="text-xs text-muted">
        When you don&apos;t have {ingredientName}, having what it&apos;s made from counts — and the shopping list asks for that instead.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input className="input w-20 px-2 py-1" type="number" step="any" min="0" placeholder="30" value={amount} onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")} aria-label={`Amount of ${ingredientName}`} autoFocus />
        <select className="input w-auto px-1 py-1" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={`Unit of ${ingredientName}`}>
          {unitOptions(unit)}
        </select>
        <span>of {ingredientName} comes from</span>
      </div>
      <div className="flex flex-wrap items-start gap-1.5">
        <input className="input w-20 px-2 py-1" type="number" step="any" min="0" value={sourceAmount} onChange={(e) => setSourceAmount(e.target.value ? Number(e.target.value) : "")} aria-label="Amount of source" />
        <select className="input w-auto px-1 py-1" value={sourceUnit} onChange={(e) => setSourceUnit(e.target.value)} aria-label="Unit of source">
          {unitOptions(sourceUnit)}
        </select>
        <IngredientInput
          className="min-w-40 flex-1"
          catalog={others}
          value={sourceName}
          placeholder="e.g. Limes"
          onChange={setSourceName}
          onPick={(i) => setSourceUnit(i.unit)}
        />
      </div>
      {known && amount !== "" && sourceAmount !== "" && (
        <p className="text-xs text-muted">
          {fmtQty(Number(amount), unit)} {ingredientName} = {fmtQty(Number(sourceAmount), sourceUnit)} {known.name}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary px-3 py-1" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn px-2 py-1 text-muted" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        {source && (
          <button type="button" className="btn ml-auto px-2 py-1 text-danger" onClick={remove} disabled={pending}>
            Remove link
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
