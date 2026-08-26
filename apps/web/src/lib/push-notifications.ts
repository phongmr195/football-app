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
import { getMessaging, getToken, onMessage } from "firebase/messaging";
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

/**
 * Foreground counterpart to firebase-messaging-sw.js's onBackgroundMessage — FCM only
 * auto-displays a system notification via the service worker when NO tab of this app has
 * focus. While a tab IS focused, the push arrives silently to `onMessage()` instead and it's
 * up to the app to surface it; this codebase's original push-notification piece explicitly
 * scoped that out ("not part of this piece", see firebase-messaging-sw.js/route.ts's comment).
 * Shows the same real browser Notification the service worker would, so a goal push is visible
 * regardless of whether the tab happens to be focused when it arrives.
 *
 * Safe to call even if the user never granted permission / never enabled push — `onMessage`
 * just never fires in that case (no messages are being delivered to this client at all without
 * a registered FCM token, see requestPushPermission()).
 */
export function listenForForegroundMessages(): () => void {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return () => {};
  }

  const messaging = getMessaging(app);
  return onMessage(messaging, (payload) => {
    if (Notification.permission !== "granted") return;
    new Notification(payload.notification?.title ?? "Bàn thắng!", {
      body: payload.notification?.body,
      data: payload.data,
    });
  });
}
