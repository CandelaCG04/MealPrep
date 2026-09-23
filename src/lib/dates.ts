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

/** "just now" / "25 min ago" / "2 h ago" / "3 days ago" */
export function fmtSince(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 36) return `${fmtMinutes(Math.round(minutes / 15) * 15)} ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

/** How long until a timer is up, or null once it is. */
export function fmtUntil(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return minutes <= 0 ? null : fmtMinutes(Math.max(1, minutes));
}

export const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
