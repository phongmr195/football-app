import Link from "next/link";
import { Container } from "@football-app/ui";
import { AuthStatus } from "./AuthStatus";
import { NavLinks } from "./NavLinks";

/**
 * Minimal top nav — not a full site-wide nav design, just enough to reach the browse
 * pages (competitions/standings) from the home page. Extend as more sections land.
 *
 * Stays a Server Component: only `<AuthStatus />` (sign-in state) and `<NavLinks />`
 * (active-route highlighting) need client-side hooks, so those are split into their own
 * "use client" components rather than converting the whole header.
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
          <NavLinks />
        </div>
        <AuthStatus />
      </Container>
    </header>
  );
}
