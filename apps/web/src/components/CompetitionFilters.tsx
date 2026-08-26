"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// How long to wait after the user stops typing before navigating with the new `search`
// query param — avoids a full navigation (and a fresh ISR-backed server fetch) on every
// keystroke. No debounce utility exists elsewhere in the repo yet, so this is a minimal
// inline implementation rather than a new dependency.
const SEARCH_DEBOUNCE_MS = 350;

export interface CompetitionFiltersProps {
  /**
   * Country codes for the filter dropdown, fetched server-side by the parent Server
   * Component from `GET /competitions/countries` (see competitions/page.tsx) — avoids an
   * extra client-side round-trip for a list that's small and static-ish, and the page is
   * already ISR-cached so this doesn't cost anything per-request.
   */
  countries: string[];
}

export function CompetitionFilters({ countries }: CompetitionFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlSearch = searchParams.get("search") ?? "";
  const countryCode = searchParams.get("countryCode") ?? "";

  const [search, setSearch] = useState(urlSearch);
  // Tracks the last `urlSearch` value we've synced `search` from — lets us tell "URL changed
  // from elsewhere" (back/forward nav, a country-select change) apart from "user is typing"
  // without an effect. This is the React-docs "adjust state during render" pattern rather
  // than `useEffect` + `setState`, which the repo's lint config flags as an anti-pattern
  // (react-hooks/set-state-in-effect) since it causes an extra cascading render.
  const [lastSyncedSearch, setLastSyncedSearch] = useState(urlSearch);
  if (urlSearch !== lastSyncedSearch) {
    setLastSyncedSearch(urlSearch);
    setSearch(urlSearch);
  }

  useEffect(() => {
    if (search === urlSearch) return;
    const timeout = setTimeout(() => {
      updateParams({ search });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function updateParams(next: { search?: string; countryCode?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.search !== undefined) {
      if (next.search) params.set("search", next.search);
      else params.delete("search");
    }
    if (next.countryCode !== undefined) {
      if (next.countryCode) params.set("countryCode", next.countryCode);
      else params.delete("countryCode");
    }
    // Filters changed — results shift, so page 1 is the only page guaranteed to make sense.
    params.delete("page");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Tìm giải đấu theo tên..."
        className="h-10 w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <select
        value={countryCode}
        onChange={(event) => updateParams({ countryCode: event.target.value })}
        className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <option value="">Tất cả quốc gia</option>
        {countries.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </div>
  );
}
