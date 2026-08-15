"use client";

import Image from "next/image";
import Link from "next/link";
import { Badge, Button, Card, Container } from "@football-app/ui";
import { useAuth } from "@/lib/auth-context";
import { playerPositionMeta } from "@/lib/format";
import { useFavoritePlayers, useFavoriteTeams, useToggleFavorite } from "@/lib/use-favorites";

/**
 * Per-user private data (favorited teams/players) — inherently not cacheable/public, unlike the
 * rest of the browse pages, so this stays a Client Component rather than a Server
 * Component + ISR page. Needs both auth state (Firebase, browser-only) and the resulting data
 * fetch, so there's no meaningful server-rendered part to keep here.
 *
 * Lists come from the shared `["favorites", "teams"|"players"]` React Query cache (see
 * lib/use-favorites.ts) — the same cache `components/FavoriteButton.tsx` reads/writes on
 * /teams/[id] and /players/[id], so unfavoriting here (or favoriting from a detail page) stays
 * consistent everywhere without an extra round-trip.
 */
export default function FavoritesPage() {
  const { user, loading: authLoading } = useAuth();
  const teamsQuery = useFavoriteTeams();
  const playersQuery = useFavoritePlayers();
  const { unfavorite: unfavoriteTeamMutation } = useToggleFavorite("team");
  const { unfavorite: unfavoritePlayerMutation } = useToggleFavorite("player");

  const teams = teamsQuery.data ?? [];
  const players = playersQuery.data ?? [];
  const loadingData = user ? teamsQuery.isLoading || playersQuery.isLoading : false;

  if (authLoading) {
    return (
      <Container size="md" className="py-10">
        <p className="text-sm text-zinc-400 dark:text-zinc-600">…</p>
      </Container>
    );
  }

  if (!user) {
    return (
      <Container size="md" className="py-10">
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">
            Đăng nhập để xem danh sách đội bóng và cầu thủ bạn đang theo dõi.
          </p>
          <Link href="/auth">
            <Button>Đăng nhập</Button>
          </Link>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" className="py-10">
      <h1 className="mb-8 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Yêu thích</h1>

      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Đội bóng</h2>
      {loadingData ? (
        <p className="mb-8 text-sm text-zinc-400 dark:text-zinc-600">Đang tải…</p>
      ) : teams.length === 0 ? (
        <Card className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có đội bóng nào trong danh sách yêu thích.
        </Card>
      ) : (
        <ul className="mb-8 flex flex-col gap-2">
          {teams.map((team) => (
            <li key={team.id}>
              <Card padding="sm" className="flex items-center justify-between gap-4">
                <Link href={`/teams/${team.id}`} className="flex items-center gap-3">
                  {team.logoUrl ? (
                    <Image
                      src={team.logoUrl}
                      alt={team.name}
                      width={32}
                      height={32}
                      className="h-8 w-8 object-contain"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded bg-zinc-100 dark:bg-zinc-800" />
                  )}
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{team.name}</span>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => unfavoriteTeamMutation.mutate(team.id)}
                >
                  Bỏ theo dõi
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Cầu thủ</h2>
      {loadingData ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">Đang tải…</p>
      ) : players.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có cầu thủ nào trong danh sách yêu thích.
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {players.map((player) => {
            const { label, variant } = playerPositionMeta(player.position);
            return (
              <li key={player.id}>
                <Card padding="sm" className="flex items-center justify-between gap-4">
                  <Link href={`/players/${player.id}`} className="flex flex-col">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {player.name}
                    </span>
                  </Link>
                  <div className="flex items-center gap-3">
                    <Badge variant={variant}>{label}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => unfavoritePlayerMutation.mutate(player.id)}
                    >
                      Bỏ theo dõi
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
