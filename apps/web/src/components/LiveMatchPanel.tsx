"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { Badge, Card } from "@football-app/ui";
import { formatMatchEventLabel, matchStatusMeta } from "@/lib/format";
import { useLiveMatch, useMatchEvents, type MatchEventsResponse } from "@/lib/use-live-match";
import type { MatchEvent } from "@/lib/types";

export interface LiveMatchPanelProps {
  matchId: string;
}

/**
 * Client island mounted UNCONDITIONALLY in `app/matches/[id]/page.tsx` — that page is ISR
 * (`revalidate = 1800`), so its server-rendered `match.status` can be up to 30 minutes stale and
 * must never be used to decide whether to show this panel (a match could go live well within
 * that window). Instead this component independently polls `GET /matches/:id/live` client-side
 * (see `lib/use-live-match.ts`) and renders nothing on its own whenever there's no live state yet
 * or the match isn't currently LIVE/HALFTIME.
 */
export function LiveMatchPanel({ matchId }: LiveMatchPanelProps) {
  const { data: liveState } = useLiveMatch(matchId);
  const [seenSeq, setSeenSeq] = useState(0);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  // Last eventsQuery.data reference already folded into `events`/`seenSeq` above — lets us tell
  // "a new page just arrived" apart from "still the same page, re-rendered for another reason".
  const [processedData, setProcessedData] = useState<MatchEventsResponse | undefined>(undefined);

  const isLive = liveState?.status === "LIVE" || liveState?.status === "HALFTIME";
  const eventsQuery = useMatchEvents(matchId, seenSeq, isLive);

  // Catch-up: append newly-arrived events and advance the cursor so the next poll asks for
  // "events after what I've already seen" instead of re-fetching the same page forever.
  //
  // Done directly during render (React's documented "adjusting state when a prop changes"
  // pattern, https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // rather than in a useEffect — eslint-plugin-react-hooks' set-state-in-effect rule flags
  // synchronous setState calls in effect bodies, and this is genuinely derived state (accumulated
  // from React Query's cache), not a subscription to an external system. React Query's default
  // structural sharing keeps `eventsQuery.data` referentially stable across polls that return
  // unchanged content, so this only re-runs when a page actually changes.
  if (eventsQuery.data && eventsQuery.data !== processedData) {
    const { items, lastSeq } = eventsQuery.data;
    setProcessedData(eventsQuery.data);
    if (items.length > 0) {
      setEvents((prev) => [...prev, ...items]);
    }
    if (lastSeq > seenSeq) {
      setSeenSeq(lastSeq);
    }
  }

  if (!isLive || !liveState) return null;

  const { label, variant } = matchStatusMeta(liveState.status);

  return (
    <Card className="mt-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <Badge variant={variant}>{label}</Badge>
        </span>
        {liveState.minute !== null ? (
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {liveState.minute}&apos;
          </span>
        ) : null}
      </div>

      <div className="text-center text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        {liveState.homeScore} - {liveState.awayScore}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          <Activity className="h-4 w-4" aria-hidden="true" />
          Diễn biến
        </h3>
        {events.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Chưa có diễn biến nào được ghi nhận.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200"
              >
                <span className="w-8 shrink-0 text-zinc-500 dark:text-zinc-400">
                  {event.minute}&apos;
                </span>
                <span>{formatMatchEventLabel(event)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
