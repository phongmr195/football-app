import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Container } from "@football-app/ui";
import { ApiError, apiGet } from "@/lib/api-client";
import { FavoriteButton } from "@/components/FavoriteButton";
import { formatDate, playerPositionMeta } from "@/lib/format";
import type { PlayerDetail } from "@/lib/types";

// Player bio (name/position/nationality/team) is close to static — same ISR window as
// the team detail page. Statistics (PlayerStatistics) are deliberately left out: the
// sync-worker does not populate that table yet (see apps/sync-worker/sync-catalog.ts),
// so there's no real data to show.
export const revalidate = 1800;

async function getPlayer(id: string) {
  try {
    return await apiGet<PlayerDetail>(`/players/${id}`);
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

  const { label, variant } = playerPositionMeta(player.position);

  return (
    <Container size="md" className="py-10">
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
          <FavoriteButton kind="player" id={player.id} />
        </div>
      </Card>

      <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card padding="sm" className="flex flex-col gap-1">
          <dt className="text-sm text-zinc-500 dark:text-zinc-400">Ngày sinh</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {player.dateOfBirth ? formatDate(player.dateOfBirth) : "Chưa rõ"}
          </dd>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <dt className="text-sm text-zinc-500 dark:text-zinc-400">Chiều cao</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {player.heightCm ? `${player.heightCm} cm` : "Chưa rõ"}
          </dd>
        </Card>
      </dl>

      <h2 className="mt-8 mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
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
