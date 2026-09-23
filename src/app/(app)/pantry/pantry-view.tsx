"use client";

import { useMemo, useState } from "react";
import type { PantryItem } from "@/lib/types";
import { useLocalPref } from "@/lib/use-local-pref";
import { GRID_CLASS, PantryBoard } from "./pantry-board";
import { RanOutCard, type PantryLayout } from "./pantry-card";
import { pantryAsText } from "./pantry-text";

const RAN_OUT = "__ran_out__";

/** Case- and accent-insensitive name search. */
const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();

/** Toolbar (search, list/grid, collapse) around the pantry board and the ran-out list. */
export function PantryView({
  inStock,
  ranOut,
  onListIds,
  categories,
}: {
  inStock: PantryItem[];
  ranOut: PantryItem[];
  onListIds: string[];
  categories: string[];
}) {
  const [layout, setLayout] = useLocalPref("pantry-layout", "grid");
  const [collapsedPref, setCollapsedPref] = useLocalPref("pantry-collapsed", "[]");
  const [query, setQuery] = useState("");

  const collapsed = useMemo(() => {
    try {
      return new Set<string>(JSON.parse(collapsedPref));
    } catch {
      return new Set<string>();
    }
  }, [collapsedPref]);
  const toggle = (category: string) => {
    const next = new Set(collapsed);
    if (!next.delete(category)) next.add(category);
    setCollapsedPref(JSON.stringify([...next]));
  };

  const q = normalize(query);
  const matches = q ? (item: PantryItem) => normalize(item.ingredients.name).includes(q) : null;
  const shownRanOut = matches ? ranOut.filter(matches) : ranOut;
  const listed = new Set(onListIds);
  const view = (layout === "list" ? "list" : "grid") as PantryLayout;

  const inStockCategories = new Set(inStock.map((i) => i.ingredients.category));
  const allCollapsed = [...inStockCategories].every((c) => collapsed.has(c)) && (!ranOut.length || collapsed.has(RAN_OUT));
  const setAll = (collapse: boolean) =>
    setCollapsedPref(JSON.stringify(collapse ? [...inStockCategories, ...(ranOut.length ? [RAN_OUT] : [])] : []));

  const ranOutCollapsed = !matches && collapsed.has(RAN_OUT);
  const nothingFound = matches && !inStock.some(matches) && !shownRanOut.length;

  return (
    <>
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-2 bg-background/95 px-4 py-2 backdrop-blur md:top-12">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">🔍</span>
            <input
              type="search"
              className="input pl-9"
              placeholder={`Search ${inStock.length + ranOut.length} items…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search pantry"
            />
          </div>
          <div className="flex rounded-xl border border-border bg-surface p-0.5" role="group" aria-label="Layout">
            {(["grid", "list"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLayout(l)}
                aria-pressed={view === l}
                aria-label={l === "grid" ? "Grid view" : "List view"}
                title={l === "grid" ? "Grid view" : "List view"}
                className={`rounded-lg px-2.5 py-1.5 text-base ${view === l ? "bg-accent-soft text-accent" : "text-muted"}`}
              >
                {l === "grid" ? "▦" : "☰"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span>
            {matches ? "Dragging is paused while searching." : inStock.length > 1 ? "Drag ⠿ to reorder or move between categories." : ""}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <CopyButton getText={() => pantryAsText(inStock, ranOut, categories)} />
            {!matches && (inStockCategories.size > 1 || ranOut.length > 0) && (
              <button type="button" className="underline" onClick={() => setAll(!allCollapsed)}>
                {allCollapsed ? "Expand all" : "Collapse all"}
              </button>
            )}
          </span>
        </div>
      </div>

      <PantryBoard items={inStock} categories={categories} layout={view} collapsed={collapsed} onToggleCategory={toggle} matches={matches} listed={listed} />

      {shownRanOut.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">
            <button
              type="button"
              onClick={() => toggle(RAN_OUT)}
              disabled={!!matches}
              aria-expanded={!ranOutCollapsed}
              className="flex items-baseline gap-2 rounded-lg py-1 pr-2 hover:text-accent"
            >
              {!matches && <span className={`inline-block w-3 text-xs text-muted transition ${ranOutCollapsed ? "" : "rotate-90"}`}>▶</span>}
              🚫 Ran out <span className="text-sm font-normal text-muted">{shownRanOut.length}</span>
            </button>
          </h2>
          {!ranOutCollapsed && (
            <ul className={view === "grid" ? GRID_CLASS : "flex flex-col gap-2"}>
              {shownRanOut.map((item) => (
                <li key={item.id}>
                  <RanOutCard item={item} onList={listed.has(item.ingredient_id)} layout={view} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {nothingFound && <p className="text-center text-muted">Nothing in your pantry matches &ldquo;{query}&rdquo;.</p>}
    </>
  );
}

/** Copies the whole pantry (not just search results) as text, with a short confirmation. */
function CopyButton({ getText }: { getText: () => string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      // Older browsers / non-secure pages: fall back to a hidden textarea.
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      setStatus(ok ? "copied" : "failed");
    }
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`flex items-center gap-1 rounded-lg px-1 underline ${status === "copied" ? "text-accent no-underline" : status === "failed" ? "text-danger" : ""}`}
      title="Copy everything in your pantry as text"
      aria-live="polite"
    >
      {status === "copied" ? "✓ Copied" : status === "failed" ? "Couldn't copy" : "📋 Copy"}
    </button>
  );
}
