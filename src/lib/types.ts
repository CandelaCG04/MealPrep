export const UNITS = ["g", "kg", "ml", "l", "pc", "tbsp", "tsp", "cup", "can", "pack", "clove", "slice", "pinch", "bunch", "portion"] as const;

/** Keep in sync with public.unit_factor() in the database. */
const UNIT_SIZES: Record<string, [dimension: "mass" | "volume", size: number]> = {
  g: ["mass", 1], kg: ["mass", 1000],
  ml: ["volume", 1], l: ["volume", 1000], tsp: ["volume", 5], tbsp: ["volume", 15], cup: ["volume", 240],
};

/** Multiplier from one unit to another, or null if they measure different things. */
export function unitFactor(from: string, to: string): number | null {
  if (from === to) return 1;
  const a = UNIT_SIZES[from], b = UNIT_SIZES[to];
  return a && b && a[0] === b[0] ? a[1] / b[1] : null;
}

/** e.g. 30 ml of Lime juice comes from 1 pc of Limes. */
export type IngredientSource = {
  id: string;
  ingredient_id: string;
  amount: number;
  unit: string;
  source_ingredient_id: string;
  source_amount: number;
  source_unit: string;
};

export type Conversion = {
  id: string;
  ingredient_id: string;
  unit: string; // as written in recipes
  amount: number;
  equals_amount: number;
  equals_unit: string; // what that uses from the pantry
};

function metricFactor(from: string, to: string): number | null {
  if (from === to) return 1;
  const pairs: Record<string, number> = { "l>ml": 1000, "ml>l": 0.001, "kg>g": 1000, "g>kg": 0.001 };
  return pairs[`${from}>${to}`] ?? null;
}

/**
 * Recipe unit -> pantry unit for one ingredient: same unit, then the ingredient's
 * own conversions (e.g. 250 ml broth = 5 g powder), then standard conversions.
 * Mirrors public.ingredient_unit_factor(). Returns the conversion used, if any.
 */
export function ingredientFactor(
  conversions: Conversion[],
  from: string,
  to: string,
): { factor: number | null; via?: Conversion } {
  if (from === to) return { factor: 1 };
  const candidates = conversions
    .filter((c) => metricFactor(from, c.unit) !== null && unitFactor(c.equals_unit, to) !== null)
    .sort((a, b) => Number(b.unit === from) - Number(a.unit === from));
  const c = candidates[0];
  if (c) {
    const factor = metricFactor(from, c.unit)! * (Number(c.equals_amount) / Number(c.amount)) * unitFactor(c.equals_unit, to)!;
    return { factor, via: c };
  }
  return { factor: unitFactor(from, to) };
}

/** Spoon/cup measures make poor pantry units; store new ingredients in ml instead. */
export function stockUnitFor(unit: string) {
  return ["tsp", "tbsp", "cup"].includes(unit) ? "ml" : unit;
}
export const CATEGORIES = ["produce", "dairy", "meat", "fish", "bakery", "pantry", "spices", "frozen", "drinks", "cooked", "other"] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  cooked: "🍲 Cooked meals",
  produce: "🥬 Produce",
  dairy: "🧀 Dairy",
  meat: "🥩 Meat",
  fish: "🐟 Fish",
  bakery: "🍞 Bakery",
  pantry: "🥫 Pantry staples",
  spices: "🧂 Spices",
  frozen: "🧊 Frozen",
  drinks: "🥤 Drinks",
  other: "📦 Other",
};

export const categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? `📦 ${category}`;
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
  /** Counts as running low at or below this amount (null = only when it runs out). */
  low_at: number | null;
  position: number;
  expires_on: string | null;
  updated_at: string;
  ingredients: Ingredient;
};

export type RecipeSummary = {
  id: string;
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  steps: string[];
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
  unit: string; // unit used in the recipe
  stock_unit: string; // unit the pantry tracks
  category: string;
  quantity: number | null; // in `unit`
  stock_quantity: number | null; // in `stock_unit`; null if units can't be converted
  note: string | null;
  optional: boolean;
  position: number;
  on_hand: number | null;
  in_pantry: boolean;
  have: boolean; // includes having enough of the source ("made from")
  // "Made from" another ingredient, e.g. Lime juice <- Limes. All null when there's no source.
  source_name: string | null;
  source_unit: string | null; // source's pantry unit
  source_needed: number | null; // source pantry units to cover what's missing (1 batch)
  source_on_hand: number | null;
  have_via_source: boolean;
  source_factor: number | null; // source pantry units per pantry unit of this ingredient
  source_in_pantry: boolean;
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
  /** What the list works out on its own, before any adjustment. */
  suggested: number | null;
  adjusted: boolean;
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

/** A recipe you've started cooking (marinating, proving, resting…). */
export type CookPhase = "prep" | "wait" | "cook";

export const PHASES: { key: CookPhase; label: string; icon: string }[] = [
  { key: "prep", label: "Prepping", icon: "🔪" },
  { key: "wait", label: "Waiting", icon: "⏳" },
  { key: "cook", label: "Cooking", icon: "🔥" },
];

export type CookingSession = {
  id: string;
  recipe_id: string;
  batches: number;
  done_steps: number[];
  wait_until: string | null;
  started_at: string;
  /** Which phase is running now (null = paused), and when it started. */
  phase: CookPhase | null;
  phase_started_at: string | null;
  prep_seconds: number;
  wait_seconds: number;
  cook_seconds: number;
};

/** How long this recipe usually takes you, averaged over the times you've cooked it. */
export type RecipeTimeStats = {
  recipe_id: string;
  cooks: number;
  avg_prep_seconds: number;
  avg_wait_seconds: number;
  avg_cook_seconds: number;
  avg_total_seconds: number;
  last_cooked_at: string;
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
  clove: ["clove", "cloves"],
  slice: ["slice", "slices"],
  pinch: ["pinch", "pinches"],
  bunch: ["bunch", "bunches"],
  portion: ["portion", "portions"],
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
