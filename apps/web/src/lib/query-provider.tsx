"use client";

/**
 * TanStack React Query provider for apps/web. Wraps the whole app (mounted in app/layout.tsx)
 * so `use-favorites.ts`'s hooks share one cache — this is what dedupes the
 * `GET /favorites/teams|players` calls that `FavoriteButton` (embedded in /teams/[id] and
 * /players/[id]) and `app/favorites/page.tsx` would otherwise both fire independently.
 *
 * `QueryClient` is created via `useState` (not module scope) per the standard Next.js App
 * Router + React Query pattern: App Router can render a given component tree per-request on the
 * server, so a module-scope singleton would leak cached data across requests/users. Client
 * Components created lazily like this only run once per browser tab, which is what we want.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
