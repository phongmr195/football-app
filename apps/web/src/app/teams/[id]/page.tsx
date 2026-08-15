import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Container } from "@football-app/ui";
import { ApiError, apiGet, type ApiListResponse } from "@/lib/api-client";
import { BackButton } from "@/components/BackButton";
import { FavoriteButton } from "@/components/FavoriteButton";
import { playerPositionMeta } from "@/lib/format";
import type { Player, TeamDetail } from "@/lib/types";

// Team bio (logo/name/founded/stadium) is close to static; the roster changes with
// transfers but not often enough to warrant a short ISR window — similar to the
// competition detail page.
export const revalidate = 1800;

async function getTeam(id: string) {
  try {
    return await apiGet<TeamDetail>(`/teams/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function getRoster(id: string, page: number) {
  return apiGet<ApiListResponse<Player>>(`/teams/${id}/players`, { page });
}

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const team = await getTeam(id);
  if (!team) notFound();

  const { items: roster, pageSize, total } = await getRoster(id, page);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Container size="md" className="py-10">
      <BackButton />
      <Card className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        {team.logoUrl ? (
          <Image
            src={team.logoUrl}
            alt={team.name}
            width={64}
            height={64}
            className="h-16 w-16 object-contain"
          />
        ) : (
          <div className="h-16 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
        )}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {team.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            {team.shortName ? <span>{team.shortName}</span> : null}
            {team.countryCode ? <span>&middot; {team.countryCode}</span> : null}
            {team.founded ? <span>&middot; Thành lập {team.founded}</span> : null}
          </div>
        </div>
        <div className="sm:ml-auto">
          <FavoriteButton kind="team" item={team} />
        </div>
      </Card>

      {team.stadium ? (
        <Card className="mb-8 flex flex-col gap-1">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Sân vận động
          </h2>
          <p className="font-medium text-zinc-900 dark:text-zinc-50">
            {team.stadium.name}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {[team.stadium.city, team.stadium.countryCode].filter(Boolean).join(", ")}
            {team.stadium.capacity
              ? ` · Sức chứa ${team.stadium.capacity.toLocaleString("vi-VN")}`
              : ""}
          </p>
        </Card>
      ) : null}

      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Danh sách cầu thủ
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {total.toLocaleString("vi-VN")} cầu thủ &middot; Trang {page}/{totalPages}
        </p>
      </div>

      {roster.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có dữ liệu cầu thủ cho đội này.
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {roster.map((player) => {
            const { label, variant } = playerPositionMeta(player.position);
            return (
              <li key={player.id}>
                <Link href={`/players/${player.id}`}>
                  <Card
                    padding="sm"
                    className="flex items-center justify-between gap-4 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {player.name}
                      </span>
                      {player.nationality ? (
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                          {player.nationality}
                        </span>
                      ) : null}
                    </div>
                    <Badge variant={variant}>{label}</Badge>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="mt-8 flex items-center justify-center gap-4 text-sm">
        {page > 1 ? (
          <Link
            href={`/teams/${id}?page=${page - 1}`}
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
            href={`/teams/${id}?page=${page + 1}`}
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
