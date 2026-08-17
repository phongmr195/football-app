/**
 * Client-side helper for apps/api's `POST /devices` endpoint (Phase 2 Bước 3 — push
 * notifications for favorited-team goals), mirroring favorites.ts's style: a thin wrapper over
 * `apiMutateClient` (lib/api-client.ts) so the path/body shape lives in one place. Called from
 * app/favorites/page.tsx after `requestPushPermission()` (lib/push-notifications.ts) returns a
 * non-null FCM token.
 */
import { apiGetClient, apiMutateClient } from "./api-client";

export interface Device {
  id: string;
  userId: string;
  fcmToken: string;
  platform: "IOS" | "ANDROID" | "WEB";
  lastActiveAt: string;
  createdAt: string;
}

/** POST /devices — upserts a Device row keyed on fcmToken (idempotent on apps/api's side). */
export async function registerDevice(fcmToken: string, idToken: string | null): Promise<void> {
  await apiMutateClient("/devices", "POST", { fcmToken, platform: "WEB" }, { idToken });
}

/** GET /devices — current user's registered devices, used to detect "already enabled on this
 * browser" on page load (match by fcmToken against a freshly-fetched token). */
export async function listDevices(idToken: string | null): Promise<Device[]> {
  const { items } = await apiGetClient<{ items: Device[] }>("/devices", undefined, { idToken });
  return items;
}

/** DELETE /devices/:id — unregisters a device (idempotent on apps/api's side). */
export async function unregisterDevice(deviceId: string, idToken: string | null): Promise<void> {
  await apiMutateClient(`/devices/${deviceId}`, "DELETE", undefined, { idToken });
}
