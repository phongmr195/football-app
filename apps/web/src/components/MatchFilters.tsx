"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiGetClient } from "@/lib/api-client";
import { competitionDisplayName } from "@/lib/format";
import type { Competition, CompetitionDetail, Season } from "@/lib/types";

export interface MatchFiltersProps {
  /**
   * Competitions with synced matches, fetched server-side by the parent Server Component
   * from `GET /competitions?hasMatches=true&pageSize=50` (see matches/page.tsx) — small,
   * static-ish list, same reasoning as CompetitionFilters' country list.
   */
  competitions: Competition[];
}

export function MatchFilters({ competitions }: MatchFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const competitionId = searchParams.get("competitionId") ?? "";
  const seasonId = searchParams.get("seasonId") ?? "";

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loadingSeasons, setLoadingSeasons] = useState(false);

  // Seasons are scoped to a single competition, so they only make sense — and can only be
  // fetched — once a competition is selected. This is genuinely dynamic, user-driven data
  // (not known at request time), which is exactly what apiGetClient is for.
  useEffect(() => {
    // Nothing to fetch without a competition — `seasonOptions` below already renders as
    // empty in that case, so there's no need for a synchronous `setSeasons([])` here (the
    // repo's lint config flags synchronous setState calls in an effect body as an
    // anti-pattern, react-hooks/set-state-in-effect).
    if (!competitionId) return;
    // AbortController, not just a `cancelled` flag — a flag only skips the stale setState, it
    // doesn't stop the request itself, so StrictMode's dev-only double-effect still fired 2 real
    // network calls per competition change.
    const controller = new AbortController();

    (async () => {
      setLoadingSeasons(true);
      try {
        const detail = await apiGetClient<CompetitionDetail>(`/competitions/${competitionId}`, undefined, {
          signal: controller.signal,
        });
        setSeasons(detail.seasons);
        setLoadingSeasons(false);
      } catch {
        if (controller.signal.aborted) return;
        setSeasons([]);
        setLoadingSeasons(false);
      }
    })();

    return () => controller.abort();
  }, [competitionId]);

  // Don't render stale/in-flight season options: none without a competition selected, and
  // none while a fetch for the current competition is still in flight (avoids briefly
  // showing the previous competition's seasons before the new fetch resolves).
  const seasonOptions = competitionId && !loadingSeasons ? seasons : [];

  function updateParams(next: { competitionId?: string; seasonId?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.competitionId !== undefined) {
      if (next.competitionId) params.set("competitionId", next.competitionId);
      else params.delete("competitionId");
      // A different competition invalidates whatever season was previously selected.
      params.delete("seasonId");
    }
    if (next.seasonId !== undefined) {
      if (next.seasonId) params.set("seasonId", next.seasonId);
      else params.delete("seasonId");
    }
    // Filters changed — results shift, so page 1 is the only page guaranteed to make sense.
    params.delete("page");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <select
        value={competitionId}
        onChange={(event) => updateParams({ competitionId: event.target.value })}
        className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        {competitions.map((competition) => (
          <option key={competition.id} value={competition.id}>
            {competitionDisplayName(competition)}
          </option>
        ))}
      </select>

      <select
        value={seasonId}
        onChange={(event) => updateParams({ seasonId: event.target.value })}
        disabled={!competitionId || loadingSeasons}
        className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        {seasonOptions.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
          </option>
        ))}
      </select>
    </div>
  );
}
