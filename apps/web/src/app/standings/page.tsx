import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Container, cn } from "@football-app/ui";
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
import type {
  CleanSheetEntry,
  CompetitionDetail,
  RecentFormEntry,
  Standing,
  TopAssistEntry,
  TopScorerEntry,
} from "@/lib/types";

// Standings can shift after each matchday — shorter ISR window than the mostly-static
// competition catalog pages.
export const revalidate = 300;

async function getStandings(seasonId: string) {
  const { items } = await apiGet<{ items: Standing[] }>("/standings", { seasonId });
  return items;
}

async function getTopScorers(seasonId: string) {
  const { items } = await apiGet<{ items: TopScorerEntry[] }>("/standings/top-scorers", { seasonId });
  return items;
}

async function getTopAssists(seasonId: string) {
  const { items } = await apiGet<{ items: TopAssistEntry[] }>("/standings/top-assists", { seasonId });
  return items;
}

async function getCleanSheets(seasonId: string) {
  const { items } = await apiGet<{ items: CleanSheetEntry[] }>("/standings/clean-sheets", { seasonId });
  return items;
}

const TABS = [
  { key: "table", label: "Bảng xếp hạng" },
  { key: "scorers", label: "Vua phá lưới" },
  { key: "assists", label: "Kiến tạo" },
  { key: "clean-sheets", label: "Sạch lưới" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function buildHref(params: { competitionId?: string; seasonId?: string; tab?: TabKey }): string {
  const searchParams = new URLSearchParams();
  if (params.competitionId) searchParams.set("competitionId", params.competitionId);
  if (params.seasonId) searchParams.set("seasonId", params.seasonId);
  if (params.tab && params.tab !== "table") searchParams.set("tab", params.tab);
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
  searchParams: Promise<{ competitionId?: string; seasonId?: string; tab?: string }>;
}) {
  const {
    competitionId: competitionIdParam,
    seasonId: seasonIdParam,
    tab: tabParam,
  } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "table";

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

  if (competitionId !== competitionIdParam || seasonId !== seasonIdParam || tab !== (tabParam ?? "table")) {
    redirect(buildHref({ competitionId, seasonId, tab }));
  }

  // Chỉ fetch dữ liệu của tab đang xem — 4 tab dùng 4 endpoint riêng (xem
  // apps/api/src/routes/standings.ts), không cần tải cả 4 khi chỉ hiện 1.
  const [standings, topScorers, topAssists, cleanSheets, competition] = await Promise.all([
    seasonId && tab === "table" ? getStandings(seasonId) : Promise.resolve([]),
    seasonId && tab === "scorers" ? getTopScorers(seasonId) : Promise.resolve([]),
    seasonId && tab === "assists" ? getTopAssists(seasonId) : Promise.resolve([]),
    seasonId && tab === "clean-sheets" ? getCleanSheets(seasonId) : Promise.resolve([]),
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

      {/* Plain <Link>, không cần "use client" — chỉ đổi query param rồi Server Component render
          lại theo tab tương ứng, giống StandingsFilters đổi competitionId/seasonId. */}
      <nav className="mb-6 flex items-center gap-1 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={buildHref({ competitionId, seasonId, tab: t.key })}
            className={cn(
              "rounded-full px-3 py-1.5 transition-colors",
              tab === t.key
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "scorers" &&
        (topScorers.length === 0 ? (
          <Card className="text-sm text-zinc-500 dark:text-zinc-400">
            Chưa có dữ liệu vua phá lưới cho mùa giải này.
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {topScorers.map((entry) => (
              <li key={entry.id}>
                <Card padding="sm" className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-semibold text-zinc-500 dark:text-zinc-400">
                      {entry.rank}
                    </span>
                    {entry.player.team?.logoUrl ? (
                      <Image
                        src={entry.player.team.logoUrl}
                        alt={entry.player.team.name}
                        width={24}
                        height={24}
                        className="h-6 w-6 object-contain"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded bg-zinc-100 dark:bg-zinc-800" />
                    )}
                    <div className="flex flex-col">
                      <Link href={`/players/${entry.player.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                        {entry.player.name}
                      </Link>
                      {entry.player.team ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{entry.player.team.name}</span>
                      ) : null}
                    </div>
                  </div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{entry.goals} bàn</span>
                </Card>
              </li>
            ))}
          </ul>
        ))}

      {tab === "assists" &&
        (topAssists.length === 0 ? (
          <Card className="text-sm text-zinc-500 dark:text-zinc-400">
            Chưa có dữ liệu kiến tạo cho mùa giải này.
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {topAssists.map((entry) => (
              <li key={entry.id}>
                <Card padding="sm" className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-semibold text-zinc-500 dark:text-zinc-400">
                      {entry.rank}
                    </span>
                    {entry.player.team?.logoUrl ? (
                      <Image
                        src={entry.player.team.logoUrl}
                        alt={entry.player.team.name}
                        width={24}
                        height={24}
                        className="h-6 w-6 object-contain"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded bg-zinc-100 dark:bg-zinc-800" />
                    )}
                    <div className="flex flex-col">
                      <Link href={`/players/${entry.player.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                        {entry.player.name}
                      </Link>
                      {entry.player.team ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{entry.player.team.name}</span>
                      ) : null}
                    </div>
                  </div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{entry.assists} kiến tạo</span>
                </Card>
              </li>
            ))}
          </ul>
        ))}

      {tab === "clean-sheets" &&
        (cleanSheets.length === 0 ? (
          <Card className="text-sm text-zinc-500 dark:text-zinc-400">
            Chưa có dữ liệu sạch lưới cho mùa giải này.
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {cleanSheets.map((entry) => (
              <li key={entry.id}>
                <Card padding="sm" className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-semibold text-zinc-500 dark:text-zinc-400">
                      {entry.rank}
                    </span>
                    {entry.team.logoUrl ? (
                      <Image
                        src={entry.team.logoUrl}
                        alt={entry.team.name}
                        width={24}
                        height={24}
                        className="h-6 w-6 object-contain"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded bg-zinc-100 dark:bg-zinc-800" />
                    )}
                    <Link href={`/teams/${entry.team.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {entry.team.name}
                    </Link>
                  </div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{entry.count} trận</span>
                </Card>
              </li>
            ))}
          </ul>
        ))}

      {tab === "table" && standings.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có dữ liệu bảng xếp hạng cho mùa giải này.
        </Card>
      ) : tab === "table" ? (
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
      ) : null}
    </Container>
  );
}
