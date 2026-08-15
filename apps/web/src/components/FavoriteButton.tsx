"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Button } from "@football-app/ui";
import { useAuth } from "@/lib/auth-context";
import { useFavoritePlayers, useFavoriteTeams, useToggleFavorite } from "@/lib/use-favorites";
import type { FavoritePlayerItem, FavoriteTeamItem } from "@/lib/types";

export type FavoriteButtonProps =
  | { kind: "team"; item: FavoriteTeamItem }
  | { kind: "player"; item: FavoritePlayerItem };

/**
 * Toggle button for favoriting a team or player. A Client "island" meant to be embedded as-is
 * inside the otherwise-Server-Component /teams/[id] and /players/[id] pages (ISR) — only `kind`
 * and `item` (the subset of Team/Player fields matching FavoriteTeamItem/FavoritePlayerItem —
 * TeamDetail/PlayerDetail are structurally compatible supersets, so the page can pass its
 * already-fetched `team`/`player` object directly) cross the server/client boundary.
 *
 * There's no `GET /favorites/teams/:teamId` "is this favorited" endpoint (see
 * apps/api/src/routes/favorites.ts) — only list endpoints. So membership is derived from the
 * shared `["favorites", kind]` React Query cache (see lib/use-favorites.ts) — the whole list for
 * `kind` is fetched once (when signed in) and reused/deduped across every FavoriteButton instance
 * and app/favorites/page.tsx, rather than each button independently re-fetching it.
 */
export function FavoriteButton(props: FavoriteButtonProps) {
  const { kind, item } = props;
  const { user, loading: authLoading } = useAuth();
  const teamsQuery = useFavoriteTeams();
  const playersQuery = useFavoritePlayers();
  const { favorite, unfavorite } = useToggleFavorite(kind);

  const query = kind === "team" ? teamsQuery : playersQuery;
  const favorited = (query.data ?? []).some((existing) => existing.id === item.id);
  const pending = favorite.isPending || unfavorite.isPending;

  const toggle = useCallback(() => {
    if (favorited) {
      unfavorite.mutate(item.id);
    } else {
      favorite.mutate(item);
    }
  }, [favorited, favorite, unfavorite, item]);

  if (authLoading || (user && query.isLoading)) {
    return (
      <Button size="sm" variant="outline" disabled>
        …
      </Button>
    );
  }

  if (!user) {
    return (
      <Link href="/auth">
        <Button size="sm" variant="outline">
          ☆ Theo dõi
        </Button>
      </Link>
    );
  }

  return (
    <Button
      size="sm"
      variant={favorited ? "secondary" : "outline"}
      disabled={pending}
      onClick={toggle}
    >
      {favorited ? "★ Đang theo dõi" : "☆ Theo dõi"}
    </Button>
  );
}
