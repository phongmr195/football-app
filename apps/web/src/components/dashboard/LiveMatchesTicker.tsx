"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveMatches } from "@/lib/use-live-match";

/**
 * Home dashboard block — summary strip of everything currently LIVE/HALFTIME across every
 * competition, backed by `useLiveMatches()` (plain 10s REST polling of the already-cached
 * GET /matches/live, see lib/use-live-match.ts's doc comment for why this isn't a WebSocket
 * subscription like the match-detail page). Renders nothing once loaded with an empty list —
 * "no live matches right now" is the common case and doesn't deserve a permanent empty-state
 * card taking up space on the dashboard, mirroring LiveMatchPanel's same convention.
 */
export function LiveMatchesTicker() {
  const { data: matches, isLoading } = useLiveMatches();

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-64 shrink-0 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!matches || matches.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Đang diễn ra</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {matches.map((match) => (
          <Link key={match.id} href={`/matches/${match.id}`} className="shrink-0">
            <Card className="w-64 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
              <CardContent className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between">
                  <Badge className="bg-red-500 text-white">
                    {match.liveState?.minute != null ? `${match.liveState.minute}'` : "LIVE"}
                  </Badge>
                  <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {match.competition.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Avatar size="sm">
                      <AvatarImage src={match.homeTeam.logoUrl ?? undefined} alt={match.homeTeam.name} />
                      <AvatarFallback>{match.homeTeam.name.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm text-zinc-900 dark:text-zinc-50">
                      {match.homeTeam.name}
                    </span>
                  </div>
                  <span className="shrink-0 font-semibold text-zinc-900 dark:text-zinc-50">
                    {match.liveState?.homeScore ?? match.homeScore ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Avatar size="sm">
                      <AvatarImage src={match.awayTeam.logoUrl ?? undefined} alt={match.awayTeam.name} />
                      <AvatarFallback>{match.awayTeam.name.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm text-zinc-900 dark:text-zinc-50">
                      {match.awayTeam.name}
                    </span>
                  </div>
                  <span className="shrink-0 font-semibold text-zinc-900 dark:text-zinc-50">
                    {match.liveState?.awayScore ?? match.awayScore ?? 0}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
