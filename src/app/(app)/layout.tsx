import { Suspense } from "react";
import { Nav } from "@/components/nav";
import { createClient } from "@/lib/supabase/server";

/** The shopping badge needs a database round trip; the tab bar shouldn't wait for it. */
async function ShoppingCount() {
  const supabase = await createClient();
  const [{ count: listCount }, { count: extrasCount }] = await Promise.all([
    supabase.from("shopping_list").select("*", { count: "exact", head: true }),
    supabase.from("shopping_extras").select("*", { count: "exact", head: true }).is("ingredient_id", null),
  ]);
  const total = (listCount ?? 0) + (extrasCount ?? 0);
  if (!total) return null;
  return (
    <span className="absolute top-1 right-[calc(50%-1.5rem)] rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-white md:static dark:text-black">
      {total}
    </span>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Nav shoppingBadge={<Suspense fallback={null}><ShoppingCount /></Suspense>} />
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-28 md:pb-10">{children}</main>
    </>
  );
}
