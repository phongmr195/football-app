"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@football-app/ui";

const LINKS = [
  { href: "/competitions", label: "Giải đấu" },
  { href: "/standings", label: "Bảng xếp hạng" },
  { href: "/matches", label: "Lịch thi đấu" },
];

/**
 * Client island for just the active-route highlighting — NavBar itself stays a Server
 * Component (same reasoning as AuthStatus being split out: usePathname() is a client-only
 * hook, and there's no need to convert the whole header to get it).
 */
export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 text-sm">
      {LINKS.map(({ href, label }) => {
        const isActive = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-full px-3 py-1.5 transition-colors",
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
