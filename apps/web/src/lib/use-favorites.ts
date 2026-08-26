/**
 * React Query hooks wrapping lib/favorites.ts's fetchers, shared by `components/FavoriteButton.tsx`
 * (single team/player toggle, embedded in /teams/[id] and /players/[id]) and
 * `app/favorites/page.tsx` (full lists + unfavorite).
 *
 * Both call sites read/write the SAME query cache (keyed by ["favorites", kind]), so:
 * - Only one `GET /favorites/teams|players` request happens per kind per session, no matter how
 *   many FavoriteButton instances + the favorites page all want that list (React Query dedupes
 *   concurrent fetches for the same key and reuses the cached result afterwards).
 * - Toggling a favorite from either FavoriteButton or the favorites page updates the cache
 *   directly (see useToggleFavorite below) instead of refetching, so the other call site's view
 *   of the list is immediately consistent too.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth-context";
import {
  addFavorite,
  fetchFavoritePlayers,
  fetchFavoriteTeams,
  removeFavorite,
  type FavoriteKind,
} from "./favorites";
import type { FavoritePlayerItem, FavoriteTeamItem } from "./types";

const favoritesQueryKey = (kind: FavoriteKind) => ["favorites", kind === "team" ? "teams" : "players"] as const;

/** Item shape stored in the ["favorites", "teams"|"players"] query cache, keyed by kind. */
type FavoriteItemOf<K extends FavoriteKind> = K extends "team" ? FavoriteTeamItem : FavoritePlayerItem;

export function useFavoriteTeams() {
  const { user, loading: authLoading, getIdToken } = useAuth();

  return useQuery({
    queryKey: favoritesQueryKey("team"),
    queryFn: async () => fetchFavoriteTeams(await getIdToken()),
    enabled: !authLoading && !!user,
  });
}

export function useFavoritePlayers() {
  const { user, loading: authLoading, getIdToken } = useAuth();

  return useQuery({
    queryKey: favoritesQueryKey("player"),
    queryFn: async () => fetchFavoritePlayers(await getIdToken()),
    enabled: !authLoading && !!user,
  });
}

/**
 * Toggle-favorite mutation for a given `kind`. `id`/`item` are passed at call time (not fixed to
 * the hook) so `app/favorites/page.tsx` can reuse one hook instance for its whole list rather
 * than one per row.
 *
 * On success, updates the ["favorites", kind] cache directly (add or remove the item) instead of
 * invalidating + refetching — cheaper, and instant for every consumer of that query key.
 */
export function useToggleFavorite<K extends FavoriteKind>(kind: K) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = favoritesQueryKey(kind);

  const favorite = useMutation({
    mutationFn: async (item: FavoriteItemOf<K>) => {
      await addFavorite(kind, item.id, await getIdToken());
      return item;
    },
    onSuccess: (item) => {
      queryClient.setQueryData<FavoriteItemOf<K>[]>(queryKey, (prev) => {
        if (!prev) return [item];
        return prev.some((existing) => existing.id === item.id) ? prev : [...prev, item];
      });
    },
  });

  const unfavorite = useMutation({
    mutationFn: async (id: string) => {
      await removeFavorite(kind, id, await getIdToken());
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<FavoriteItemOf<K>[]>(queryKey, (prev) =>
        prev ? prev.filter((existing) => existing.id !== id) : prev
      );
    },
  });

  return { favorite, unfavorite };
}
