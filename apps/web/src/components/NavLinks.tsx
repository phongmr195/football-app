"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, ListOrdered, Scale, Trophy, type LucideIcon } from "lucide-react";
import { cn } from "@football-app/ui";

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/competitions", label: "Giải đấu", icon: Trophy },
  { href: "/standings", label: "Bảng xếp hạng", icon: ListOrdered },
  { href: "/matches", label: "Lịch thi đấu", icon: Calendar },
  { href: "/compare", label: "So sánh cầu thủ", icon: Scale },
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
      {LINKS.map(({ href, label, icon: Icon }) => {
        const isActive = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
