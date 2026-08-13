/**
 * Shared client-side helpers for apps/api's `/favorites/*` endpoints (piece 6a backend, piece 6b
 * frontend). Used by both `components/FavoriteButton.tsx` (single team/player toggle, embedded
 * in the /teams/[id] and /players/[id] Server Components) and `app/favorites/page.tsx` (full
 * list + unfavorite) so the path/body shapes documented in apps/api/src/routes/favorites.ts
 * live in exactly one place instead of being duplicated across both call sites.
 *
 * These are thin wrappers over `apiGetClient`/`apiMutateClient` (lib/api-client.ts) — callers
 * still get their own Firebase ID token via `useAuth().getIdToken()` right before calling (see
 * that file's doc comment for why it isn't cached), and pass it in here.
 */
import { apiGetClient, apiMutateClient } from "./api-client";
import type { FavoritePlayerItem, FavoriteTeamItem } from "./types";

export type FavoriteKind = "team" | "player";

export async function fetchFavoriteTeams(idToken: string | null): Promise<FavoriteTeamItem[]> {
  const { items } = await apiGetClient<{ items: FavoriteTeamItem[] }>(
    "/favorites/teams",
    undefined,
    { idToken }
  );
  return items;
}

export async function fetchFavoritePlayers(
  idToken: string | null
): Promise<FavoritePlayerItem[]> {
  const { items } = await apiGetClient<{ items: FavoritePlayerItem[] }>(
    "/favorites/players",
    undefined,
    { idToken }
  );
  return items;
}

/** POST /favorites/teams or /favorites/players — idempotent on apps/api's side. */
export async function addFavorite(
  kind: FavoriteKind,
  id: string,
  idToken: string | null
): Promise<void> {
  if (kind === "team") {
    await apiMutateClient("/favorites/teams", "POST", { teamId: id }, { idToken });
  } else {
    await apiMutateClient("/favorites/players", "POST", { playerId: id }, { idToken });
  }
}

/** DELETE /favorites/teams/:id or /favorites/players/:id — idempotent on apps/api's side. */
export async function removeFavorite(
  kind: FavoriteKind,
  id: string,
  idToken: string | null
): Promise<void> {
  const path = kind === "team" ? `/favorites/teams/${id}` : `/favorites/players/${id}`;
  await apiMutateClient(path, "DELETE", undefined, { idToken });
}
