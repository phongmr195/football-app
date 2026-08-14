import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Container, Pagination } from "@football-app/ui";
import { apiGet, type ApiListResponse } from "@/lib/api-client";
import { MatchFilters } from "@/components/MatchFilters";
import {
  getFilterableCompetitions,
  pickDefaultCompetition,
  pickDefaultSeasonId,
} from "@/lib/default-selection";
import { competitionDisplayName, formatKickoffAt, matchStatusMeta } from "@/lib/format";
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
  seasonId?: string,
  status?: MatchStatus
) {
  return apiGet<ApiListResponse<Match>>("/matches", {
    page,
    competitionId,
    seasonId,
    status,
  });
}

function buildHref(params: {
  page?: number;
  competitionId?: string;
  seasonId?: string;
  status?: MatchStatus;
}): string {
  const searchParams = new URLSearchParams();
  if (params.competitionId) searchParams.set("competitionId", params.competitionId);
  if (params.seasonId) searchParams.set("seasonId", params.seasonId);
  if (params.status) searchParams.set("status", params.status);
  if (params.page && params.page > 1) searchParams.set("page", String(params.page));
  const query = searchParams.toString();
  return query ? `/matches?${query}` : "/matches";
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    competitionId?: string;
    seasonId?: string;
    status?: string;
  }>;
}) {
  const {
    page: pageParam,
    competitionId: competitionIdParam,
    seasonId: seasonIdParam,
    status: statusParam,
  } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const status = STATUS_VALUES.includes(statusParam as MatchStatus)
    ? (statusParam as MatchStatus)
    : undefined;

  const filterableCompetitions = await getFilterableCompetitions();

  // Lần đầu vào trang (chưa chọn competitionId/seasonId) — mặc định chọn 1 giải + mùa gần
  // nhất thay vì hiện "Tất cả" (4000+ trận không lọc gì không phải trải nghiệm mặc định tốt).
  // Resolve xong thì redirect 1 lần để URL phản ánh đúng giá trị đang áp dụng (client
  // MatchFilters đọc state từ URL qua useSearchParams, không nhận prop riêng cho default).
  let competitionId = competitionIdParam;
  let seasonId = seasonIdParam;

  if (!competitionId) {
    competitionId = pickDefaultCompetition(filterableCompetitions)?.id;
  }
  if (competitionId && !seasonId) {
    seasonId = await pickDefaultSeasonId(competitionId);
  }

  if (competitionId !== competitionIdParam || seasonId !== seasonIdParam) {
    redirect(buildHref({ competitionId, seasonId, status }));
  }

  const { items, pageSize, total } = await getMatches(page, competitionId, seasonId, status);
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

      <MatchFilters competitions={filterableCompetitions} />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={buildHref({ competitionId, seasonId })}
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
              href={buildHref({ competitionId, seasonId, status: value })}
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
            const competitionName = competitionDisplayName(match.competition);
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
                          alt={competitionName}
                          width={16}
                          height={16}
                          className="h-4 w-4 object-contain"
                        />
                      ) : null}
                      <span>{competitionName}</span>
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

      <div className="mt-8">
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          buildHref={(targetPage) =>
            buildHref({ page: targetPage, competitionId, seasonId, status })
          }
        />
      </div>
    </Container>
  );
}
