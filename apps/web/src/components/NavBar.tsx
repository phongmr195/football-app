import Link from "next/link";
import { Container } from "@football-app/ui";
import { AuthStatus } from "./AuthStatus";

/**
 * Minimal top nav — not a full site-wide nav design, just enough to reach the browse
 * pages (competitions/standings) from the home page. Extend as more sections land.
 *
 * Stays a Server Component: only `<AuthStatus />` (sign-in state) needs client-side auth
 * context, so that's split into its own "use client" component rather than converting the
 * whole nav.
 */
export function NavBar() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <Container size="lg" className="flex h-14 items-center justify-between gap-6">
        <div className="flex items-center gap-6">
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
            <Link
              href="/matches"
              className="hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Lịch thi đấu
            </Link>
            <Link
              href="/favorites"
              className="hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Yêu thích
            </Link>
          </nav>
        </div>
        <AuthStatus />
      </Container>
    </header>
  );
}
