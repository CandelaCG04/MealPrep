export const UNITS = ["g", "kg", "ml", "l", "pc", "tbsp", "tsp", "cup", "can", "pack"] as const;
export const CATEGORIES = ["produce", "dairy", "meat", "fish", "bakery", "pantry", "spices", "frozen", "drinks", "other"] as const;
export const LOCATIONS = ["pantry", "fridge", "freezer"] as const;

export type Location = (typeof LOCATIONS)[number];

export type Ingredient = {
  id: string;
  name: string;
  unit: string;
  category: string;
};

export type PantryItem = {
  id: string;
  ingredient_id: string;
  quantity: number | null;
  location: Location;
  auto_restock: boolean;
  usual_quantity: number | null;
  expires_on: string | null;
  updated_at: string;
  ingredients: Ingredient;
};

export type RecipeSummary = {
  id: string;
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  instructions: string;
  source_url: string | null;
  notes: string | null;
  freezable: boolean;
  created_at: string;
  required_count: number;
  missing_count: number;
  planned: boolean;
};

export type RecipeIngredientStatus = {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  name: string;
  unit: string;
  category: string;
  quantity: number | null;
  note: string | null;
  optional: boolean;
  position: number;
  on_hand: number | null;
  in_pantry: boolean;
  have: boolean;
};

export type ShoppingListRow = {
  ingredient_id: string;
  name: string;
  unit: string;
  category: string;
  needed: number | null;
  on_hand: number | null;
  to_buy: number | null;
  for_recipes: string[];
  planned_short: boolean;
  manual: boolean;
  restock: boolean;
};

export type ShoppingExtra = {
  id: string;
  name: string;
  ingredient_id: string | null;
  quantity: number | null;
};

export type FrozenMeal = {
  id: string;
  name: string;
  recipe_id: string | null;
  portions: number;
  frozen_on: string;
  notes: string | null;
};

export type PlannedMeal = {
  id: string;
  recipe_id: string;
  batches: number;
  recipes: { title: string; servings: number | null };
};

const UNIT_LABELS: Record<string, [singular: string, plural: string]> = {
  pc: ["unit", "units"],
  can: ["can", "cans"],
  pack: ["pack", "packs"],
  cup: ["cup", "cups"],
};

/** Human label for a stored unit, e.g. "pc" -> "units". */
export function unitLabel(unit: string, amount?: number) {
  const labels = UNIT_LABELS[unit];
  if (!labels) return unit;
  return amount === 1 ? labels[0] : labels[1];
}

/** Postgres numeric comes back as a string; normalise for display. */
export function fmtQty(q: number | string | null | undefined, unit?: string) {
  if (q === null || q === undefined) return "";
  // Scaled amounts get messy (333.333 g): fewer decimals the bigger the number.
  const raw = Number(q);
  const decimals = Math.abs(raw) >= 100 ? 0 : Math.abs(raw) >= 10 ? 1 : 2;
  const n = Number(raw.toFixed(decimals));
  const s = String(n);
  return unit ? `${s} ${unitLabel(unit, n)}` : s;
}
