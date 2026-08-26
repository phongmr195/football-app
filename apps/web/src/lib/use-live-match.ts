/**
 * React Query hooks for Phase 2's live-match updates, backing `components/LiveMatchPanel.tsx`
 * (embedded, unconditionally, in `app/matches/[id]/page.tsx`).
 *
 * Follows the same pattern as `use-favorites.ts`: thin `useQuery` wrappers directly over
 * `apiGetClient` (no separate fetcher module — these two endpoints have exactly one consumer
 * each today, unlike favorites' shared list which needed its own module).
 */
"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGetClient } from "./api-client";
import { subscribeToMatch } from "./realtime-client";
import type { LiveMatchState, MatchDetail, MatchEvent } from "./types";

/**
 * `GET /matches/:id/live` REST fetch (Bước 1) plus a Bước 2 WebSocket subscription
 * (`lib/realtime-client.ts`) that pushes `match.snapshot` updates straight into this query's
 * cache entry (`["match", matchId, "live"]`) as they arrive — the primary update mechanism now.
 * `refetchInterval` is a 45s safety-net poll in case the socket dies silently without firing
 * `onclose` (paused while the tab is hidden, via React Query's default
 * `refetchIntervalInBackground: false`). A match with no `LiveMatchState` row yet (never gone
 * live, or sync-worker hasn't caught up) is a normal, expected 404 from apps/api — resolved to
 * `null` here instead of surfacing as a query error, so `LiveMatchPanel` can treat "no live state"
 * the same as "not currently live" without special-casing errors.
 */
export function useLiveMatch(matchId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribeToMatch(matchId, queryClient);
  }, [matchId, queryClient]);

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
    refetchInterval: 45000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Summary ticker for the home dashboard (`components/dashboard/LiveMatchesTicker.tsx`) — plain
 * REST polling of `GET /matches/live` (already Redis-cached server-side, 5s TTL, see
 * apps/api/src/routes/matches.ts), NOT a WebSocket subscription like `useLiveMatch` above. A
 * home-page ticker just needs "is anything live right now, what's the score" at a glance; the
 * per-match WebSocket + event catch-up machinery is only worth its complexity on the match detail
 * page where a single match's minute-by-minute event feed actually matters.
 */
export function useLiveMatches() {
  return useQuery({
    queryKey: ["matches", "live"],
    queryFn: async () => {
      const { items } = await apiGetClient<{ items: MatchDetail[] }>("/matches/live");
      return items;
    },
    refetchInterval: 10000,
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
