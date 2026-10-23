/**
 * Free, rule-based recipe reader: pasted text -> the recipe editor's fields.
 * Works on the usual shapes (an "Ingredients" list of "200 g rice" lines, numbered steps,
 * "Serves 4", "Prep: 15 min"), in English or Spanish. Anything it can't find comes back null
 * so the editor keeps what's already there.
 */
import type { Ingredient } from "./types";

export type ParsedLine = {
  name: string;
  quantity: number | null;
  unit: string;
  category: string;
  note: string | null;
  optional: boolean;
};

export type ParsedText = {
  title: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: ParsedLine[];
  steps: string[];
};

const LETTER = "a-zA-ZÀ-ɏ";

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8" };

const NUM = String.raw`\d+\/\d+|\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?`;
const QTY = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|–|—|to|a|o)\s*(?:${NUM}))?\s*`, "i");

/** "1 1/2" -> 1.5, "0,5" -> 0.5 */
function toNumber(s: string) {
  return s
    .trim()
    .split(/\s+/)
    .reduce((sum, part) => {
      if (part.includes("/")) {
        const [n, d] = part.split("/").map(Number);
        return sum + (d ? n / d : 0);
      }
      return sum + Number(part.replace(",", "."));
    }, 0);
}

/** Unit spellings -> the app's units. `factor` converts imperial weights into grams. */
const UNIT_ALIASES: [unit: string, aliases: string[], factor?: number][] = [
  ["g", ["g", "gr", "grs", "gram", "grams", "gramme", "grammes", "gramo", "gramos"]],
  ["kg", ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramo", "kilogramos"]],
  ["ml", ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters", "mililitro", "mililitros"]],
  ["l", ["l", "lt", "ltr", "litre", "litres", "liter", "liters", "litro", "litros"]],
  ["tbsp", ["tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons", "cucharada", "cucharadas", "cda", "cdas"]],
  ["tsp", ["tsp", "tsps", "teaspoon", "teaspoons", "cucharadita", "cucharaditas", "cdta", "cdtas", "cdita", "cditas"]],
  ["cup", ["cup", "cups", "taza", "tazas"]],
  ["can", ["can", "cans", "tin", "tins", "lata", "latas"]],
  ["pack", ["pack", "packs", "packet", "packets", "package", "packages", "paquete", "paquetes", "sobre", "sobres"]],
  ["clove", ["clove", "cloves", "diente", "dientes"]],
  ["slice", ["slice", "slices", "loncha", "lonchas", "rebanada", "rebanadas", "rodaja", "rodajas"]],
  ["pinch", ["pinch", "pinches", "pizca", "pizcas"]],
  ["bunch", ["bunch", "bunches", "manojo", "manojos"]],
  ["pc", ["pc", "pcs", "piece", "pieces", "unidad", "unidades", "ud", "uds"]],
  ["g", ["oz", "ounce", "ounces", "onza", "onzas"], 28.35],
  ["g", ["lb", "lbs", "pound", "pounds", "libra", "libras"], 453.6],
];

const UNIT_BY_ALIAS = new Map(UNIT_ALIASES.flatMap(([unit, aliases, factor]) => aliases.map((a) => [a, { unit, factor: factor ?? 1 }] as const)));
const UNIT_RE = new RegExp(
  `^(${[...UNIT_BY_ALIAS.keys()].sort((a, b) => b.length - a.length).join("|")})\\.?(?![${LETTER}])\\s*`,
  "i",
);

const SIZE_WORDS = /^(?:large|small|medium|big|extra[- ]large|grandes?|pequeñ[oa]s?|median[oa]s?)\s+/i;

// ---------------------------------------------------------------------------
// Categories for ingredients that aren't in the catalog yet
// ---------------------------------------------------------------------------

const CATEGORY_WORDS: [category: string, words: string[]][] = [
  ["spices", ["salt", "pepper flakes", "black pepper", "cumin", "paprika", "oregano", "cinnamon", "nutmeg", "turmeric", "curry", "chili powder", "chilli powder", "thyme", "rosemary", "bay lea", "spice", "sal", "pimienta", "comino", "pimentón", "orégano", "canela", "nuez moscada", "cúrcuma", "tomillo", "romero", "laurel"]],
  ["pantry", ["rice", "pasta", "spaghetti", "noodle", "flour", "sugar", "oil", "vinegar", "stock", "broth", "lentil", "chickpea", "bean", "oats", "honey", "sauce", "tomato paste", "passata", "chopped tomatoes", "coconut milk", "arroz", "harina", "azúcar", "aceite", "vinagre", "caldo", "lenteja", "garbanzo", "alubia", "judía", "avena", "miel", "salsa", "tomate triturado"]],
  ["fish", ["salmon", "tuna", "cod", "prawn", "shrimp", "fish", "hake", "sardine", "anchov", "mussel", "squid", "salmón", "atún", "bacalao", "gamba", "langostino", "pescado", "merluza", "sardina", "anchoa", "mejillón", "calamar"]],
  ["meat", ["chicken", "beef", "pork", "lamb", "turkey", "bacon", "ham", "sausage", "mince", "chorizo", "pollo", "ternera", "cerdo", "cordero", "pavo", "jamón", "salchicha", "carne"]],
  ["dairy", ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "egg", "parmesan", "mozzarella", "feta", "leche", "queso", "mantequilla", "nata", "yogur", "huevo"]],
  ["bakery", ["bread", "tortilla", "wrap", "bun", "baguette", "pan"]],
  ["frozen", ["frozen", "congelad"]],
  ["drinks", ["wine", "beer", "juice", "vino", "cerveza", "zumo"]],
  ["produce", ["onion", "garlic", "tomato", "potato", "carrot", "pepper", "courgette", "zucchini", "spinach", "lettuce", "lemon", "lime", "apple", "banana", "mushroom", "broccoli", "cabbage", "leek", "celery", "cucumber", "avocado", "ginger", "parsley", "coriander", "cilantro", "basil", "mint", "aubergine", "eggplant", "pumpkin", "squash", "cebolla", "ajo", "tomate", "patata", "zanahoria", "pimiento", "calabacín", "espinaca", "lechuga", "limón", "lima", "manzana", "plátano", "champiñón", "seta", "brócoli", "col", "puerro", "apio", "pepino", "aguacate", "jengibre", "perejil", "albahaca", "menta", "berenjena", "calabaza"]],
];

function guessCategory(name: string) {
  const n = name.toLowerCase();
  const words = n.split(new RegExp(`[^${LETTER}]+`));
  // Short keywords must be a whole word ("sal" isn't "salsa"); longer ones can be part of one.
  const has = (w: string) => (w.length <= 4 ? words.some((x) => x === w || x === `${w}s` || x === `${w}es`) : n.includes(w));
  for (const [category, keywords] of CATEGORY_WORDS) {
    if (keywords.some(has)) return category;
  }
  return "other";
}

/** Rough singular, only used to match against the catalog ("onions" -> "onion", "tomatoes" -> "tomato"). */
function singular(word: string) {
  const w = word.toLowerCase().trim();
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

// ---------------------------------------------------------------------------
// One ingredient line
// ---------------------------------------------------------------------------

export function parseIngredientLine(raw: string, catalog: Ingredient[] = []): ParsedLine | null {
  let text = raw.replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, (c) => ` ${UNICODE_FRACTIONS[c]}`).replace(/\s+/g, " ").trim();
  if (!text) return null;

  const notes: string[] = [];
  let optional = false;

  // Amount
  let quantity: number | null = null;
  const q = text.match(QTY);
  if (q) {
    quantity = toNumber(q[1]);
    text = text.slice(q[0].length);
  } else {
    // "a pinch of salt", "una pizca de sal", "pinch of salt"
    const one = text.match(/^(?:an?|one|una?|uno)\s+/i);
    if (one && UNIT_RE.test(text.slice(one[0].length))) {
      quantity = 1;
      text = text.slice(one[0].length);
    } else if (new RegExp(UNIT_RE.source + String.raw`(?:of|de)\s`, "i").test(text)) {
      quantity = 1;
    }
  }

  // "1 (400 g) can tomatoes"
  const pack = text.match(/^\(([^)]*)\)\s*/);
  if (pack) {
    notes.push(pack[1].trim());
    text = text.slice(pack[0].length);
  }

  // Unit
  let unit: string | null = null;
  const u = quantity !== null ? text.match(UNIT_RE) : null;
  if (u) {
    const found = UNIT_BY_ALIAS.get(u[1].toLowerCase())!;
    unit = found.unit;
    if (quantity !== null && found.factor !== 1) quantity = Math.round(quantity * found.factor);
    text = text.slice(u[0].length);
  }
  text = text.replace(/^(?:of|de|del)\s+/i, "");

  // "large onions" -> name "onions", note "large"
  const size = text.match(SIZE_WORDS);
  if (size) {
    notes.push(size[0].trim());
    text = text.slice(size[0].length);
  }

  // Bracketed bits and everything after the first comma are notes.
  text = text.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    notes.push(inner.trim());
    return " ";
  });
  const comma = text.indexOf(",");
  if (comma >= 0) {
    notes.push(text.slice(comma + 1).trim());
    text = text.slice(0, comma);
  }

  // "salt to taste", "optional"
  for (const phrase of [/\b(?:to taste|al gusto|as needed|a gusto)\b/i, /\b(?:optional|opcional)\b/i]) {
    const m = text.match(phrase);
    if (m) {
      notes.push(m[0]);
      text = text.replace(phrase, " ");
    }
  }
  const cleanedNotes = notes.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (cleanedNotes.some((n) => /^(?:optional|opcional)$/i.test(n))) optional = true;
  const note = cleanedNotes.filter((n) => !/^(?:optional|opcional)$/i.test(n)).join(", ") || null;

  let name = text.replace(/\s+/g, " ").replace(/^[\s\-–:]+|[\s.;:]+$/g, "").trim();
  if (!name) return null;

  // Prefer the catalog's spelling (and with it the category the user already chose).
  const known = catalog.find((i) => i.name.toLowerCase() === name.toLowerCase())
    ?? catalog.find((i) => singular(i.name) === singular(name));
  if (known) name = known.name;
  const category = known?.category ?? guessCategory(name);

  if (!unit) unit = quantity === null && category === "spices" ? "pinch" : "pc";
  if (quantity !== null && !Number.isFinite(quantity)) quantity = null;

  return { name, quantity, unit, category, note, optional };
}

// ---------------------------------------------------------------------------
// Recipe-level details
// ---------------------------------------------------------------------------

/** "1 hr 10 mins" -> 70, "90 min" -> 90, "1,5 horas" -> 90 */
function minutesIn(s: string) {
  let total = 0;
  let found = false;
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours|hora|horas|m|min|mins|minute|minutes|minuto|minutos)(?![a-z])/gi)) {
    const n = Number(m[1].replace(",", "."));
    total += /^h/i.test(m[2]) ? n * 60 : n;
    found = true;
  }
  return found ? Math.round(total) : null;
}

const DURATION = String.raw`((?:\d+(?:[.,]\d+)?\s*[a-z]+\.?\s*){1,2})`;
const TIME_LABELS: [kind: "prep" | "cook" | "total", label: string][] = [
  ["prep", String.raw`prep(?:aration)?|tiempo de preparaci[oó]n|preparaci[oó]n`],
  ["cook", String.raw`cook(?:ing)?|bake|baking|tiempo de (?:cocci[oó]n|cocinado|horneado)|cocci[oó]n|horneado`],
  ["total", String.raw`total|tiempo total|ready in|listo en`],
];

type Meta = { prep?: number; cook?: number; total?: number; servings?: number };

/** Reads servings / times from a short line like "Serves 4 · Prep: 15 min · Cook: 30 min". */
function readMeta(line: string, inIntro: boolean): Meta | null {
  if (line.length > 100) return null;
  const meta: Meta = {};

  for (const [kind, label] of TIME_LABELS) {
    const re = new RegExp(String.raw`(?:^|[^${LETTER}])(?:${label})(?:\s+time)?\s*[:\-–]\s*${DURATION}|(?:^|[^${LETTER}])(?:${label})\s+time\s*${DURATION}`, "i");
    const m = line.match(re);
    const minutes = m && minutesIn(m[1] ?? m[2]);
    if (minutes) meta[kind] = minutes;
  }

  const labelled = line.match(/(?:^|[^a-z])(?:serves|servings|yield|yields|makes|portions|raciones|porciones|personas|comensales|rinde)\s*:?\s*(\d+)/i);
  // "4 portions" alone only counts near the title — in a list it's probably an ingredient.
  const counted = inIntro && line.length <= 40 && line.match(/(\d+)\s*(?:servings|portions|people|persons|raciones|porciones|personas|comensales)(?![a-z])/i);
  const servings = labelled?.[1] ?? (counted ? counted[1] : undefined);
  if (servings) meta.servings = Number(servings);

  return Object.keys(meta).length ? meta : null;
}

// ---------------------------------------------------------------------------
// Whole recipe
// ---------------------------------------------------------------------------

const INGREDIENTS_HEADING = /^(?:ingredients?|ingredientes|you(?:'ll)? need|what you need|necesitas)$/i;
const STEPS_HEADING = /^(?:method|instructions?|directions?|steps?|preparation|how to make(?: it)?|elaboraci[oó]n|preparaci[oó]n|modo de preparaci[oó]n|pasos|instrucciones|procedimiento)$/i;

const BULLET = /^[-*•·▢□☐✓✔◦‣>]\s*/;
const STEP_NUMBER = /^(?:(?:step|paso)\s*\d+\s*[:.)\-–]?|\d+\s*[.):](?!\d))\s*/i;

/** "## Ingredients:" -> "Ingredients" */
const headingText = (line: string) => line.replace(/^#+\s*/, "").replace(/[*_]/g, "").replace(/\s*:\s*$/, "").trim();

const startsWithAmount = (line: string) => /^(?:\d|[½¼¾⅓⅔⅛⅜⅝⅞])/.test(line) && !STEP_NUMBER.test(line);

/** Looks like a step rather than an ingredient: numbered, or a long sentence. */
const looksLikeStep = (line: string) => STEP_NUMBER.test(line) || (line.length > 70 && /[.!?]$/.test(line)) || line.length > 110;

function cleanStep(line: string) {
  return line.replace(BULLET, "").replace(STEP_NUMBER, "").trim();
}

/** One long paragraph -> one step per sentence. */
function splitParagraph(text: string) {
  return text
    .split(/([.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/)
    .reduce<string[]>((out, part, i) => {
      if (i % 2 === 1) out[out.length - 1] += part;
      else out.push(part);
      return out;
    }, [])
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseRecipeText(text: string, catalog: Ingredient[] = []): ParsedText {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());

  let title: string | null = null;
  let prep: number | undefined, cook: number | undefined, total: number | undefined, servings: number | undefined;
  const ingredientLines: string[] = [];
  const stepLines: string[] = [];

  const hasHeadings = lines.some((l) => INGREDIENTS_HEADING.test(headingText(l)) || STEPS_HEADING.test(headingText(l)));
  let section: "intro" | "ingredients" | "steps" = "intro";

  for (const line of lines) {
    if (!line) continue;
    const heading = headingText(line);
    if (INGREDIENTS_HEADING.test(heading)) { section = "ingredients"; continue; }
    if (STEPS_HEADING.test(heading)) { section = "steps"; continue; }

    const meta = section === "steps" && line.length > 60 ? null : readMeta(heading, section === "intro");
    if (meta) {
      prep ??= meta.prep;
      cook ??= meta.cook;
      total ??= meta.total;
      servings ??= meta.servings;
      continue;
    }

    if (hasHeadings) {
      if (section === "intro") {
        if (!title && heading.length <= 100) title = heading;
      } else if (section === "ingredients") {
        // "For the sauce:" sub-headings
        if (/:$/.test(line) && !startsWithAmount(line)) continue;
        ingredientLines.push(line);
      } else {
        stepLines.push(line);
      }
      continue;
    }

    // No headings: guess line by line. Once a step shows up, the rest is method.
    const content = line.replace(BULLET, "");
    if (section === "steps" || (looksLikeStep(content) && (ingredientLines.length > 0 || STEP_NUMBER.test(content)))) {
      section = "steps";
      stepLines.push(line);
    } else if (startsWithAmount(content) || BULLET.test(line) || (ingredientLines.length > 0 && content.length <= 60)) {
      section = "ingredients";
      ingredientLines.push(line);
    } else if (!title && ingredientLines.length === 0 && content.length <= 100) {
      title = headingText(content);
    }
  }

  // Ingredients, merging repeats of the same ingredient in the same unit.
  const ingredients: ParsedLine[] = [];
  for (const line of ingredientLines) {
    const parsed = parseIngredientLine(line.replace(BULLET, ""), catalog);
    if (!parsed) continue;
    const same = ingredients.find((i) => i.name.toLowerCase() === parsed.name.toLowerCase() && i.unit === parsed.unit);
    if (same && same.quantity !== null && parsed.quantity !== null) same.quantity += parsed.quantity;
    else if (!same) ingredients.push(parsed);
  }

  let steps = stepLines.map(cleanStep).filter(Boolean);
  if (steps.length === 1 && steps[0].length > 200) steps = splitParagraph(steps[0]);

  if (total && !cook) cook = Math.max(0, total - (prep ?? 0)) || undefined;

  return {
    title,
    servings: servings ?? null,
    prep_minutes: prep ?? null,
    cook_minutes: cook ?? null,
    ingredients,
    steps,
  };
}
