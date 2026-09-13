"use client";

import { useRef } from "react";
import { CATEGORIES, categoryLabel } from "@/lib/types";
import { setIngredientCategory } from "@/app/(app)/actions";

/** Compact category picker that saves as soon as you choose. */
export function CategorySelect({ ingredientId, category, name }: { ingredientId: string; category: string; name: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={setIngredientCategory}>
      <input type="hidden" name="ingredient_id" value={ingredientId} />
      <select
        name="category"
        defaultValue={category}
        onChange={() => form.current?.requestSubmit()}
        className="max-w-36 cursor-pointer rounded-lg border border-transparent bg-transparent py-0.5 text-muted hover:border-border"
        aria-label={`Category for ${name}`}
      >
        {[...new Set([...CATEGORIES, category])].map((c) => (
          <option key={c} value={c}>{categoryLabel(c)}</option>
        ))}
      </select>
    </form>
  );
}
