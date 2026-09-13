import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CATEGORIES, UNITS, type Ingredient } from "./types";

const MODEL = "claude-opus-5";

/** Claude features are optional: without a real key the app hides them. */
export function aiEnabled() {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!key && key.startsWith("sk-ant-") && !key.endsWith("...");
}

let client: Anthropic | undefined;
function getClient() {
  if (!aiEnabled()) throw new Error("Claude import is not configured (no ANTHROPIC_API_KEY).");
  return (client ??= new Anthropic());
}

const IngredientLine = z.object({
  name: z.string().describe("Singular, generic ingredient name, e.g. 'onion', 'chicken thigh'"),
  quantity: z.number().nullable().describe("Amount in `unit`; null for 'to taste' / unspecified"),
  unit: z.enum(UNITS),
  category: z.enum(CATEGORIES),
  note: z.string().nullable().describe("Preparation note, e.g. 'finely chopped'"),
  optional: z.boolean(),
});

export const ParsedRecipe = z.object({
  title: z.string(),
  servings: z.number().int().nullable(),
  prep_minutes: z.number().int().nullable(),
  freezable: z.boolean().describe("Whether this dish freezes well as a prepped meal"),
  instructions: z.string().describe("Numbered steps, one per line"),
  ingredients: z.array(IngredientLine),
});
export type ParsedRecipe = z.infer<typeof ParsedRecipe>;

const ParsedPantry = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      unit: z.enum(UNITS),
      category: z.enum(CATEGORIES),
      location: z.enum(["pantry", "fridge", "freezer"]),
    }),
  ),
});
export type ParsedPantry = z.infer<typeof ParsedPantry>;

function catalogPrompt(catalog: Ingredient[]) {
  if (catalog.length === 0) return "The user has no ingredients saved yet.";
  const lines = catalog.map((i) => `- ${i.name} (${i.unit})`).join("\n");
  return `The user's existing ingredient catalog is below. When an ingredient matches one of these, use exactly that name and convert the quantity into that unit (e.g. "2 cups rice" -> grams if rice is stored in g). Only invent a new name when nothing matches.\n\n${lines}`;
}

async function extract<T extends z.ZodType>(
  schema: T,
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
): Promise<z.infer<T>> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to process this input.");
  }
  if (!response.parsed_output) {
    throw new Error("Could not understand that input — try pasting the recipe text instead.");
  }
  return response.parsed_output as z.infer<T>;
}

async function fetchPageText(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error("Enter a full http(s) URL.");
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (MealPrep recipe importer)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Could not fetch that page (HTTP ${res.status}).`);
  const html = await res.text();

  // Recipe sites usually embed schema.org JSON-LD — the cleanest source.
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((s) => /recipe/i.test(s))
    .join("\n");

  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return `${jsonLd ? `Structured data:\n${jsonLd}\n\n` : ""}Page text:\n${text}`;
}

export type RecipeSource =
  | { kind: "text"; text: string }
  | { kind: "url"; url: string }
  | { kind: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };

export async function parseRecipe(source: RecipeSource, catalog: Ingredient[]): Promise<ParsedRecipe> {
  const system = `You extract recipes into structured data for a meal-prep app. Use metric units where the source allows (g, ml), "pc" for countable items. Merge duplicate ingredients. Leave out water unless it's a significant bought ingredient.\n\n${catalogPrompt(catalog)}`;

  let content: Anthropic.Beta.BetaContentBlockParam[];
  if (source.kind === "image") {
    content = [
      { type: "image", source: { type: "base64", media_type: source.mediaType, data: source.base64 } },
      { type: "text", text: "Extract the recipe in this photo." },
    ];
  } else if (source.kind === "url") {
    content = [{ type: "text", text: `Extract the recipe from this web page (${source.url}).\n\n${await fetchPageText(source.url)}` }];
  } else {
    content = [{ type: "text", text: `Extract this recipe:\n\n${source.text}` }];
  }

  return extract(ParsedRecipe, system, content);
}

export async function parsePantryText(text: string, catalog: Ingredient[]): Promise<ParsedPantry> {
  const system = `You turn a quick note or grocery receipt into pantry items for a meal-prep app. Guess a sensible storage location (fridge for dairy/fresh meat, freezer for frozen goods, pantry otherwise). If no amount is given, use quantity null.\n\n${catalogPrompt(catalog)}`;
  return extract(ParsedPantry, system, [{ type: "text", text }]);
}
