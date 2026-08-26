"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiGetClient } from "@/lib/api-client";
import { competitionDisplayName } from "@/lib/format";
import type { Competition, CompetitionDetail, Season } from "@/lib/types";

export interface StandingsFiltersProps {
  /**
   * Competitions with synced matches, fetched server-side by the parent Server Component
   * from `GET /competitions?hasMatches=true&provider=football-data&pageSize=50` (see
   * standings/page.tsx) — same lean, provider-scoped list used by MatchFilters, so the same
   * competition never shows up twice.
   */
  competitions: Competition[];
}

/**
 * Competition + season filter for /standings — same shape/behavior as MatchFilters (dependent
 * season dropdown fetched client-side once a competition is picked), kept as a separate
 * component rather than reused directly since /standings doesn't have a status filter and
 * navigates by replacing both params together rather than resetting a `page` param.
 */
export function StandingsFilters({ competitions }: StandingsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const competitionId = searchParams.get("competitionId") ?? "";
  const seasonId = searchParams.get("seasonId") ?? "";

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loadingSeasons, setLoadingSeasons] = useState(false);

  useEffect(() => {
    if (!competitionId) return;
    // AbortController, not just a `cancelled` flag — see MatchFilters.tsx for why.
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
        <option value="">
          {!competitionId
            ? "Chọn giải đấu trước"
            : loadingSeasons
              ? "Đang tải mùa giải..."
              : "Tất cả mùa giải"}
        </option>
        {seasonOptions.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
          </option>
        ))}
      </select>
    </div>
  );
}
