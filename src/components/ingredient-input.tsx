"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CATEGORIES, UNITS, unitLabel, type Ingredient } from "@/lib/types";

/** Spellings that should count as the same ingredient: case, accents, plurals. */
function variants(name: string) {
  const base = name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ");
  return new Set([base, base.replace(/s$/, ""), base.replace(/es$/, "")]);
}

export function findExact(catalog: Ingredient[], name: string) {
  const key = name.trim().toLowerCase();
  return key ? catalog.find((i) => i.name.toLowerCase() === key) : undefined;
}

function findSimilar(catalog: Ingredient[], name: string) {
  const v = variants(name);
  return catalog.find((i) => [...variants(i.name)].some((x) => v.has(x)));
}

function suggest(catalog: Ingredient[], query: string) {
  const q = [...variants(query)][0];
  if (!q) return [];
  const plain = (s: string) => [...variants(s)][0];
  return catalog
    .map((i) => ({ i, n: plain(i.name) }))
    .filter(({ n }) => n.includes(q) || [...variants(query)].some((v) => v && n.startsWith(v)))
    .sort((a, b) => Number(b.n.startsWith(q)) - Number(a.n.startsWith(q)) || a.n.localeCompare(b.n))
    .slice(0, 6)
    .map(({ i }) => i);
}

/**
 * Text input with a dropdown of existing ingredients, plus a "did you mean"
 * hint for near-duplicates. Works on phones (unlike <datalist> on iOS).
 */
export function IngredientInput({
  catalog,
  value,
  onChange,
  onPick,
  name,
  id,
  placeholder = "Ingredient",
  required,
  className = "",
}: {
  catalog: Ingredient[];
  value: string;
  onChange: (value: string) => void;
  onPick?: (ingredient: Ingredient) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const exact = findExact(catalog, value);
  const similar = !exact && value.trim() ? findSimilar(catalog, value) : undefined;
  const options = exact ? [] : suggest(catalog, value);

  function pick(i: Ingredient) {
    onChange(i.name);
    onPick?.(i);
    setOpen(false);
  }

  return (
    <div className={`relative ${className}`}>
      <input
        className="input"
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!open || !options.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
          if (e.key === "Enter") { e.preventDefault(); pick(options[active]); }
          if (e.key === "Escape") setOpen(false);
        }}
      />

      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {options.map((i, idx) => (
            <li
              key={i.id}
              role="option"
              aria-selected={idx === active}
              // mousedown fires before the input's blur, so the pick isn't lost
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              className={`flex cursor-pointer justify-between px-3 py-2 ${idx === active ? "bg-accent-soft" : ""}`}
            >
              <span>{i.name}</span>
              <span className="text-sm text-muted">{unitLabel(i.unit)}</span>
            </li>
          ))}
        </ul>
      )}

      {value.trim() && !exact && (
        <p className="mt-1 text-xs">
          {similar ? (
            <button type="button" className="text-warn underline" onClick={() => pick(similar)}>
              You already have &ldquo;{similar.name}&rdquo; — use that?
            </button>
          ) : (
            <span className="text-muted">New ingredient</span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Name + amount + unit (+ category for new ingredients) for plain server-action forms.
 * Submits fields: name, quantity, unit, category.
 */
export function IngredientFields({
  catalog,
  defaultUnit = "g",
  quantityPlaceholder = "amount",
}: {
  catalog: Ingredient[];
  defaultUnit?: string;
  quantityPlaceholder?: string;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState(defaultUnit);
  const [category, setCategory] = useState("other");
  const ref = useRef<HTMLDivElement>(null);
  const known = findExact(catalog, name);
  const nameId = useId();

  // React resets the form after a successful action; clear our controlled state too.
  useEffect(() => {
    const form = ref.current?.closest("form");
    const reset = () => { setName(""); setUnit(defaultUnit); setCategory("other"); };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultUnit]);

  return (
    <div ref={ref} className="col-span-2 grid grid-cols-[1fr_6rem_6rem] items-start gap-2">
      <div>
        <label className="label" htmlFor={nameId}>Ingredient</label>
        <IngredientInput id={nameId} name="name" catalog={catalog} value={name} onChange={setName} required />
      </div>
      <div>
        <label className="label" htmlFor={`${nameId}-q`}>Amount</label>
        <input className="input" id={`${nameId}-q`} name="quantity" type="number" step="any" min="0" placeholder={quantityPlaceholder} />
      </div>
      <div>
        <label className="label" htmlFor={`${nameId}-u`}>Unit</label>
        {known ? (
          <>
            <input type="hidden" name="unit" value={known.unit} />
            <div className="input bg-background text-muted" id={`${nameId}-u`}>{unitLabel(known.unit)}</div>
          </>
        ) : (
          <select className="input px-2" id={`${nameId}-u`} name="unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
          </select>
        )}
      </div>
      {known ? (
        <input type="hidden" name="category" value={known.category} />
      ) : (
        name.trim() && (
          <div className="col-span-3">
            <label className="label" htmlFor={`${nameId}-c`}>Category (new ingredient)</label>
            <select className="input" id={`${nameId}-c`} name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        )
      )}
    </div>
  );
}
