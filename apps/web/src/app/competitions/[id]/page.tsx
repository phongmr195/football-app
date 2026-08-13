import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Container } from "@football-app/ui";
import { ApiError, apiGet } from "@/lib/api-client";
import { competitionTypeMeta } from "@/lib/format";
import type { CompetitionDetail } from "@/lib/types";

// Competition + season list rarely changes — long ISR window is fine.
export const revalidate = 3600;

async function getCompetition(id: string) {
  try {
    return await apiGet<CompetitionDetail>(`/competitions/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

function formatSeasonRange(startDate: string, endDate: string): string {
  const start = new Date(startDate).getFullYear();
  const end = new Date(endDate).getFullYear();
  return start === end ? `${start}` : `${start}/${end}`;
}

export default async function CompetitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const competition = await getCompetition(id);

  if (!competition) notFound();

  const { label, variant } = competitionTypeMeta(competition.type);
  const seasons = [...competition.seasons].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
  );

  return (
    <Container size="md" className="py-10">
      <Card className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        {competition.logoUrl ? (
          <Image
            src={competition.logoUrl}
            alt={competition.name}
            width={64}
            height={64}
            className="h-16 w-16 object-contain"
          />
        ) : (
          <div className="h-16 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
        )}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {competition.name}
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant={variant}>{label}</Badge>
            {competition.countryCode ? (
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {competition.countryCode}
              </span>
            ) : null}
          </div>
          <Link
            href={`/matches?competitionId=${competition.id}`}
            className="text-sm text-zinc-700 hover:underline dark:text-zinc-300"
          >
            Xem lịch thi đấu &rarr;
          </Link>
        </div>
      </Card>

      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Mùa giải
      </h2>

      {seasons.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có dữ liệu mùa giải cho giải đấu này.
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {seasons.map((season) => (
            <li key={season.id}>
              <Link href={`/standings/${season.id}`}>
                <Card
                  padding="sm"
                  className="flex items-center justify-between transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    Mùa {season.name} ({formatSeasonRange(season.startDate, season.endDate)})
                  </span>
                  <div className="flex items-center gap-2">
                    {season.isCurrent ? <Badge variant="success">Đang diễn ra</Badge> : null}
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      Xem bảng xếp hạng &rarr;
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
