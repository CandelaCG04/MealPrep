import { Nav } from "@/components/nav";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const [{ count: listCount }, { count: extrasCount }] = await Promise.all([
    supabase.from("shopping_list").select("*", { count: "exact", head: true }),
    supabase.from("shopping_extras").select("*", { count: "exact", head: true }).is("ingredient_id", null),
  ]);

  return (
    <>
      <Nav shoppingCount={(listCount ?? 0) + (extrasCount ?? 0)} />
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-28 md:pb-10">{children}</main>
    </>
  );
}
