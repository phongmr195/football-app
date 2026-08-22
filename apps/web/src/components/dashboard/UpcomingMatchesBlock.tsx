import Image from "next/image";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { MatchOddsPreview } from "@/components/match/MatchOddsPreview";
import { competitionDisplayName, formatKickoffAt } from "@/lib/format";
import type { Match } from "@/lib/types";

export interface UpcomingMatchesBlockProps {
  matches: Match[];
}

/** Server-rendered — data fetched once in app/page.tsx (default competition/season, same helper
 * `/matches` and `/standings` already use), no client fetch needed for this generic block. */
export function UpcomingMatchesBlock({ matches }: UpcomingMatchesBlockProps) {
  if (matches.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có lịch thi đấu sắp tới.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {matches.map((match) => (
        <Card key={match.id} className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
          <Link href={`/matches/${match.id}`} className="block">
            <CardContent className="flex items-center gap-3 px-4 py-3">
              <span className="w-24 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                {formatKickoffAt(match.kickoffAt)}
              </span>
              <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm">
                <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                  <span className="truncate text-zinc-900 dark:text-zinc-50">{match.homeTeam.name}</span>
                  {match.homeTeam.logoUrl ? (
                    <Image src={match.homeTeam.logoUrl} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-600">vs</span>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {match.awayTeam.logoUrl ? (
                    <Image src={match.awayTeam.logoUrl} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
                  ) : null}
                  <span className="truncate text-zinc-900 dark:text-zinc-50">{match.awayTeam.name}</span>
                </div>
              </div>
              <span className="hidden shrink-0 truncate text-xs text-zinc-400 dark:text-zinc-600 sm:block">
                {competitionDisplayName(match.competition)}
              </span>
            </CardContent>
          </Link>
          {match.status === "SCHEDULED" && match.primaryOdds ? (
            <div className="px-4 pb-3">
              <MatchOddsPreview matchId={match.id} primaryOdds={match.primaryOdds} />
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
