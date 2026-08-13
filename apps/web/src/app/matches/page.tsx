import Image from "next/image";
import Link from "next/link";
import { Badge, Card, Container } from "@football-app/ui";
import { apiGet, type ApiListResponse } from "@/lib/api-client";
import { formatKickoffAt, matchStatusMeta } from "@/lib/format";
import type { Match, MatchStatus } from "@/lib/types";

// Matches list — historical + scheduled fixtures. No live-polling here (Phase 2, not built
// yet per ROADMAP) — a moderate ISR window keeps this reasonably fresh without hammering
// apps/api on every request.
export const revalidate = 1800;

const STATUS_VALUES: MatchStatus[] = [
  "SCHEDULED",
  "LIVE",
  "HALFTIME",
  "FINISHED",
  "POSTPONED",
  "CANCELLED",
];

async function getMatches(
  page: number,
  competitionId?: string,
  status?: MatchStatus
) {
  return apiGet<ApiListResponse<Match>>("/matches", {
    page,
    competitionId,
    status,
  });
}

function buildHref(params: {
  page?: number;
  competitionId?: string;
  status?: MatchStatus;
}): string {
  const searchParams = new URLSearchParams();
  if (params.competitionId) searchParams.set("competitionId", params.competitionId);
  if (params.status) searchParams.set("status", params.status);
  if (params.page && params.page > 1) searchParams.set("page", String(params.page));
  const query = searchParams.toString();
  return query ? `/matches?${query}` : "/matches";
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; competitionId?: string; status?: string }>;
}) {
  const {
    page: pageParam,
    competitionId,
    status: statusParam,
  } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const status = STATUS_VALUES.includes(statusParam as MatchStatus)
    ? (statusParam as MatchStatus)
    : undefined;

  const { items, pageSize, total } = await getMatches(page, competitionId, status);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Container size="lg" className="py-10">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Lịch thi đấu
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {total.toLocaleString("vi-VN")} trận &middot; Trang {page}/{totalPages}
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={buildHref({ competitionId })}
          className={
            !status
              ? "rounded-full bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-50 dark:text-zinc-900"
              : "rounded-full border border-zinc-200 px-3 py-1 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700"
          }
        >
          Tất cả
        </Link>
        {STATUS_VALUES.map((value) => {
          const { label } = matchStatusMeta(value);
          const isActive = status === value;
          return (
            <Link
              key={value}
              href={buildHref({ competitionId, status: value })}
              className={
                isActive
                  ? "rounded-full bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "rounded-full border border-zinc-200 px-3 py-1 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700"
              }
            >
              {label}
            </Link>
          );
        })}
      </div>

      {items.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Không có trận đấu nào.
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((match) => {
            const { label, variant } = matchStatusMeta(match.status);
            const hasScore = match.homeScore !== null && match.awayScore !== null;
            return (
              <li key={match.id}>
                {/* Note: team name/logo below link to /teams/[id], so the match link can't
                    wrap the whole card (that would nest <a> inside <a>). Instead the
                    competition/kickoff row, score, and status badge link to the match. */}
                <Card className="flex flex-col gap-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                  <Link
                    href={`/matches/${match.id}`}
                    className="flex items-center justify-between text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                  >
                    <div className="flex items-center gap-2">
                      {match.competition.logoUrl ? (
                        <Image
                          src={match.competition.logoUrl}
                          alt={match.competition.name}
                          width={16}
                          height={16}
                          className="h-4 w-4 object-contain"
                        />
                      ) : null}
                      <span>{match.competition.name}</span>
                    </div>
                    <span>{formatKickoffAt(match.kickoffAt)}</span>
                  </Link>

                  <div className="flex items-center justify-between gap-4">
                    <Link
                      href={`/teams/${match.homeTeam.id}`}
                      className="flex flex-1 items-center gap-2 hover:underline"
                    >
                      {match.homeTeam.logoUrl ? (
                        <Image
                          src={match.homeTeam.logoUrl}
                          alt={match.homeTeam.name}
                          width={24}
                          height={24}
                          className="h-6 w-6 object-contain"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded bg-zinc-100 dark:bg-zinc-800" />
                      )}
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {match.homeTeam.name}
                      </span>
                    </Link>

                    <Link
                      href={`/matches/${match.id}`}
                      className="text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-50"
                    >
                      {hasScore ? `${match.homeScore} - ${match.awayScore}` : "vs"}
                    </Link>

                    <Link
                      href={`/teams/${match.awayTeam.id}`}
                      className="flex flex-1 items-center justify-end gap-2 text-right hover:underline"
                    >
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {match.awayTeam.name}
                      </span>
                      {match.awayTeam.logoUrl ? (
                        <Image
                          src={match.awayTeam.logoUrl}
                          alt={match.awayTeam.name}
                          width={24}
                          height={24}
                          className="h-6 w-6 object-contain"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded bg-zinc-100 dark:bg-zinc-800" />
                      )}
                    </Link>
                  </div>

                  <Link href={`/matches/${match.id}`} className="self-start">
                    <Badge variant={variant}>{label}</Badge>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="mt-8 flex items-center justify-center gap-4 text-sm">
        {page > 1 ? (
          <Link
            href={buildHref({ page: page - 1, competitionId, status })}
            className="text-zinc-700 hover:underline dark:text-zinc-300"
          >
            &larr; Trang trước
          </Link>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">&larr; Trang trước</span>
        )}
        <span className="text-zinc-500 dark:text-zinc-400">
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={buildHref({ page: page + 1, competitionId, status })}
            className="text-zinc-700 hover:underline dark:text-zinc-300"
          >
            Trang sau &rarr;
          </Link>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">Trang sau &rarr;</span>
        )}
      </nav>
    </Container>
  );
}
