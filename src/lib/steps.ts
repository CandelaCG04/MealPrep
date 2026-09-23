/**
 * Steps can quote an ingredient's amount, so it scales with the portions:
 *   "Add {{Rice}} to the pan"  ->  "Add 400 g to the pan" at 4 portions.
 *
 * Stored tied to the ingredient ({{ing:<uuid>}}) so renaming it keeps working;
 * shown by name while editing.
 */
const ID_TOKEN = /\{\{ing:([0-9a-fA-F-]{36})\}\}/g;
const NAME_TOKEN = /\{\{\s*([^{}]{1,60}?)\s*\}\}/g;

const key = (name: string) => name.trim().toLowerCase();

export const amountToken = (name: string) => `{{${name}}}`;

/** Stored steps -> what the editor shows: {{ing:id}} becomes {{Name}}. */
export function stepsToEditable(steps: string[], lines: { ingredient_id: string; name: string }[]) {
  const names = new Map(lines.map((l) => [l.ingredient_id, l.name]));
  return steps.map((text) => text.replace(ID_TOKEN, (whole, id: string) => (names.has(id) ? `{{${names.get(id)}}}` : whole)));
}

/** Editor steps -> what gets stored: {{Name}} becomes {{ing:id}} when it matches an ingredient of this recipe. */
export function stepsToStored(steps: string[], idsByName: Map<string, string>) {
  return steps.map((text) =>
    text.replace(NAME_TOKEN, (whole, name: string) => {
      const id = idsByName.get(key(name));
      return id ? `{{ing:${id}}}` : whole;
    }),
  );
}

export type StepPart = { kind: "text"; text: string } | { kind: "amount"; text: string };

/**
 * Splits a step into plain text and amount chips, resolving each token with `amountOf`
 * (which returns the scaled amount, or null when the ingredient is no longer in the recipe).
 */
export function renderStep(text: string, amountOf: (ingredientId: string) => string | null): StepPart[] {
  const parts: StepPart[] = [];
  let last = 0;
  // Anything still written as {{Name}} (an ingredient that's no longer in the recipe) reads as plain text.
  const plain = (s: string) => s.replace(NAME_TOKEN, (whole, name: string) => (whole.startsWith("{{ing:") ? whole : name));

  for (const match of text.matchAll(ID_TOKEN)) {
    const amount = amountOf(match[1]);
    if (amount === null) continue; // ingredient gone from the recipe: drop the token below
    if (match.index > last) parts.push({ kind: "text", text: plain(text.slice(last, match.index)) });
    parts.push({ kind: "amount", text: amount });
    last = match.index + match[0].length;
  }
  // a dropped token would leave a double space behind
  const rest = plain(text.slice(last)).replace(ID_TOKEN, "").replace(/ {2,}/g, " ");
  if (rest) parts.push({ kind: "text", text: rest });
  return parts;
}
