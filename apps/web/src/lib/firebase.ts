/**
 * Firebase JS SDK bootstrap for apps/web (client-side auth — Google + Phone, see auth-context.tsx).
 *
 * Config comes from `NEXT_PUBLIC_FIREBASE_*` env vars (apps/web/.env.local — Web app already
 * registered under the shared `jankara-e2e-test` Firebase project, see CLAUDE.md §
 * Authentication and § Secrets & credentials). It's safe for these to reach the browser bundle:
 * Firebase client API keys identify the project, they don't authorize access on their own
 * (unlike an AWS/Slack/Stripe secret key) — this is also why `secretlint` intentionally doesn't
 * flag them, per CLAUDE.md.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Next.js prerenders "use client" trees on the server too (initial HTML), so this module can
// execute more than once across server + client module graphs, and again on every Fast Refresh
// in dev. `getApps().length` guards against Firebase's
// `FirebaseError: Firebase App named '[DEFAULT]' already exists` when `initializeApp` is called
// more than once — the standard Next.js + Firebase pattern.
const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);

// Local dev default: point the client SDK at the Firebase Auth Emulator (started via
// `pnpm docker:up`, see docker-compose.yml's `firebase-emulator` service) instead of the real
// `jankara-e2e-test` project, so signing in while developing never touches real users — this
// mirrors apps/api's `FIREBASE_AUTH_EMULATOR_HOST` wiring in
// apps/api/src/middleware/auth.ts. Emulator API is exposed on http://localhost:9099 (UI on
// :4000), matching the ports docker-compose.yml publishes to the host.
//
// Set NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false in apps/web/.env.local to opt OUT and test
// against the real project instead (needed for real Google-account sign-in — the emulator only
// accepts fake accounts created via its own UI, it can't talk to real Google). When doing this,
// apps/api must also stop pointing at the emulator (drop FIREBASE_AUTH_EMULATOR_HOST, set
// FIREBASE_PROJECT_ID=jankara-e2e-test instead) or token verification will fail — the emulator
// issues tokens for the fake project demo-football-app, which won't match the real project's
// aud/iss that apps/api would otherwise expect. Default stays emulator-on for everyone else so
// routine dev never touches real users.
//
// Guards:
// - `typeof window !== "undefined"`: only connect from the browser. This module also evaluates
//   during SSR (Node), where attempting an emulator connection serves no purpose.
// - `process.env.NODE_ENV === "development"`: only in dev — this module's emulator branch is
//   inert in production builds regardless of the opt-out var above.
// - `auth.emulatorConfig === null`: `connectAuthEmulator` throws if called twice on the same
//   `Auth` instance. Checking the instance's own state (rather than a module-level flag) is
//   robust across Fast Refresh re-evaluating this module, since a fresh `Auth` instance always
//   starts with `emulatorConfig === null`.
if (
  typeof window !== "undefined" &&
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR !== "false" &&
  auth.emulatorConfig === null
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
}
