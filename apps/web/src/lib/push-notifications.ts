/**
 * Browser push notification opt-in (Phase 2 Bước 3 — push notifications for favorited-team
 * goals). Only ever called from a client-side interaction (the "Bật thông báo bàn thắng" button
 * on app/favorites/page.tsx) — never during SSR/prerender — so, unlike src/lib/firebase.ts,
 * there's no need to dynamically `import()` `firebase/messaging` as a safety net: static imports
 * of Firebase submodules are already this codebase's convention (see firebase.ts, auth-context.tsx),
 * and `firebase/messaging` has been verified importable in a Node (non-browser) module graph
 * without throwing, so it's safe even though this module's "use client" page may still be
 * prerendered on the server (the resulting import just isn't invoked there).
 */
import { getMessaging, getToken } from "firebase/messaging";
import { app } from "./firebase";

/**
 * Requests Notification permission and, if granted, registers the FCM service worker and
 * returns an FCM registration token. Returns `null` (never throws) if the browser doesn't
 * support push, the user declines/dismisses the permission prompt, or anything else fails —
 * callers should treat `null` as "push isn't available right now" rather than an error.
 */
export async function requestPushPermission(): Promise<string | null> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator)
  ) {
    return null;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  try {
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = getMessaging(app);
    return await getToken(messaging, {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
  } catch (err) {
    console.error("requestPushPermission: failed to get FCM token", err);
    return null;
  }
}
