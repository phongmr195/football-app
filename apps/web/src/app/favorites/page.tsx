"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Container } from "@football-app/ui";
import { useAuth } from "@/lib/auth-context";
import { fetchFavoritePlayers, fetchFavoriteTeams, removeFavorite } from "@/lib/favorites";
import { playerPositionMeta } from "@/lib/format";
import type { FavoritePlayerItem, FavoriteTeamItem } from "@/lib/types";

/**
 * Per-user private data (favorited teams/players) — inherently not cacheable/public, unlike the
 * rest of the browse pages, so this stays a Client Component rather than a Server
 * Component + ISR page. Needs both auth state (Firebase, browser-only) and the resulting data
 * fetch, so there's no meaningful server-rendered part to keep here.
 */
export default function FavoritesPage() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [teams, setTeams] = useState<FavoriteTeamItem[]>([]);
  const [players, setPlayers] = useState<FavoritePlayerItem[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Signed out: don't call the API at all (it would just 401) — the render below shows a
      // sign-in prompt in this case without ever consulting `loadingData`, so nothing to update.
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingData(true);
      try {
        const idToken = await getIdToken();
        const [teamItems, playerItems] = await Promise.all([
          fetchFavoriteTeams(idToken),
          fetchFavoritePlayers(idToken),
        ]);
        if (!cancelled) {
          setTeams(teamItems);
          setPlayers(playerItems);
        }
      } catch {
        // Minimal error handling for Phase 1 — leave lists empty rather than crash.
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, getIdToken]);

  const unfavoriteTeam = useCallback(
    async (teamId: string) => {
      const idToken = await getIdToken();
      await removeFavorite("team", teamId, idToken);
      setTeams((prev) => prev.filter((team) => team.id !== teamId));
    },
    [getIdToken]
  );

  const unfavoritePlayer = useCallback(
    async (playerId: string) => {
      const idToken = await getIdToken();
      await removeFavorite("player", playerId, idToken);
      setPlayers((prev) => prev.filter((player) => player.id !== playerId));
    },
    [getIdToken]
  );

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
                <Button size="sm" variant="ghost" onClick={() => void unfavoriteTeam(team.id)}>
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
                      onClick={() => void unfavoritePlayer(player.id)}
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
