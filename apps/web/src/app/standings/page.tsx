import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Container } from "@football-app/ui";
import { apiGet } from "@/lib/api-client";
import { BackButton } from "@/components/BackButton";
import { StandingsFilters } from "@/components/StandingsFilters";
import {
  getFilterableCompetitions,
  pickDefaultCompetition,
  pickDefaultSeasonId,
} from "@/lib/default-selection";
import {
  competitionDisplayName,
  formatSeasonRange,
  matchResultMeta,
} from "@/lib/format";
import type { CompetitionDetail, RecentFormEntry, Standing } from "@/lib/types";

// Standings can shift after each matchday — shorter ISR window than the mostly-static
// competition catalog pages.
export const revalidate = 300;

async function getStandings(seasonId: string) {
  const { items } = await apiGet<{ items: Standing[] }>("/standings", { seasonId });
  return items;
}

function buildHref(params: { competitionId?: string; seasonId?: string }): string {
  const searchParams = new URLSearchParams();
  if (params.competitionId) searchParams.set("competitionId", params.competitionId);
  if (params.seasonId) searchParams.set("seasonId", params.seasonId);
  const query = searchParams.toString();
  return query ? `/standings?${query}` : "/standings";
}

const columns: { key: keyof Standing; label: string }[] = [
  { key: "played", label: "Trận" },
  { key: "win", label: "Thắng" },
  { key: "draw", label: "Hòa" },
  { key: "loss", label: "Thua" },
  { key: "gf", label: "Bàn thắng" },
  { key: "ga", label: "Bàn thua" },
  { key: "gd", label: "Hiệu số" },
];

/** "{điểm ghi được}-{điểm đối thủ}" của trận gần nhất, theo góc nhìn của chính đội đó — vd
 * đội thắng 2-1 dù đá sân khách 1-2 vẫn hiện "2-1", không phải tỉ số sân nhà-sân khách thô. */
function latestScoreLabel(recentForm: RecentFormEntry[]): string | null {
  const latest = recentForm[recentForm.length - 1];
  if (!latest) return null;
  const teamScore = latest.isHome ? latest.homeScore : latest.awayScore;
  const opponentScore = latest.isHome ? latest.awayScore : latest.homeScore;
  return `${teamScore}-${opponentScore}`;
}

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ competitionId?: string; seasonId?: string }>;
}) {
  const {
    competitionId: competitionIdParam,
    seasonId: seasonIdParam,
  } = await searchParams;

  const filterableCompetitions = await getFilterableCompetitions();

  // Lần đầu vào trang (chưa chọn competitionId/seasonId) — mặc định chọn 1 giải + mùa gần
  // nhất, cùng logic với /matches (xem lib/default-selection.ts). Resolve xong thì redirect 1
  // lần để URL phản ánh đúng giá trị đang áp dụng (client StandingsFilters đọc state từ URL
  // qua useSearchParams, không nhận prop riêng cho default).
  let competitionId = competitionIdParam;
  let seasonId = seasonIdParam;

  if (!competitionId) {
    competitionId = pickDefaultCompetition(filterableCompetitions)?.id;
  }
  if (competitionId && !seasonId) {
    seasonId = await pickDefaultSeasonId(competitionId);
  }

  if (competitionId !== competitionIdParam || seasonId !== seasonIdParam) {
    redirect(buildHref({ competitionId, seasonId }));
  }

  const [standings, competition] = await Promise.all([
    seasonId ? getStandings(seasonId) : Promise.resolve([]),
    competitionId ? apiGet<CompetitionDetail>(`/competitions/${competitionId}`) : Promise.resolve(null),
  ]);
  const season = competition?.seasons.find((s) => s.id === seasonId);

  return (
    <Container size="lg" className="py-10">
      <BackButton />

      {competition && season ? (
        <h1 className="mb-6 text-2xl font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
          Bảng xếp hạng {competitionDisplayName(competition)}{" "}
          {formatSeasonRange(season.startDate, season.endDate)}
        </h1>
      ) : (
        <h1 className="mb-6 text-2xl font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
          Bảng xếp hạng
        </h1>
      )}

      <StandingsFilters competitions={filterableCompetitions} />

      {standings.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có dữ liệu bảng xếp hạng cho mùa giải này.
        </Card>
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                <th className="px-3 py-3 font-medium">TT</th>
                <th className="px-3 py-3 font-medium">Đội</th>
                <th className="px-3 py-3 text-center font-medium">Kết quả mới nhất</th>
                {columns.map((col) => (
                  <th key={col.key} className="px-3 py-3 text-center font-medium">
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-3 text-center font-medium">Điểm</th>
                <th className="px-3 py-3 font-medium">Kết quả 5 trận gần nhất</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => {
                const latestScore = latestScoreLabel(row.recentForm);
                // Mới nhất -> cũ nhất khi hiển thị (trái sang phải), ngược với thứ tự API trả
                // về (cũ -> mới) — xem apps/api/src/routes/standings.ts.
                const formNewestFirst = [...row.recentForm].reverse();

                return (
                  <tr
                    key={row.id}
                    className={
                      row.position === 1
                        ? "border-b border-zinc-100 border-l-4 border-l-emerald-500 last:border-0 dark:border-zinc-900"
                        : "border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                    }
                  >
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                      {row.position}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/teams/${row.team.id}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        {row.team.logoUrl ? (
                          <Image
                            src={row.team.logoUrl}
                            alt={row.team.name}
                            width={20}
                            height={20}
                            className="h-5 w-5 object-contain"
                          />
                        ) : (
                          <div className="h-5 w-5 rounded bg-zinc-100 dark:bg-zinc-800" />
                        )}
                        <span className="whitespace-nowrap text-zinc-900 dark:text-zinc-50">
                          {row.team.name}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {latestScore ? (
                        <span className="inline-block rounded-full border border-zinc-200 px-3 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
                          {latestScore}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>
                      )}
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className="px-3 py-2 text-center text-zinc-600 dark:text-zinc-400"
                      >
                        {row[col.key] as number}
                      </td>
                    ))}
                    <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50 text-center">
                      {row.points}
                    </td>
                    <td className="px-3 py-2">
                      {formNewestFirst.length === 0 ? (
                        <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          {formNewestFirst.map((entry) => {
                            const { symbol, className } = matchResultMeta(entry.result);
                            return (
                              <span
                                key={entry.matchId}
                                title={`${entry.isHome ? "Sân nhà" : "Sân khách"} vs ${entry.opponent.name}: ${entry.homeScore}-${entry.awayScore}`}
                                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${className}`}
                              >
                                {symbol}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Container>
  );
}
