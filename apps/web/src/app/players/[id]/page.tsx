import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, Cake, Ruler, Shield, Sparkles } from "lucide-react";
import { Badge, Card, Container } from "@football-app/ui";
import { ApiError, apiGet } from "@/lib/api-client";
import { BackButton } from "@/components/BackButton";
import { FavoriteButton } from "@/components/FavoriteButton";
import { formatDate, playerPositionMeta } from "@/lib/format";
import type { PlayerDetail, PlayerStatistics } from "@/lib/types";

// Player bio (name/position/nationality/team) is close to static — same ISR window as
// the team detail page.
export const revalidate = 1800;

async function getPlayer(id: string) {
  try {
    return await apiGet<PlayerDetail>(`/players/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Không truyền seasonId — trả về mùa giải gần nhất có dữ liệu (xem
// apps/api/src/routes/statistics.ts). 404 nghĩa là cầu thủ này chưa từng lọt top scorers/assists
// của football-data.org LẪN chưa lọt top-50 bất kỳ category nào của Sofascore's season
// top-players (2 nguồn duy nhất hiện có cho PlayerStatistics, xem sync-catalog.ts's
// syncTopScorers() + apps/sync-worker/src/ingest-player-season-stats.ts) — ẩn card, không coi là
// lỗi. `minutesPlayed` vẫn luôn 0 (không nguồn nào hiện có trả field này) — KHÔNG hiện trong UI.
// `rating`/`yellowCards`/`redCards`/... (2026-08-20) chỉ Sofascore điền được, hiện có điều kiện khi
// `rating !== null` (xem PlayerStatistics's doc comment ở lib/types.ts).
async function getPlayerStatistics(id: string) {
  try {
    return await apiGet<PlayerStatistics>(`/statistics/players/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const player = await getPlayer(id);

  if (!player) notFound();

  const statistics = await getPlayerStatistics(id);

  const { label, variant } = playerPositionMeta(player.position);

  return (
    <Container size="md" className="py-10">
      <BackButton />
      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-20 w-20 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {player.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={variant}>{label}</Badge>
            {player.nationality ? (
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {player.nationality}
              </span>
            ) : null}
          </div>
        </div>
        <div className="sm:ml-auto">
          <FavoriteButton kind="player" item={player} />
        </div>
      </Card>

      <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card padding="sm" className="flex flex-col gap-1">
          <dt className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            <Cake className="h-4 w-4" aria-hidden="true" />
            Ngày sinh
          </dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {player.dateOfBirth ? formatDate(player.dateOfBirth) : "Chưa rõ"}
          </dd>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <dt className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            <Ruler className="h-4 w-4" aria-hidden="true" />
            Chiều cao
          </dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {player.heightCm ? `${player.heightCm} cm` : "Chưa rõ"}
          </dd>
        </Card>
      </dl>

      {statistics ? (
        <Card className="mt-8 flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Thống kê mùa giải gần nhất
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Ra sân", value: statistics.appearances },
              { label: "Bàn thắng", value: statistics.goals },
              { label: "Kiến tạo", value: statistics.assists },
              // Chỉ Sofascore điền được (xem doc comment getPlayerStatistics ở trên) — hiện thêm
              // khi có, không thay thế 3 field cơ bản ở trên (luôn có nếu card này hiện ra).
              ...(statistics.rating !== null
                ? [
                    { label: "Rating TB", value: statistics.rating.toFixed(1) },
                    { label: "Thẻ vàng", value: statistics.yellowCards },
                    { label: "Thẻ đỏ", value: statistics.redCards },
                  ]
                : []),
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col items-center gap-1">
                <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {stat.value}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{stat.label}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {player.aiSummary ? (
        <Card className="mt-6 flex flex-col gap-2 py-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Tóm tắt cầu thủ
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{player.aiSummary.content}</p>
        </Card>
      ) : null}

      <h2 className="mt-8 mb-4 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        <Shield className="h-5 w-5" aria-hidden="true" />
        Câu lạc bộ
      </h2>

      {player.team ? (
        <Link href={`/teams/${player.team.id}`}>
          <Card className="flex items-center gap-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
            {player.team.logoUrl ? (
              <Image
                src={player.team.logoUrl}
                alt={player.team.name}
                width={40}
                height={40}
                className="h-10 w-10 object-contain"
              />
            ) : (
              <div className="h-10 w-10 rounded bg-zinc-100 dark:bg-zinc-800" />
            )}
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {player.team.name}
            </span>
          </Card>
        </Link>
      ) : (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Cầu thủ hiện không thuộc đội nào.
        </Card>
      )}
    </Container>
  );
}
