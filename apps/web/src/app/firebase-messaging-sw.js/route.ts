/**
 * Serves `/firebase-messaging-sw.js` as a Route Handler instead of a static file under `public/`.
 *
 * A Service Worker can't read `process.env` at runtime (it has no bundler step, unlike
 * src/lib/firebase.ts which gets `NEXT_PUBLIC_*` vars inlined by Next.js at build time) — but a
 * Route Handler runs server-side in Node.js, where `process.env` (including `NEXT_PUBLIC_*` vars,
 * which are just plain env vars from a server-side perspective — the build-time-inlining behavior
 * only applies when referenced from client-bundle code) is read normally at request time. This
 * generates the service worker's source with the real config values baked in per-request, so there
 * is no static file to keep in sync by hand whenever the Firebase project's web app config changes.
 *
 * These values are safe to serve/expose despite looking like secrets — see the doc comment on
 * `firebaseConfig` in `src/lib/firebase.ts`: Firebase client API keys identify the project, they
 * don't authorize access on their own (this is also why secretlint doesn't flag them).
 */
export async function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const body = `
importScripts("https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(config)});

const messaging = firebase.messaging();

// Fires when a push arrives while no tab of this app has focus (or is closed) — the case push
// notifications exist for. Foreground messages (a tab open and focused) are handled instead by
// an "onMessage" listener wired wherever the app chooses to show an in-app toast (not part of
// this piece).
messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification?.title ?? "Bàn thắng!", {
    body: payload.notification?.body,
    data: payload.data,
  });
});
`.trimStart();

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Cho phép service worker này kiểm soát toàn bộ origin (scope mặc định "/") dù bản thân nó
      // được serve từ 1 route handler thay vì public/ — không có header này thì register() với
      // scope root có thể bị browser từ chối tuỳ implementation.
      "Service-Worker-Allowed": "/",
    },
  });
}
