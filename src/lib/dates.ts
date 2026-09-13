/** 75 -> "1 h 15 min" */
export function fmtMinutes(minutes: number | null | undefined) {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ");
}

export function totalMinutes(recipe: { prep_minutes: number | null; cook_minutes: number | null }) {
  return (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);
}

export function daysSince(isoDate: string) {
  const then = new Date(isoDate + (isoDate.length === 10 ? "T00:00:00" : ""));
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

export function ageLabel(days: number) {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** Most cooked meals keep best quality for ~2–3 months frozen. */
export function freezerTone(days: number) {
  if (days >= 90) return "old";
  if (days >= 60) return "soon";
  return "fresh";
}
