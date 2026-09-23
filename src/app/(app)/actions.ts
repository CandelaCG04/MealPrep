"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parsePantryText, parseRecipe, type ParsedRecipe, type RecipeSource } from "@/lib/ai";
import { stockUnitFor, unitFactor, type Conversion, type Ingredient } from "@/lib/types";
import { stepsToStored } from "@/lib/steps";

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function num(fd: FormData, key: string) {
  const v = str(fd, key);
  return v === "" ? null : Number(v);
}

async function db() {
  return createClient();
}

function check<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(res.error.message);
  return res;
}

async function ensureIngredient(name: string, unit: string, category: string) {
  const supabase = await db();
  const { data, error } = await supabase.rpc("ensure_ingredient", {
    p_name: name,
    p_unit: unit,
    p_category: category,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * For the pantry and shopping-list forms: find or create the ingredient, and if it
 * already exists with a different unit or category, switch it to the chosen ones.
 * (Recipes use ensureIngredient instead — their lines carry their own units.)
 */
async function ensureIngredientAs(name: string, unit: string, category: string) {
  const supabase = await db();
  const id = await ensureIngredient(name, unit, category);
  const { data: current } = await supabase.from("ingredients").select("unit, category").eq("id", id).single();
  if (current && current.unit !== unit) {
    check(await supabase.rpc("change_ingredient_unit", { p_ingredient_id: id, p_unit: unit }));
  }
  if (current && current.category !== category) {
    check(await supabase.from("ingredients").update({ category }).eq("id", id));
  }
  return id;
}

async function catalog(): Promise<Ingredient[]> {
  const supabase = await db();
  const { data } = await supabase.from("ingredients").select("id, name, unit, category").order("name");
  return data ?? [];
}

function refreshAll() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

export async function addPantryItem(fd: FormData) {
  const supabase = await db();
  const id = await ensureIngredientAs(str(fd, "name"), str(fd, "unit") || "pc", str(fd, "category") || "other");
  check(await supabase.rpc("add_stock", {
    p_ingredient_id: id,
    p_amount: num(fd, "quantity"),
    p_location: null,
    p_auto_restock: fd.get("auto_restock") === "on",
  }));
  refreshAll();
}

/** Changes the ingredient's category everywhere (pantry groups and shopping list sections). */
export async function setIngredientCategory(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("ingredients").update({ category: str(fd, "category") }).eq("id", str(fd, "ingredient_id")));
  refreshAll();
}

/** Rename an ingredient everywhere (pantry, recipes, shopping list). */
export async function renameIngredient(ingredientId: string, name: string): Promise<{ error: string } | { ok: true }> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return { error: "Give it a name." };
  try {
    const supabase = await db();
    const { error } = await supabase.from("ingredients").update({ name: clean }).eq("id", ingredientId);
    if (error) {
      // unique (user_id, name_key): another ingredient already has this name
      if (error.code === "23505") return { error: `You already have an ingredient called "${clean}".` };
      return { error: error.message };
    }
  } catch {
    return { error: "Couldn't save — check your connection and try again." };
  }
  refreshAll();
  return { ok: true };
}

/** Save the order of one pantry category after drag and drop (items dropped in join that category). */
export async function reorderPantry(category: string, itemIds: string[]) {
  const supabase = await db();
  check(await supabase.rpc("reorder_pantry", { p_category: category, p_item_ids: itemIds }));
  refreshAll();
}

/** Ran out: keep the item (quantity 0) so it's easy to restock or re-buy. */
export async function markRanOut(fd: FormData) {
  const supabase = await db();
  check(await supabase
    .from("pantry_items")
    .update({ quantity: 0, updated_at: new Date().toISOString() })
    .eq("id", str(fd, "id")));
  refreshAll();
}

/** Level at which an item counts as running low (blank = only when it runs out). Turns auto-add on. */
export async function setLowAt(fd: FormData) {
  const supabase = await db();
  const low = num(fd, "low_at");
  check(await supabase
    .from("pantry_items")
    .update({ low_at: low, auto_restock: true, updated_at: new Date().toISOString() })
    .eq("id", str(fd, "id")));
  refreshAll();
}

export async function setAutoRestock(fd: FormData) {
  const supabase = await db();
  check(await supabase
    .from("pantry_items")
    .update({ auto_restock: str(fd, "value") === "true" })
    .eq("id", str(fd, "id")));
  refreshAll();
}

/**
 * If the form sends a unit different from the ingredient's, switch the pantry to it
 * (stock converted when compatible, e.g. g -> kg; otherwise reset — the caller then sets the new amount).
 */
async function switchUnitIfChanged(ingredientId: string, unit: string) {
  if (!ingredientId || !unit) return;
  const supabase = await db();
  const { data } = await supabase.from("ingredients").select("unit").eq("id", ingredientId).single();
  if (data && data.unit !== unit) {
    check(await supabase.rpc("change_ingredient_unit", { p_ingredient_id: ingredientId, p_unit: unit }));
  }
}

export async function restockItem(fd: FormData) {
  const supabase = await db();
  await switchUnitIfChanged(str(fd, "ingredient_id"), str(fd, "unit"));
  check(await supabase.rpc("add_stock", { p_ingredient_id: str(fd, "ingredient_id"), p_amount: num(fd, "quantity") }));
  refreshAll();
}

/** Put a known ingredient on the shopping list by hand. */
export async function addIngredientToList(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("shopping_extras").insert({
    name: str(fd, "name"),
    ingredient_id: str(fd, "ingredient_id"),
    quantity: num(fd, "quantity"),
  }));
  refreshAll();
}

/** Set a pantry item's amount; optionally also switch the unit it's counted in (send ingredient_id + unit). */
export async function setPantryQuantity(fd: FormData) {
  const supabase = await db();
  await switchUnitIfChanged(str(fd, "ingredient_id"), str(fd, "unit"));
  check(await supabase
    .from("pantry_items")
    .update({ quantity: num(fd, "quantity"), updated_at: new Date().toISOString() })
    .eq("id", str(fd, "id")));
  refreshAll();
}

export async function deletePantryItem(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("pantry_items").delete().eq("id", str(fd, "id")));
  refreshAll();
}

export type ActionState = { error?: string; message?: string };

export async function quickAddPantry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const text = str(fd, "text");
  if (!text) return { error: "Write what you bought or have." };
  try {
    const parsed = await parsePantryText(text, await catalog());
    const supabase = await db();
    for (const item of parsed.items) {
      const id = await ensureIngredient(item.name, item.unit, item.category);
      check(await supabase.rpc("add_stock", { p_ingredient_id: id, p_amount: item.quantity, p_location: item.location }));
    }
    refreshAll();
    return { message: `Added ${parsed.items.length} item${parsed.items.length === 1 ? "" : "s"}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Freezer
// ---------------------------------------------------------------------------

export async function addFrozenMeal(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("frozen_meals").insert({
    name: str(fd, "name"),
    portions: num(fd, "portions") ?? 1,
    frozen_on: str(fd, "frozen_on") || undefined,
    notes: str(fd, "notes") || null,
  }));
  refreshAll();
}

export async function eatFrozenPortion(fd: FormData) {
  const supabase = await db();
  const id = str(fd, "id");
  const { data } = await supabase.from("frozen_meals").select("portions").eq("id", id).single();
  if (!data) return;
  if (data.portions <= 1) {
    check(await supabase.from("frozen_meals").delete().eq("id", id));
  } else {
    check(await supabase.from("frozen_meals").update({ portions: data.portions - 1 }).eq("id", id));
  }
  refreshAll();
}

export async function deleteFrozenMeal(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("frozen_meals").delete().eq("id", str(fd, "id")));
  refreshAll();
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export type ImportState = { error?: string; recipe?: ParsedRecipe; nonce?: number };

export async function importRecipe(_prev: ImportState, fd: FormData): Promise<ImportState> {
  try {
    let source: RecipeSource;
    const photo = fd.get("photo");
    const url = str(fd, "url");
    const text = str(fd, "text");

    if (photo instanceof File && photo.size > 0) {
      if (photo.size > 5 * 1024 * 1024) return { error: "Photo is too large (max 5 MB)." };
      const mediaType = photo.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) {
        return { error: "Use a JPEG, PNG, WebP or GIF photo." };
      }
      source = { kind: "image", mediaType, base64: Buffer.from(await photo.arrayBuffer()).toString("base64") };
    } else if (url) {
      source = { kind: "url", url };
    } else if (text) {
      source = { kind: "text", text };
    } else {
      return { error: "Paste text, a URL, or choose a photo." };
    }

    return { recipe: await parseRecipe(source, await catalog()), nonce: Date.now() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type RecipeInput = {
  id?: string;
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  freezable: boolean;
  steps: string[];
  source_url: string | null;
  notes: string | null;
  ingredients: {
    name: string;
    quantity: number | null;
    unit: string;
    category: string;
    note: string | null;
    optional: boolean;
  }[];
};

export async function saveRecipe(input: RecipeInput): Promise<{ error: string } | void> {
  const supabase = await db();
  if (!input.title.trim()) return { error: "Recipe needs a title." };

  const fields = {
    title: input.title.trim(),
    servings: input.servings,
    prep_minutes: input.prep_minutes,
    cook_minutes: input.cook_minutes,
    freezable: input.freezable,
    steps: input.steps.map((s) => s.trim()).filter(Boolean),
    source_url: input.source_url,
    notes: input.notes,
  };

  let recipeId: string;
  try {
    // 1. Resolve every line to an ingredient BEFORE touching the recipe. Creating missing
    //    ingredients is harmless if a later step fails; nothing existing is changed here.
    type Row = { ingredient_id: string; quantity: number | null; unit: string; note: string | null; optional: boolean; position: number };
    const rows = new Map<string, Row>();
    const idsByName = new Map<string, string>(); // for {{Name}} amount tokens in the steps
    for (const line of input.ingredients) {
      if (!line.name.trim()) continue;
      const unit = line.unit || "pc";
      const quantity = typeof line.quantity === "number" && line.quantity > 0 ? line.quantity : null;
      // A new ingredient's pantry unit comes from the recipe line (spoons/cups become ml).
      const ingredientId = await ensureIngredient(line.name, stockUnitFor(unit), line.category);
      idsByName.set(line.name.trim().toLowerCase(), ingredientId);
      const existing = rows.get(ingredientId);
      if (existing) {
        // Same ingredient listed twice: merge, converting units where possible.
        const factor = unitFactor(unit, existing.unit);
        if (quantity !== null && factor !== null) existing.quantity = (existing.quantity ?? 0) + quantity * factor;
        existing.note = [existing.note, line.note].filter(Boolean).join("; ") || null;
        existing.optional &&= line.optional;
      } else {
        rows.set(ingredientId, { ingredient_id: ingredientId, quantity, unit, note: line.note, optional: line.optional, position: rows.size });
      }
    }

    // 2. Save the recipe and all its lines in one transaction: if anything fails, nothing changes.
    const { data, error } = await supabase.rpc("save_recipe", {
      p_recipe_id: input.id ?? null,
      p_fields: { ...fields, steps: stepsToStored(fields.steps, idsByName) },
      p_lines: [...rows.values()],
    });
    if (error) return { error: `Couldn't save — your recipe wasn't changed. (${error.message})` };
    recipeId = data as string;
  } catch (e) {
    return { error: `Couldn't save — your recipe wasn't changed. (${(e as Error).message})` };
  }

  refreshAll();
  redirect(`/recipes/${recipeId}`);
}

export type ConversionInput = Omit<Conversion, "id">;

/** Create or replace an ingredient's conversion for one recipe unit. */
export async function saveConversion(input: ConversionInput): Promise<{ error: string } | { conversion: Conversion }> {
  if (!(input.amount > 0) || !(input.equals_amount > 0)) return { error: "Enter both amounts." };
  const supabase = await db();
  const { data, error } = await supabase
    .from("ingredient_conversions")
    .upsert(input, { onConflict: "ingredient_id,unit" })
    .select("id, ingredient_id, unit, amount, equals_amount, equals_unit")
    .single<Conversion>();
  if (error) return { error: error.message };
  refreshAll();
  return { conversion: data };
}

export type SourceInput = {
  ingredient_id: string;
  amount: number;
  unit: string;
  source_name: string;
  source_amount: number;
  source_unit: string;
  source_category: string;
};

/** "30 ml of Lime juice comes from 1 lime": create or replace the ingredient's source. */
export async function saveIngredientSource(input: SourceInput): Promise<{ error: string } | { ok: true }> {
  if (!(input.amount > 0) || !(input.source_amount > 0)) return { error: "Enter both amounts." };
  if (!input.source_name.trim()) return { error: "Choose what it's made from." };
  try {
    const supabase = await db();
    const sourceId = await ensureIngredient(input.source_name, stockUnitFor(input.source_unit), input.source_category || "produce");
    if (sourceId === input.ingredient_id) return { error: "An ingredient can't be made from itself." };
    const { error } = await supabase.from("ingredient_sources").upsert(
      {
        ingredient_id: input.ingredient_id,
        amount: input.amount,
        unit: input.unit,
        source_ingredient_id: sourceId,
        source_amount: input.source_amount,
        source_unit: input.source_unit,
      },
      { onConflict: "ingredient_id" },
    );
    if (error) return { error: error.message };
  } catch (e) {
    return { error: (e as Error).message };
  }
  refreshAll();
  return { ok: true };
}

export async function deleteIngredientSource(ingredientId: string) {
  const supabase = await db();
  check(await supabase.from("ingredient_sources").delete().eq("ingredient_id", ingredientId));
  refreshAll();
}

export async function deleteConversion(id: string) {
  const supabase = await db();
  check(await supabase.from("ingredient_conversions").delete().eq("id", id));
  refreshAll();
}

export async function deleteRecipe(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("recipes").delete().eq("id", str(fd, "id")));
  refreshAll();
  redirect("/recipes");
}

/** "Add missing ingredients to the shopping list" = plan the recipe. The list is derived. */
export async function planRecipe(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("planned_meals").insert({ recipe_id: str(fd, "recipe_id"), batches: num(fd, "batches") ?? 1 }));
  refreshAll();
}

export async function unplanMeal(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("planned_meals").delete().eq("id", str(fd, "id")));
  refreshAll();
}

// ---------------------------------------------------------------------------
// Cooking in progress (long waits: marinating, proving, resting)
// ---------------------------------------------------------------------------

/** Start cooking a recipe: remembers the portions and which steps you tick off. */
export async function startCooking(recipeId: string, batches: number) {
  const supabase = await db();
  check(await supabase.from("cooking_sessions").upsert({ recipe_id: recipeId, batches }, { onConflict: "recipe_id" }));
  refreshAll();
}

export async function setCookingSteps(sessionId: string, doneSteps: number[]) {
  const supabase = await db();
  check(await supabase.from("cooking_sessions").update({ done_steps: doneSteps }).eq("id", sessionId));
  refreshAll();
}

/** "Back in 2 h" marker while something marinates; null clears it. */
export async function setCookingTimer(sessionId: string, minutes: number | null) {
  const supabase = await db();
  const waitUntil = minutes === null ? null : new Date(Date.now() + minutes * 60_000).toISOString();
  check(await supabase.from("cooking_sessions").update({ wait_until: waitUntil }).eq("id", sessionId));
  refreshAll();
}

export async function cancelCooking(sessionId: string) {
  const supabase = await db();
  check(await supabase.from("cooking_sessions").delete().eq("id", sessionId));
  refreshAll();
}

/** Cook: deducts ingredients, clears a plan, optionally freezes portions, and marks ticked items as ran out. */
export async function cookRecipe(fd: FormData) {
  const supabase = await db();
  const ranOut = fd.getAll("ran_out").filter((v): v is string => typeof v === "string" && v.length > 0);
  check(await supabase.rpc("cook_recipe", {
    p_recipe_id: str(fd, "recipe_id"),
    p_batches: num(fd, "batches") ?? 1,
    p_freeze_portions: num(fd, "freeze_portions") ?? 0,
    p_ran_out: ranOut,
  }));
  refreshAll();
}

// ---------------------------------------------------------------------------
// Shopping
// ---------------------------------------------------------------------------

/** Tick an item off: it goes into the pantry, and so disappears from the derived list. */
export async function buyItem(fd: FormData) {
  const supabase = await db();
  check(await supabase.rpc("add_stock", { p_ingredient_id: str(fd, "ingredient_id"), p_amount: num(fd, "amount") }));
  refreshAll();
}

/** Add anything to the list. It becomes an ingredient so it has a unit and lands in the pantry when bought. */
export async function addExtra(fd: FormData) {
  const supabase = await db();
  const name = str(fd, "name");
  const ingredientId = await ensureIngredientAs(name, str(fd, "unit") || "pc", str(fd, "category") || "other");
  check(await supabase.from("shopping_extras").insert({ name, ingredient_id: ingredientId, quantity: num(fd, "quantity") }));
  refreshAll();
}

/** Legacy free-text list items (no ingredient). */
export async function removeExtra(fd: FormData) {
  const supabase = await db();
  check(await supabase.from("shopping_extras").delete().eq("id", str(fd, "id")));
  refreshAll();
}

/** Take an ingredient off the list: drops manual entries and stops auto-restock for it. */
export async function removeFromList(fd: FormData) {
  const supabase = await db();
  const ingredientId = str(fd, "ingredient_id");
  check(await supabase.from("shopping_extras").delete().eq("ingredient_id", ingredientId));
  check(await supabase.from("pantry_items").update({ auto_restock: false }).eq("ingredient_id", ingredientId));
  refreshAll();
}

export async function signOut() {
  const supabase = await db();
  await supabase.auth.signOut();
  redirect("/login");
}
