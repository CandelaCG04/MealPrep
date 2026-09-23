"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { categoryLabel, type PantryItem } from "@/lib/types";
import { reorderPantry } from "../actions";
import { PantryCard, type PantryLayout } from "./pantry-card";

type Columns = Record<string, PantryItem[]>;

/** Droppable ids: a category section, or a chip in the "move to" tray. */
const SECTION = "section:";
const CHIP = "chip:";
const ids = (list: PantryItem[] = []) => list.map((i) => i.id).join();

/** Grid tiles; when a tile opens its amount editor it takes the whole row. */
export const GRID_CLASS = "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 [&>li:has(form)]:col-span-full";

function groupItems(items: PantryItem[], categories: string[]): Columns {
  const columns: Columns = Object.fromEntries(categories.map((c) => [c, []]));
  for (const item of items) (columns[item.ingredients.category] ??= []).push(item);
  return columns;
}

/**
 * Small targets win when the pointer is right on them: tray chips and collapsed category headers.
 * (Nearest-corner matching measures from the whole dragged card, so thin targets would otherwise lose
 * to neighbouring cards.) Everything else: the nearest card/section.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerTargets = args.droppableContainers.filter((c) => String(c.id).startsWith(CHIP) || c.data.current?.collapsed);
  const onTarget = pointerWithin({ ...args, droppableContainers: pointerTargets });
  if (onTarget.length) return onTarget;
  return closestCorners({ ...args, droppableContainers: args.droppableContainers.filter((c) => !String(c.id).startsWith(CHIP)) });
};

/** In-stock pantry items grouped by category, reorderable and movable by drag and drop. */
export function PantryBoard({
  items,
  categories,
  layout,
  collapsed,
  onToggleCategory,
  matches,
  listed,
}: {
  items: PantryItem[];
  categories: string[];
  layout: PantryLayout;
  collapsed: Set<string>;
  onToggleCategory: (category: string) => void;
  /** When searching: which items to show. Dragging is paused while a search is active. */
  matches: ((item: PantryItem) => boolean) | null;
  /** Ingredient ids already on the shopping list. */
  listed: Set<string>;
}) {
  const [columns, setColumns] = useState(() => groupItems(items, categories));
  const [drag, setDrag] = useState<{ id: string; before: Columns } | null>(null);
  const [, startSaving] = useTransition();
  const [saveError, setSaveError] = useState(false);

  // Fresh data from the server (after any change) replaces local state — but not mid-drag.
  const [syncedItems, setSyncedItems] = useState(items);
  if (items !== syncedItems && !drag) {
    setSyncedItems(items);
    setColumns(groupItems(items, categories));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnOf = (id: string, cols: Columns = columns) => {
    if (id.startsWith(SECTION)) return id.slice(SECTION.length);
    if (id.startsWith(CHIP)) return id.slice(CHIP.length);
    return Object.keys(cols).find((c) => cols[c].some((i) => i.id === id));
  };

  const order = [...categories, ...Object.keys(columns).filter((c) => !categories.includes(c))];

  // ---- Searching: plain filtered sections, no drag and drop, all expanded.
  if (matches) {
    const found = order.map((c) => ({ category: c, items: (columns[c] ?? []).filter(matches) })).filter((g) => g.items.length);
    if (!found.length) return null;
    return (
      <>
        {found.map(({ category, items: list }) => (
          <section key={category}>
            <SectionHeader category={category} count={list.length} />
            <ul className={layout === "grid" ? GRID_CLASS : "flex flex-col gap-2"}>
              {list.map((item) => (
                <li key={item.id}>
                  <PantryCard item={item} layout={layout} onList={listed.has(item.ingredient_id)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </>
    );
  }

  const activeItem = drag ? Object.values(columns).flat().find((i) => i.id === drag.id) : undefined;
  // Sections on screen: anything with items, plus anything that had items when the drag started
  // (so a section doesn't vanish — and shift the page — as you drag its last item out).
  const visible = order.filter((c) => columns[c]?.length || drag?.before[c]?.length);
  const trayCategories = order.filter((c) => !visible.includes(c));

  function onDragStart({ active }: DragStartEvent) {
    setDrag({ id: String(active.id), before: columns });
  }

  // Moving between visible sections happens live while hovering, so the target list opens up.
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || String(over.id).startsWith(CHIP)) return;
    const from = columnOf(String(active.id));
    const to = columnOf(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const moving = cols[from].find((i) => i.id === active.id);
      if (!moving) return cols;
      const target = cols[to] ?? [];
      const overIndex = target.findIndex((i) => i.id === over.id);
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...cols,
        [from]: cols[from].filter((i) => i.id !== active.id),
        [to]: [...target.slice(0, index), moving, ...target.slice(index)],
      };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const before = drag?.before;
    setDrag(null);
    if (!before) return;
    if (!over) return setColumns(before);

    const activeId = String(active.id);
    const current = columnOf(activeId);
    let next = columns;
    let target = current;

    if (String(over.id).startsWith(CHIP)) {
      // Dropped on a "move to" chip: append to that category.
      target = columnOf(String(over.id));
      const moving = current ? columns[current].find((i) => i.id === activeId) : undefined;
      if (current && target && moving && current !== target) {
        next = { ...columns, [current]: columns[current].filter((i) => i.id !== activeId), [target]: [...(columns[target] ?? []), moving] };
      }
    } else if (current && current === columnOf(String(over.id))) {
      const list = columns[current];
      const from = list.findIndex((i) => i.id === activeId);
      const to = list.findIndex((i) => i.id === over.id);
      if (to >= 0 && from !== to) next = { ...columns, [current]: arrayMove(list, from, to) };
    }

    if (target && next[target]) {
      // The moved card now belongs to this category (keeps its menu accurate until the server refreshes).
      next = { ...next, [target]: next[target].map((i) => (i.id === activeId ? { ...i, ingredients: { ...i.ingredients, category: target } } : i)) };
    }
    setColumns(next);

    const changed = [...new Set([...Object.keys(before), ...Object.keys(next)])].filter((c) => ids(before[c]) !== ids(next[c]));
    if (!changed.length) return;
    // Save the destination first so the moved item's category is updated before its old list is re-ordered.
    changed.sort((a, b) => Number(b === target) - Number(a === target));
    startSaving(async () => {
      try {
        for (const c of changed) await reorderPantry(c, (next[c] ?? []).map((i) => i.id));
        setSaveError(false);
      } catch {
        // Put things back the way the server has them rather than showing an order that wasn't saved.
        setColumns(groupItems(items, categories));
        setSaveError(true);
      }
    });
  }

  return (
    <DndContext
      id="pantry-board"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        if (drag) setColumns(drag.before);
        setDrag(null);
      }}
    >
      {saveError && (
        <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          Couldn&apos;t save that move — check your connection and try again.
        </p>
      )}

      {visible.map((category) => (
        <CategorySection
          key={category}
          category={category}
          items={columns[category] ?? []}
          layout={layout}
          listed={listed}
          collapsed={collapsed.has(category)}
          onToggle={() => onToggleCategory(category)}
        />
      ))}

      {drag && trayCategories.length > 0 && <MoveTray categories={trayCategories} />}

      <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
        {activeItem ? <PantryCard item={activeItem} layout={layout} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function SectionHeader({ category, count, collapsed, onToggle }: { category: string; count: number; collapsed?: boolean; onToggle?: () => void }) {
  const content = (
    <>
      {onToggle && <span className={`inline-block w-3 text-xs text-muted transition ${collapsed ? "" : "rotate-90"}`}>▶</span>}
      {categoryLabel(category)}
      <span className="text-sm font-normal text-muted">{count}</span>
    </>
  );
  return (
    <h2 className="mb-2 font-semibold">
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex items-baseline gap-2 rounded-lg py-1 pr-2 hover:text-accent">
          {content}
        </button>
      ) : (
        <span className="flex items-baseline gap-2 py-1">{content}</span>
      )}
    </h2>
  );
}

function CategorySection({
  category,
  items,
  layout,
  collapsed,
  onToggle,
  listed,
}: {
  category: string;
  items: PantryItem[];
  layout: PantryLayout;
  collapsed: boolean;
  onToggle: () => void;
  listed: Set<string>;
}) {
  // The whole section (header included) is a drop target, so you can drop onto a collapsed category.
  const { setNodeRef, isOver } = useDroppable({ id: SECTION + category, data: { collapsed } });
  return (
    <section ref={setNodeRef} className={`rounded-2xl ${collapsed && isOver ? "bg-accent-soft" : ""}`}>
      <SectionHeader category={category} count={items.length} collapsed={collapsed} onToggle={onToggle} />
      <SortableContext items={collapsed ? [] : items.map((i) => i.id)} strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy}>
        {!collapsed && (
          <ul className={layout === "grid" ? `${GRID_CLASS} min-h-14` : "flex min-h-14 flex-col gap-2"}>
            {items.map((item) => (
              <SortableCard key={item.id} item={item} layout={layout} onList={listed.has(item.ingredient_id)} />
            ))}
          </ul>
        )}
      </SortableContext>
    </section>
  );
}

/** Floating tray (fixed, so it never shifts the page) with the categories that currently have no items. */
function MoveTray({ categories }: { categories: string[] }) {
  return (
    <div className="fixed inset-x-0 bottom-20 z-40 px-3 md:bottom-4">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface/95 p-2 shadow-2xl backdrop-blur">
        <p className="px-1 pb-1 text-xs font-medium text-muted">Move to another category</p>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <TrayChip key={c} category={c} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TrayChip({ category }: { category: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: CHIP + category });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-full border px-3 py-2 text-sm transition ${
        isOver ? "scale-105 border-accent bg-accent text-white dark:text-black" : "border-border bg-background"
      }`}
    >
      {categoryLabel(category)}
    </div>
  );
}

function SortableCard({ item, layout, onList }: { item: PantryItem; layout: PantryLayout; onList: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={isDragging ? "opacity-30" : ""}>
      <PantryCard item={item} layout={layout} onList={onList} handle={{ ref: setActivatorNodeRef, props: { ...attributes, ...listeners } }} />
    </li>
  );
}
