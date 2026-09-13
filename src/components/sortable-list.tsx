"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** `attach` marks the element that starts a drag; `listeners` are its event handlers and a11y attributes. */
export type SortHandle = { attach: (el: HTMLElement | null) => void; listeners: HTMLAttributes<HTMLButtonElement> };

/**
 * A vertical list you reorder by dragging each row's handle (mouse, touch or keyboard:
 * focus the handle, Space to pick up, arrows to move, Space to drop).
 */
export function SortableList<T extends { key: string }>({
  id,
  items,
  onReorder,
  renderItem,
  as: Tag = "ul",
  className,
  itemClassName,
}: {
  /** Stable id (keeps server and client markup in sync). */
  id: string;
  items: T[];
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number, handle: SortHandle) => ReactNode;
  as?: "ul" | "ol";
  className?: string;
  itemClassName?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.key === active.id);
    const to = items.findIndex((i) => i.key === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to));
  }

  return (
    <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
        <Tag className={className}>
          {items.map((item, index) => (
            <SortableRow key={item.key} id={item.key} className={itemClassName}>
              {(handle) => renderItem(item, index, handle)}
            </SortableRow>
          ))}
        </Tag>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, className = "", children }: { id: string; className?: string; children: (handle: SortHandle) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${className} ${isDragging ? "relative z-10 rounded-xl bg-surface shadow-lg ring-2 ring-accent" : ""}`}
    >
      {children({ attach: setActivatorNodeRef, listeners: { ...attributes, ...listeners } })}
    </li>
  );
}

/** The ⠿ grip that starts a drag. */
export function DragGrip({
  attach,
  listeners,
  label,
  className = "",
}: SortHandle & { label: string; className?: string }) {
  return (
    <button
      type="button"
      ref={attach}
      {...listeners}
      aria-label={label}
      className={`flex shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-lg text-muted hover:bg-background active:cursor-grabbing ${className}`}
    >
      ⠿
    </button>
  );
}
