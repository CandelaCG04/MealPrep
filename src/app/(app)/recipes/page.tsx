import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { RecipeSummary } from "@/lib/types";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "cookable", label: "Cookable now" },
  { key: "almost", label: "Missing 1–2" },
  { key: "freezable", label: "Freezable" },
] as const;

export default async function RecipesPage({ searchParams }: PageProps<"/recipes">) {
  const { filter = "all", q = "" } = (await searchParams) as { filter?: string; q?: string };
  const supabase = await createClient();
  const { data } = await supabase.from("recipe_summary").select("*").order("title").returns<RecipeSummary[]>();

  const recipes = (data ?? [])
    .filter((r) => r.title.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => {
      if (filter === "cookable") return r.missing_count === 0;
      if (filter === "almost") return r.missing_count > 0 && r.missing_count <= 2;
      if (filter === "freezable") return r.freezable;
      return true;
    })
    .sort((a, b) => a.missing_count - b.missing_count);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="h1">Recipes</h1>
        <Link href="/recipes/new" className="btn-primary">+ New</Link>
      </div>

      <form className="flex gap-2">
        <input type="hidden" name="filter" value={filter} />
        <input className="input" name="q" defaultValue={q} placeholder="Search recipes" />
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={{ pathname: "/recipes", query: { filter: f.key, ...(q ? { q } : {}) } }}
            className={`btn shrink-0 border ${filter === f.key ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {recipes.length ? (
        <ul className="flex flex-col gap-2">
          {recipes.map((r) => (
            <li key={r.id}>
              <Link href={`/recipes/${r.id}`} className="card flex items-center gap-3 transition hover:border-accent">
                <div className="flex-1">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-sm text-muted">
                    {[r.servings && `${r.servings} servings`, r.prep_minutes && `${r.prep_minutes} min`, r.freezable && "🧊 freezable", r.planned && "📌 planned"]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <Availability recipe={r} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">
          {data?.length ? "No recipes match." : "No recipes yet — import one from a link, photo or pasted text."}
        </p>
      )}
    </div>
  );
}

function Availability({ recipe }: { recipe: RecipeSummary }) {
  const have = recipe.required_count - recipe.missing_count;
  if (recipe.required_count === 0) return null;
  if (recipe.missing_count === 0) {
    return <span className="rounded-full bg-accent-soft px-2 py-1 text-xs font-medium text-accent">Ready</span>;
  }
  return (
    <span className="rounded-full bg-warn-soft px-2 py-1 text-xs font-medium text-warn">
      {have}/{recipe.required_count}
    </span>
  );
}
