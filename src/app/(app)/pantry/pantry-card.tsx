"use client";

import { useOptimistic, useState, useTransition, type HTMLAttributes, type Ref } from "react";
import { CATEGORIES, categoryLabel, fmtQty, unitLabel, type PantryItem } from "@/lib/types";
import {
  addIngredientToList,
  deletePantryItem,
  markRanOut,
  restockItem,
  setAutoRestock,
  setIngredientCategory,
  setPantryQuantity,
} from "../actions";

/** Units you count one at a time get − / + buttons. */
const COUNT_UNITS = new Set(["pc", "portion", "can", "pack", "slice", "bunch", "clove"]);

function fd(fields: Record<string, string | number | null | undefined>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v === null || v === undefined ? "" : String(v));
  return data;
}

/** Runs a server action in a transition; a failure flags the card instead of crashing the page. */
function useAction() {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        await fn();
        setFailed(false);
      } catch {
        setFailed(true); // optimistic values revert automatically when the transition ends
      }
    });
  return { pending, failed, run };
}

function SaveError() {
  return <p role="alert" className="basis-full pl-8 text-xs text-danger">Couldn&apos;t save — check your connection and try again.</p>;
}

export type DragHandle = { ref: Ref<HTMLButtonElement>; props: HTMLAttributes<HTMLButtonElement> };

// ---------------------------------------------------------------------------
// In-stock item
// ---------------------------------------------------------------------------

export function PantryCard({ item, handle, overlay }: { item: PantryItem; handle?: DragHandle; overlay?: boolean }) {
  const { name, unit } = item.ingredients;
  const [quantity, setOptimisticQuantity] = useOptimistic(item.quantity === null ? null : Number(item.quantity));
  const [editing, setEditing] = useState(false);
  const { failed, run } = useAction();

  const saveQuantity = (value: number | null) =>
    run(async () => {
      setOptimisticQuantity(value);
      await setPantryQuantity(fd({ id: item.id, quantity: value }));
    });

  const counted = COUNT_UNITS.has(unit) && quantity !== null;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface py-2.5 pr-2 pl-1 ${
        overlay ? "rotate-1 shadow-xl ring-2 ring-accent" : "shadow-sm"
      }`}
    >
      <button
        type="button"
        ref={handle?.ref}
        {...handle?.props}
        className="flex h-10 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-lg text-muted hover:bg-background active:cursor-grabbing"
        aria-label={`Drag ${name}`}
      >
        ⠿
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        {item.auto_restock && <div className="text-xs text-accent">🔁 Auto-adds to list</div>}
      </div>

      {editing ? (
        <AmountEditor
          initial={quantity}
          unit={unit}
          onCancel={() => setEditing(false)}
          onSave={(v) => {
            setEditing(false);
            saveQuantity(v);
          }}
        />
      ) : counted ? (
        <div className="flex items-center rounded-full border border-border bg-background">
          <button type="button" className="h-9 w-9 rounded-full text-lg hover:bg-surface" onClick={() => saveQuantity(Math.max(0, quantity - 1))} aria-label={`One less ${name}`}>
            −
          </button>
          <button type="button" className="min-w-14 px-1 text-center text-sm font-semibold tabular-nums" onClick={() => setEditing(true)} aria-label={`Edit ${name} amount`}>
            {fmtQty(quantity)} <span className="font-normal text-muted">{unitLabel(unit, quantity)}</span>
          </button>
          <button type="button" className="h-9 w-9 rounded-full text-lg hover:bg-surface" onClick={() => saveQuantity(quantity + 1)} aria-label={`One more ${name}`}>
            +
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-full border border-border bg-background px-3 py-1.5 text-sm font-semibold tabular-nums hover:border-accent"
          aria-label={`Edit ${name} amount`}
        >
          {quantity === null ? <span className="font-normal text-muted">some</span> : fmtQty(quantity, unit)}
        </button>
      )}

      {!overlay && (
        <ItemMenu item={item} run={run}>
          {(close) => (
            <>
              <MenuButton onClick={() => { close(); setEditing(true); }}>✏️ Edit amount</MenuButton>
              <MenuButton onClick={() => { close(); run(() => markRanOut(fd({ id: item.id }))); }}>🚫 Ran out</MenuButton>
            </>
          )}
        </ItemMenu>
      )}
      {failed && <SaveError />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ran-out item
// ---------------------------------------------------------------------------

export function RanOutCard({ item, onList }: { item: PantryItem; onList: boolean }) {
  const { name, unit } = item.ingredients;
  const [restocking, setRestocking] = useState(false);
  const { pending, failed, run } = useAction();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border bg-surface/60 py-2.5 pr-2 pl-3">
      {/* min width so the buttons wrap onto their own line on narrow screens instead of squeezing the text */}
      <div className="min-w-44 flex-1">
        <div className="truncate font-medium text-muted">{name}</div>
        <div className="text-xs text-muted">
          {item.usual_quantity ? `Usually ${fmtQty(item.usual_quantity, unit)}` : "Ran out"}
          {item.auto_restock && " · 🔁 auto-adds"}
        </div>
      </div>

      {restocking ? (
        <AmountEditor
          initial={item.usual_quantity === null ? null : Number(item.usual_quantity)}
          unit={unit}
          saveLabel="Restock"
          onCancel={() => setRestocking(false)}
          onSave={(v) => {
            setRestocking(false);
            run(() => restockItem(fd({ ingredient_id: item.ingredient_id, quantity: v })));
          }}
        />
      ) : (
        <div className="ml-auto flex items-center gap-2">
          {onList ? (
            <span className="rounded-full bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">✓ On list</span>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => addIngredientToList(fd({ ingredient_id: item.ingredient_id, name, quantity: item.usual_quantity })))}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:border-accent"
            >
              🛒 Add to list
            </button>
          )}
          <button type="button" onClick={() => setRestocking(true)} className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white dark:text-black">
            Restock
          </button>
          <ItemMenu item={item} run={run} removeLabel="🗑️ Forget this item" />
        </div>
      )}

      {failed && <SaveError />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function AmountEditor({
  initial,
  unit,
  onSave,
  onCancel,
  saveLabel = "✓",
}: {
  initial: number | null;
  unit: string;
  onSave: (value: number | null) => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const submit = () => onSave(value.trim() === "" ? null : Math.max(0, Number(value)));
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="input w-20 px-2 py-1.5 text-right"
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
        aria-label="Amount"
      />
      <span className="text-sm text-muted">{unitLabel(unit)}</span>
      <button type="submit" className="btn-primary px-3 py-1.5">{saveLabel}</button>
      <button type="button" className="btn px-2 py-1.5 text-muted" onClick={onCancel} aria-label="Cancel">✕</button>
    </form>
  );
}

function MenuButton({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-background ${danger ? "text-danger" : ""}`}>
      {children}
    </button>
  );
}

function ItemMenu({
  item,
  run,
  children,
  removeLabel = "🗑️ Remove from pantry",
}: {
  item: PantryItem;
  run: (fn: () => Promise<unknown>) => void;
  children?: (close: () => void) => React.ReactNode;
  removeLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const close = () => {
    setOpen(false);
    setConfirmRemove(false);
  };

  return (
    <div className={`relative ${open ? "z-30" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted hover:bg-background"
        aria-label={`More options for ${item.ingredients.name}`}
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} aria-hidden />
          <div role="menu" className="absolute top-full right-0 z-20 mt-1 w-60 rounded-xl border border-border bg-surface p-1 shadow-xl">
            {children?.(close)}
            <MenuButton
              onClick={() => {
                close();
                run(() => setAutoRestock(fd({ id: item.id, value: String(!item.auto_restock) })));
              }}
            >
              🔁 Auto-add when out: <b>{item.auto_restock ? "on" : "off"}</b>
            </MenuButton>
            <label className="flex items-center gap-2 px-3 py-2 text-sm">
              🏷️
              <select
                className="input py-1 text-sm"
                defaultValue={item.ingredients.category}
                onChange={(e) => {
                  const category = e.target.value;
                  close();
                  run(() => setIngredientCategory(fd({ ingredient_id: item.ingredient_id, category })));
                }}
                aria-label="Category"
              >
                {[...new Set([...CATEGORIES, item.ingredients.category])].map((c) => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
            </label>
            <div className="my-1 border-t border-border" />
            <MenuButton
              danger
              onClick={() => {
                if (!confirmRemove) return setConfirmRemove(true);
                close();
                run(() => deletePantryItem(fd({ id: item.id })));
              }}
            >
              {confirmRemove ? "Tap again to confirm" : removeLabel}
            </MenuButton>
          </div>
        </>
      )}
    </div>
  );
}
