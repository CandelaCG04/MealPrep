import { categoryLabel, fmtQty, type PantryItem } from "@/lib/types";

/**
 * The whole pantry as plain text for pasting into a note or message:
 * categories in on-screen order, items in their saved order, then what's run out.
 */
export function pantryAsText(inStock: PantryItem[], ranOut: PantryItem[], categories: string[], date = new Date()) {
  const lines = [`Pantry — ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`];

  const extra = [...new Set(inStock.map((i) => i.ingredients.category))].filter((c) => !categories.includes(c));
  for (const category of [...categories, ...extra]) {
    const items = inStock.filter((i) => i.ingredients.category === category);
    if (!items.length) continue;
    lines.push("", categoryLabel(category));
    for (const item of items) {
      const amount = item.quantity === null ? "some" : fmtQty(item.quantity, item.ingredients.unit);
      lines.push(`• ${item.ingredients.name} — ${amount}`);
    }
  }

  if (ranOut.length) {
    lines.push("", "🚫 Ran out");
    for (const item of ranOut) lines.push(`• ${item.ingredients.name}`);
  }

  if (!inStock.length && !ranOut.length) lines.push("", "(empty)");
  return lines.join("\n");
}
