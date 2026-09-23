"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { SaveError as SaveErrorText, fd, useAction } from "@/components/use-action";
import { CATEGORIES, UNITS, categoryLabel, fmtQty, unitFactor, unitLabel, type PantryItem } from "@/lib/types";
import {
  addIngredientToList,
  setLowAt,
  deletePantryItem,
  markRanOut,
  renameIngredient,
  restockItem,
  setAutoRestock,
  setIngredientCategory,
  setPantryQuantity,
} from "../actions";

/** Units you count one at a time get − / + buttons. */
const COUNT_UNITS = new Set(["pc", "portion", "can", "pack", "slice", "bunch", "clove"]);

export type DragHandle = { ref: Ref<HTMLButtonElement>; props: HTMLAttributes<HTMLButtonElement> };
export type PantryLayout = "list" | "grid";

// ---------------------------------------------------------------------------
// In-stock item
// ---------------------------------------------------------------------------

export function PantryCard({
  item,
  handle,
  overlay,
  layout = "list",
  onList = false,
}: {
  item: PantryItem;
  /** Omitted when dragging isn't available (e.g. while searching). */
  handle?: DragHandle;
  overlay?: boolean;
  layout?: PantryLayout;
  /** Already on the shopping list. */
  onList?: boolean;
}) {
  const rename = useRename(item);
  const name = rename.name;
  const [{ quantity, unit }, setOptimistic] = useOptimistic({
    quantity: item.quantity === null ? null : Number(item.quantity),
    unit: item.ingredients.unit,
  });
  const [editing, setEditing] = useState(false);
  const [settingLow, setSettingLow] = useState(false);
  const { failed, run } = useAction();
  const grid = layout === "grid";
  const lowAt = item.low_at === null ? null : Number(item.low_at);
  const isLow = quantity !== null && quantity > 0 && lowAt !== null && quantity <= lowAt;
  const autoNote = item.auto_restock ? (lowAt ? `Auto-adds below ${fmtQty(lowAt, unit)}` : "Auto-adds when out") : null;

  const saveQuantity = (value: number | null, newUnit: string = unit) =>
    run(async () => {
      setOptimistic({ quantity: value, unit: newUnit });
      await setPantryQuantity(fd({ id: item.id, ingredient_id: item.ingredient_id, quantity: value, unit: newUnit }));
    });

  const counted = COUNT_UNITS.has(unit) && quantity !== null;

  const dragHandle = handle || overlay ? (
    <button
      type="button"
      ref={handle?.ref}
      {...handle?.props}
      className={`flex shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-background active:cursor-grabbing ${
        grid ? "h-6 w-5 text-sm" : "h-10 w-7 text-lg"
      }`}
      aria-label={`Drag ${name}`}
    >
      ⠿
    </button>
  ) : (
    <span className={grid ? "w-0.5" : "w-2"} />
  );

  const lowEditor = settingLow ? (
    <LowEditor
      initial={lowAt}
      unit={unit}
      onCancel={() => setSettingLow(false)}
      onSave={(value) => {
        setSettingLow(false);
        run(() => setLowAt(fd({ id: item.id, low_at: value })));
      }}
    />
  ) : null;

  let amount: ReactNode;
  if (editing) {
    amount = (
      <AmountEditor
        initial={quantity}
        unit={unit}
        onCancel={() => setEditing(false)}
        onSave={(v, u) => {
          setEditing(false);
          saveQuantity(v, u);
        }}
      />
    );
  } else if (counted) {
    const step = `rounded-full text-lg hover:bg-surface ${grid ? "h-7 w-7 shrink-0" : "h-9 w-9"}`;
    amount = (
      <div className={`flex items-center rounded-full border border-border bg-background ${grid ? "w-full justify-between" : ""}`}>
        <button type="button" className={step} onClick={() => saveQuantity(Math.max(0, quantity - 1))} aria-label={`One less ${name}`}>
          −
        </button>
        <button
          type="button"
          className="min-w-0 truncate px-1 text-center text-sm font-semibold tabular-nums"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${name} amount`}
        >
          {fmtQty(quantity)} <span className="font-normal text-muted">{unitLabel(unit, quantity)}</span>
        </button>
        <button type="button" className={step} onClick={() => saveQuantity(quantity + 1)} aria-label={`One more ${name}`}>
          +
        </button>
      </div>
    );
  } else {
    amount = (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`rounded-full border border-border bg-background px-3 text-sm font-semibold tabular-nums hover:border-accent ${grid ? "w-full py-1" : "py-1.5"}`}
        aria-label={`Edit ${name} amount`}
      >
        {quantity === null ? <span className="font-normal text-muted">some</span> : fmtQty(quantity, unit)}
      </button>
    );
  }

  const menu = !overlay && !editing && !settingLow && !rename.renaming && (
    <ItemMenu item={item} run={run} onRename={rename.start}>
      {(close) => (
        <>
          <MenuButton onClick={() => { close(); setEditing(true); }}>✏️ Edit amount or unit</MenuButton>
          {onList ? (
            <MenuButton onClick={close}>✓ Already on the shopping list</MenuButton>
          ) : (
            <MenuButton
              onClick={() => {
                close();
                run(() => addIngredientToList(fd({ ingredient_id: item.ingredient_id, name, quantity: item.usual_quantity })));
              }}
            >
              🛒 Add to shopping list
            </MenuButton>
          )}
          <MenuButton onClick={() => { close(); setSettingLow(true); }}>
            🔔 Running low at: <b>{lowAt ? fmtQty(lowAt, unit) : "when it runs out"}</b>
          </MenuButton>
          <MenuButton onClick={() => { close(); run(() => markRanOut(fd({ id: item.id }))); }}>🚫 Ran out</MenuButton>
        </>
      )}
    </ItemMenu>
  );

  const frame = `rounded-2xl border border-border bg-surface ${overlay ? "rotate-1 shadow-xl ring-2 ring-accent" : "shadow-sm"}`;

  if (grid) {
    return (
      <div className={`flex h-full flex-col gap-1 p-1.5 ${frame}`}>
        <div className="flex items-center gap-0.5">
          {dragHandle}
          {rename.editor ?? (
            <div className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-medium" title={name}>
              {isLow && <LowBadge />}
              {name}
            </div>
          )}
          {menu}
        </div>
        <div className="mt-auto">{lowEditor ?? amount}</div>
        {autoNote && !settingLow && <div className="text-[11px] text-accent">🔁 {autoNote}</div>}
        {failed && <SaveErrorText />}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 py-2.5 pr-2 pl-1 ${frame}`}>
      {dragHandle}
      {rename.editor ?? (
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {isLow && <LowBadge />}
            {name}
          </div>
          {autoNote && <div className="text-xs text-accent">🔁 {autoNote}</div>}
        </div>
      )}
      {lowEditor ?? amount}
      {menu}
      {failed && <SaveErrorText className="basis-full pl-8" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ran-out item
// ---------------------------------------------------------------------------

export function RanOutCard({ item, onList, layout = "list" }: { item: PantryItem; onList: boolean; layout?: PantryLayout }) {
  const { unit } = item.ingredients;
  const rename = useRename(item);
  const name = rename.name;
  const [restocking, setRestocking] = useState(false);
  const { pending, failed, run } = useAction();

  const editor = (
    <AmountEditor
      initial={item.usual_quantity === null ? null : Number(item.usual_quantity)}
      unit={unit}
      saveLabel="Restock"
      onCancel={() => setRestocking(false)}
      onSave={(v, u) => {
        setRestocking(false);
        run(() => restockItem(fd({ ingredient_id: item.ingredient_id, quantity: v, unit: u })));
      }}
    />
  );
  const addToList = () => run(() => addIngredientToList(fd({ ingredient_id: item.ingredient_id, name, quantity: item.usual_quantity })));
  const usually = item.usual_quantity ? `Usually ${fmtQty(item.usual_quantity, unit)}` : "Ran out";

  if (layout === "grid") {
    return (
      <div className="flex h-full flex-col gap-1 rounded-2xl border border-dashed border-border bg-surface/60 p-1.5 pl-2.5">
        <div className="flex items-start gap-1">
          {rename.editor ?? (
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="line-clamp-2 text-sm leading-tight font-medium text-muted" title={name}>{name}</div>
              <div className="text-[11px] text-muted">
                {usually}
                {item.auto_restock && " · 🔁"}
              </div>
            </div>
          )}
          {!restocking && !rename.renaming && <ItemMenu item={item} run={run} onRename={rename.start} removeLabel="🗑️ Forget this item" />}
        </div>
        {restocking ? (
          editor
        ) : (
          <div className="mt-auto flex gap-1">
            {onList ? (
              <span className="flex-1 rounded-full bg-accent-soft px-2 py-1 text-center text-xs font-medium text-accent">✓ On list</span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={addToList}
                className="flex-1 rounded-full border border-border bg-background px-2 py-1 text-xs font-medium hover:border-accent"
                aria-label={`Add ${name} to shopping list`}
              >
                🛒 List
              </button>
            )}
            <button type="button" onClick={() => setRestocking(true)} className="flex-1 rounded-full bg-accent px-2 py-1 text-xs font-medium text-white dark:text-black">
              Restock
            </button>
          </div>
        )}
        {failed && <SaveErrorText />}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border bg-surface/60 py-2.5 pr-2 pl-3">
      {/* min width so the buttons wrap onto their own line on narrow screens instead of squeezing the text */}
      {rename.editor ?? (
        <div className="min-w-44 flex-1">
          <div className="truncate font-medium text-muted">{name}</div>
          <div className="text-xs text-muted">
            {usually}
            {item.auto_restock && " · 🔁 auto-adds"}
          </div>
        </div>
      )}

      {restocking ? (
        editor
      ) : rename.renaming ? null : (
        <div className="ml-auto flex items-center gap-2">
          {onList ? (
            <span className="rounded-full bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">✓ On list</span>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={addToList}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:border-accent"
            >
              🛒 Add to list
            </button>
          )}
          <button type="button" onClick={() => setRestocking(true)} className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white dark:text-black">
            Restock
          </button>
          <ItemMenu item={item} run={run} onRename={rename.start} removeLabel="🗑️ Forget this item" />
        </div>
      )}

      {failed && <SaveErrorText className="basis-full pl-8" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function AmountEditor({
  initial,
  unit: initialUnit,
  onSave,
  onCancel,
  saveLabel = "✓",
}: {
  initial: number | null;
  unit: string;
  onSave: (value: number | null, unit: string) => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [unit, setUnit] = useState(initialUnit);
  const submit = () => onSave(value.trim() === "" ? null : Math.max(0, Number(value)), unit);

  function changeUnit(next: string) {
    // Show the same amount in the new unit when they convert (450 g -> 0.45 kg).
    const factor = unitFactor(unit, next);
    if (factor !== null && value.trim() !== "") setValue(String(Number((Number(value) * factor).toPrecision(6))));
    setUnit(next);
  }

  const converts = unitFactor(initialUnit, unit) !== null;

  return (
    <form
      className="flex basis-full flex-col items-end gap-1 sm:basis-auto"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-1">
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
        <select
          className="input w-auto px-1 py-1.5 text-sm"
          value={unit}
          onChange={(e) => changeUnit(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          aria-label="Unit"
        >
          {[...new Set([initialUnit, ...UNITS])].map((u) => (
            <option key={u} value={u}>{unitLabel(u)}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary px-3 py-1.5">{saveLabel}</button>
        <button type="button" className="btn px-2 py-1.5 text-muted" onClick={onCancel} aria-label="Cancel">✕</button>
      </div>
      {unit !== initialUnit && (
        <p className="max-w-72 text-right text-xs text-muted">
          From now on counted in <b>{unitLabel(unit)}</b>
          {converts ? "" : " — enter how much you have in the new unit"}. Recipes keep their own units.
        </p>
      )}
    </form>
  );
}

/**
 * Renaming an ingredient from its card. Shows the new name straight away; if the save fails
 * (e.g. the name is already taken) the editor reopens with the attempted name and the reason.
 */
function useRename(item: PantryItem) {
  const [name, setOptimisticName] = useOptimistic(item.ingredients.name);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const [, start] = useTransition();

  function save(next: string) {
    const clean = next.trim().replace(/\s+/g, " ");
    setRenaming(false);
    if (!clean || clean === item.ingredients.name) {
      setError(undefined);
      return;
    }
    start(async () => {
      setOptimisticName(clean);
      let message: string | undefined;
      try {
        const res = await renameIngredient(item.ingredient_id, clean);
        if ("error" in res) message = res.error;
      } catch {
        message = "Couldn't save — check your connection and try again.";
      }
      setError(message);
      if (message) {
        setDraft(clean);
        setRenaming(true);
      }
    });
  }

  function cancel() {
    setRenaming(false);
    setError(undefined);
    setDraft(undefined);
  }

  const editor = renaming ? (
    <NameEditor initial={draft ?? item.ingredients.name} error={error} onSave={save} onCancel={cancel} />
  ) : null;

  return { name, renaming, editor, start: () => setRenaming(true) };
}

function NameEditor({ initial, error, onSave, onCancel }: { initial: string; error?: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex min-w-0 flex-1 basis-full flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <div className="flex items-center gap-1">
        <input
          className="input min-w-0 flex-1 px-2 py-1.5"
          value={value}
          maxLength={80}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          aria-label="Ingredient name"
        />
        <button type="submit" className="btn-primary px-3 py-1.5" aria-label="Save name">✓</button>
        <button type="button" className="btn px-2 py-1.5 text-muted" onClick={onCancel} aria-label="Cancel rename">✕</button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">{error}</p>
      ) : (
        <p className="text-xs text-muted">Also renames it in your recipes and shopping list.</p>
      )}
    </form>
  );
}

function LowBadge() {
  return (
    <span className="mr-1 rounded-full bg-warn-soft px-1.5 py-0.5 align-middle text-[10px] font-semibold text-warn" title="Running low">
      LOW
    </span>
  );
}

/** Sets the level at which an item counts as running low (empty = only when it runs out). */
function LowEditor({
  initial,
  unit,
  onSave,
  onCancel,
}: {
  initial: number | null;
  unit: string;
  onSave: (value: number | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  return (
    <form
      className="flex basis-full flex-col items-end gap-1 sm:basis-auto"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value.trim() === "" ? null : Math.max(0, Number(value)));
      }}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted">Add to list below</span>
        <input
          className="input w-20 px-2 py-1.5 text-right"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          placeholder="—"
          value={value}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          aria-label="Running low at"
        />
        <span className="text-sm text-muted">{unitLabel(unit)}</span>
        <button type="submit" className="btn-primary px-3 py-1.5">✓</button>
        <button type="button" className="btn px-2 py-1.5 text-muted" onClick={onCancel} aria-label="Cancel">✕</button>
      </div>
      <p className="max-w-72 text-right text-xs text-muted">Leave empty to add it only when it runs out.</p>
    </form>
  );
}

function MenuButton({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-background ${danger ? "text-danger" : ""}`}>
      {children}
    </button>
  );
}

const MENU_WIDTH = 240;

function ItemMenu({
  item,
  run,
  onRename,
  children,
  removeLabel = "🗑️ Remove from pantry",
}: {
  item: PantryItem;
  run: (fn: () => Promise<unknown>) => void;
  onRename: () => void;
  children?: (close: () => void) => ReactNode;
  removeLabel?: string;
}) {
  // Fixed position computed from the button, so the menu never runs off-screen (e.g. grid tiles on the left).
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const open = position !== null;

  const close = () => {
    setPosition(null);
    setConfirmRemove(false);
  };

  const measure = () => {
    const r = button.current?.getBoundingClientRect();
    return r ? { top: r.bottom + 4, left: Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8) } : null;
  };

  // Keep the fixed menu attached to its button while the page scrolls or resizes
  // (closing instead would make it vanish on the tiniest scroll, e.g. a phone's address bar moving).
  useEffect(() => {
    if (!open) return;
    const follow = () => setPosition(measure());
    window.addEventListener("scroll", follow, { passive: true, capture: true });
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  function toggle() {
    if (open) return close();
    setPosition(measure());
  }

  return (
    <div className="shrink-0">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-muted hover:bg-background"
        aria-label={`More options for ${item.ingredients.name}`}
        aria-expanded={open}
      >
        ⋯
      </button>
      {position && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden />
          <div role="menu" style={{ top: position.top, left: position.left, width: MENU_WIDTH }} className="fixed z-50 rounded-xl border border-border bg-surface p-1 shadow-xl">
            <MenuButton onClick={() => { close(); onRename(); }}>🏷️ Rename</MenuButton>
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
