"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@football-app/ui";
import { useAuth } from "@/lib/auth-context";
import {
  addFavorite,
  fetchFavoritePlayers,
  fetchFavoriteTeams,
  removeFavorite,
  type FavoriteKind,
} from "@/lib/favorites";

export interface FavoriteButtonProps {
  kind: FavoriteKind;
  id: string;
}

/**
 * Toggle button for favoriting a team or player. A Client "island" meant to be embedded as-is
 * inside the otherwise-Server-Component /teams/[id] and /players/[id] pages (ISR) — only `kind`
 * and `id` cross the server/client boundary, nothing else.
 *
 * There's no `GET /favorites/teams/:teamId` "is this favorited" endpoint (see
 * apps/api/src/routes/favorites.ts) — only list endpoints. So on mount (once signed in), this
 * fetches the user's whole favorites list for `kind` and checks membership by id. Acceptable
 * for Phase 1 — a user's favorites list is small (the backend's own reasoning for not
 * paginating those endpoints) — at the cost of a brief neutral/unknown flash while that request
 * is in flight.
 */
export function FavoriteButton({ kind, id }: FavoriteButtonProps) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [favorited, setFavorited] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const idToken = await getIdToken();
        const items =
          kind === "team" ? await fetchFavoriteTeams(idToken) : await fetchFavoritePlayers(idToken);
        if (!cancelled) setFavorited(items.some((item) => item.id === id));
      } catch {
        // Best-effort initial state — leave as not-favorited rather than crash the page.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, kind, id, getIdToken]);

  const toggle = useCallback(async () => {
    setPending(true);
    try {
      const idToken = await getIdToken();
      if (favorited) {
        await removeFavorite(kind, id, idToken);
        setFavorited(false);
      } else {
        await addFavorite(kind, id, idToken);
        setFavorited(true);
      }
    } catch {
      // Minimal error handling for Phase 1 — leave state unchanged, don't crash.
    } finally {
      setPending(false);
    }
  }, [favorited, kind, id, getIdToken]);

  if (authLoading) {
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
      onClick={() => void toggle()}
    >
      {favorited ? "★ Đang theo dõi" : "☆ Theo dõi"}
    </Button>
  );
}
