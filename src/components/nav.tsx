"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/pantry", label: "Pantry", icon: "🥫" },
  { href: "/recipes", label: "Recipes", icon: "📖" },
  { href: "/freezer", label: "Freezer", icon: "🧊" },
  { href: "/shopping", label: "Shopping", icon: "🛒" },
];

export function Nav({ shoppingCount }: { shoppingCount: number }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:sticky md:top-0 md:bottom-auto md:border-t-0 md:border-b">
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`relative flex flex-col items-center gap-0.5 py-2 text-xs md:flex-row md:justify-center md:gap-2 md:py-3 md:text-sm ${
                  active ? "font-semibold text-accent" : "text-muted"
                }`}
              >
                <span className="text-xl md:text-base">{tab.icon}</span>
                {tab.label}
                {tab.href === "/shopping" && shoppingCount > 0 && (
                  <span className="absolute top-1 right-[calc(50%-1.5rem)] rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-white md:static dark:text-black">
                    {shoppingCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
