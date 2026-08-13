import Link from "next/link";
import { Container } from "@football-app/ui";

/**
 * Minimal top nav — not a full site-wide nav design, just enough to reach the browse
 * pages (competitions/standings) from the home page. Extend as more sections land.
 */
export function NavBar() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <Container size="lg" className="flex h-14 items-center gap-6">
        <Link
          href="/"
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Football App
        </Link>
        <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <Link
            href="/competitions"
            className="hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            Giải đấu
          </Link>
        </nav>
      </Container>
    </header>
  );
}
