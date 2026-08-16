/**
 * Client-side helper for apps/api's `POST /devices` endpoint (Phase 2 Bước 3 — push
 * notifications for favorited-team goals), mirroring favorites.ts's style: a thin wrapper over
 * `apiMutateClient` (lib/api-client.ts) so the path/body shape lives in one place. Called from
 * app/favorites/page.tsx after `requestPushPermission()` (lib/push-notifications.ts) returns a
 * non-null FCM token.
 */
import { apiMutateClient } from "./api-client";

/** POST /devices — upserts a Device row keyed on fcmToken (idempotent on apps/api's side). */
export async function registerDevice(fcmToken: string, idToken: string | null): Promise<void> {
  await apiMutateClient("/devices", "POST", { fcmToken, platform: "WEB" }, { idToken });
}
