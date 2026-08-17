import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { competitionDisplayName } from "@/lib/format";
import type { Competition } from "@/lib/types";

export interface FeaturedCompetitionsBlockProps {
  competitions: Competition[];
}

/** Logo grid for quick browsing, no filters/search needed on the dashboard — that's what
 * `/competitions` (and the nav search box) are for. Server-rendered, same query
 * `getFilterableCompetitions()` already runs, just capped smaller for a grid. */
export function FeaturedCompetitionsBlock({ competitions }: FeaturedCompetitionsBlockProps) {
  if (competitions.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {competitions.map((competition) => {
        const displayName = competitionDisplayName(competition);
        return (
          <Link key={competition.id} href={`/competitions/${competition.id}`}>
            <Card className="flex flex-col items-center gap-2 px-2 py-4 text-center transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
              {competition.logoUrl ? (
                <Image
                  src={competition.logoUrl}
                  alt={displayName}
                  width={32}
                  height={32}
                  className="h-8 w-8 object-contain"
                />
              ) : (
                <div className="h-8 w-8 rounded bg-zinc-100 dark:bg-zinc-800" />
              )}
              <span className="line-clamp-2 text-xs text-zinc-700 dark:text-zinc-300">{displayName}</span>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
