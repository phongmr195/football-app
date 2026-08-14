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
import type { Standing } from "@/lib/types";

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
  { key: "played", label: "ST" },
  { key: "win", label: "T" },
  { key: "draw", label: "H" },
  { key: "loss", label: "B" },
  { key: "gf", label: "BT" },
  { key: "ga", label: "BB" },
  { key: "gd", label: "HS" },
  { key: "points", label: "Điểm" },
];

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

  const standings = seasonId ? await getStandings(seasonId) : [];

  return (
    <Container size="md" className="py-10">
      <BackButton />
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Bảng xếp hạng
      </h1>

      <StandingsFilters competitions={filterableCompetitions} />

      {standings.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có dữ liệu bảng xếp hạng cho mùa giải này.
        </Card>
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-3 py-3 font-medium">#</th>
                <th className="px-3 py-3 font-medium">Đội</th>
                {columns.map((col) => (
                  <th key={col.key} className="px-3 py-3 text-center font-medium">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
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
                      <span className="text-zinc-900 dark:text-zinc-50">
                        {row.team.name}
                      </span>
                    </Link>
                  </td>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={
                        col.key === "points"
                          ? "px-3 py-2 text-center font-semibold text-zinc-900 dark:text-zinc-50"
                          : "px-3 py-2 text-center text-zinc-600 dark:text-zinc-400"
                      }
                    >
                      {row[col.key] as number}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Container>
  );
}
