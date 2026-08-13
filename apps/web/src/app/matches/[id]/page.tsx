import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Container } from "@football-app/ui";
import { ApiError, apiGet } from "@/lib/api-client";
import { formatKickoffAt, matchStatusMeta } from "@/lib/format";
import type { MatchDetail } from "@/lib/types";

// A single match's data (score/status) is essentially frozen once FINISHED, and there's no
// live-polling on this page yet (Phase 2 real-time not built) — same ISR window as the list.
export const revalidate = 1800;

async function getMatch(id: string) {
  try {
    return await apiGet<MatchDetail>(`/matches/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const match = await getMatch(id);

  if (!match) notFound();

  const { label, variant } = matchStatusMeta(match.status);
  const hasScore = match.homeScore !== null && match.awayScore !== null;

  return (
    <Container size="md" className="py-10">
      <Link
        href={`/competitions/${match.competition.id}`}
        className="mb-6 flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {match.competition.logoUrl ? (
          <Image
            src={match.competition.logoUrl}
            alt={match.competition.name}
            width={20}
            height={20}
            className="h-5 w-5 object-contain"
          />
        ) : null}
        <span>{match.competition.name}</span>
      </Link>

      <Card className="flex flex-col items-center gap-6 py-8">
        <div className="flex items-center gap-2">
          <Badge variant={variant}>{label}</Badge>
        </div>

        <div className="flex w-full items-center justify-around gap-4">
          <div className="flex flex-1 flex-col items-center gap-3 text-center">
            {match.homeTeam.logoUrl ? (
              <Image
                src={match.homeTeam.logoUrl}
                alt={match.homeTeam.name}
                width={64}
                height={64}
                className="h-16 w-16 object-contain"
              />
            ) : (
              <div className="h-16 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
            )}
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {match.homeTeam.name}
            </span>
          </div>

          <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            {hasScore ? `${match.homeScore} - ${match.awayScore}` : "vs"}
          </div>

          <div className="flex flex-1 flex-col items-center gap-3 text-center">
            {match.awayTeam.logoUrl ? (
              <Image
                src={match.awayTeam.logoUrl}
                alt={match.awayTeam.name}
                width={64}
                height={64}
                className="h-16 w-16 object-contain"
              />
            ) : (
              <div className="h-16 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
            )}
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {match.awayTeam.name}
            </span>
          </div>
        </div>

        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {formatKickoffAt(match.kickoffAt)}
        </p>
      </Card>
    </Container>
  );
}
