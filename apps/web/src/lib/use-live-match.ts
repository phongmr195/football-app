/**
 * React Query hooks for Phase 2 Bước 1's live-match REST polling, backing
 * `components/LiveMatchPanel.tsx` (embedded, unconditionally, in `app/matches/[id]/page.tsx`).
 *
 * Follows the same pattern as `use-favorites.ts`: thin `useQuery` wrappers directly over
 * `apiGetClient` (no separate fetcher module — these two endpoints have exactly one consumer
 * each today, unlike favorites' shared list which needed its own module).
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGetClient } from "./api-client";
import type { LiveMatchState, MatchEvent } from "./types";

/**
 * Polls GET /matches/:id/live every 3s (paused while the tab is hidden, via React Query's
 * default `refetchIntervalInBackground: false`). A match with no `LiveMatchState` row yet
 * (never gone live, or sync-worker hasn't caught up) is a normal, expected 404 from apps/api —
 * resolved to `null` here instead of surfacing as a query error, so `LiveMatchPanel` can treat
 * "no live state" the same as "not currently live" without special-casing errors.
 */
export function useLiveMatch(matchId: string) {
  return useQuery({
    queryKey: ["match", matchId, "live"],
    queryFn: async (): Promise<LiveMatchState | null> => {
      try {
        return await apiGetClient<LiveMatchState>(`/matches/${matchId}/live`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });
}

export interface MatchEventsResponse {
  items: MatchEvent[];
  lastSeq: number;
}

/**
 * Polls GET /matches/:id/events?since_seq=sinceSeq every 3s while `enabled`. `sinceSeq` is part
 * of the query key on purpose: as `LiveMatchPanel` advances its local `seenSeq` cursor forward
 * (catch-up), each step is a distinct, cacheable fetch rather than one query key silently
 * changing what it means over time.
 */
export function useMatchEvents(matchId: string, sinceSeq: number, enabled: boolean) {
  return useQuery({
    queryKey: ["match", matchId, "events", sinceSeq],
    queryFn: () =>
      apiGetClient<MatchEventsResponse>(`/matches/${matchId}/events`, { since_seq: sinceSeq }),
    enabled,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });
}
