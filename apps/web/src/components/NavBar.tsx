import Link from "next/link";
import { Container } from "@football-app/ui";
import { AuthStatus } from "./AuthStatus";
import { NavLinks } from "./NavLinks";
import { NotificationBell } from "./NotificationBell";
import { SearchBox } from "./SearchBox";

/**
 * Minimal top nav — not a full site-wide nav design, just enough to reach the browse
 * pages (competitions/standings) from the home page. Extend as more sections land.
 *
 * Stays a Server Component: only `<AuthStatus />` (sign-in state), `<NotificationBell />` (unread
 * count/dropdown), `<NavLinks />` (active-route highlighting), and `<SearchBox />` (query/dropdown
 * state) need client-side hooks, so those are split into their own "use client" components rather
 * than converting the whole header. `<SearchBox />` sits in its own full-width row below the main
 * menu row (was previously a fixed `w-56` input squeezed into the menu row itself).
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
            My Football
          </Link>
          <NavLinks />
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <AuthStatus />
        </div>
      </Container>
      <div className="border-t border-zinc-100 py-2.5 dark:border-zinc-900">
        <Container size="lg">
          <SearchBox className="w-full" />
        </Container>
      </div>
    </header>
  );
}
