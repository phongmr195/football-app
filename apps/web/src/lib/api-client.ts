/**
 * Typed fetch helpers for calling apps/api (Hono REST backend).
 *
 * Two families of helpers, on purpose:
 *
 * - `apiGet` (server-only): base URL from `API_URL` (see .env.example), used by Server
 *   Components for the public browse pages (competitions/teams/players/matches/standings).
 *   None of those endpoints require auth today, so `apiGet` stays unauthenticated and unaware
 *   of client auth state — it must keep working regardless of sign-in state, since it's called
 *   during SSR/ISR where there's no browser and no Firebase Auth session to read.
 * - `apiGetClient`/`apiMutateClient` (client-only): for Client Components that need to call
 *   apps/api directly from the browser and attach a Firebase ID token — e.g. piece 6
 *   (favorites), the first feature needing `requireAuth` (apps/api/src/middleware/auth.ts).
 *   Get the token via `useAuth().getIdToken()` (lib/auth-context.tsx) right before the call and
 *   pass it as `idToken`; these helpers don't read auth state themselves; they just attach
 *   whatever token the caller passes.
 *
 * `apiGetClient`/`apiMutateClient` read `NEXT_PUBLIC_API_URL`, which does NOT exist yet in
 * apps/web/.env.local/.env.example (out of scope for this piece — no client feature calls them
 * yet). Piece 6 should add `NEXT_PUBLIC_API_URL=http://localhost:3000` (dev) there when it
 * starts using them; until then, calling them throws a clear error rather than silently no-op.
 */

export type SearchParamsInit = Record<string, string | number | boolean | undefined | null>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getBaseUrl(): string {
  const baseUrl = process.env.API_URL;
  if (!baseUrl) {
    throw new Error(
      "API_URL env var is not set — copy apps/web/.env.example to apps/web/.env.local"
    );
  }
  return baseUrl;
}

function buildUrl(path: string, searchParams?: SearchParamsInit): string {
  const url = new URL(path, getBaseUrl());
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Accept: "application/json",
    // Deliberately no Authorization header: apiGet is server-only and calls apps/api's public,
    // unauthenticated read endpoints — see the module doc comment above for why, and
    // apiGetClient/apiMutateClient below for the authenticated, client-side counterpart.
    ...extra,
  };
}

/**
 * GET helper for apps/api. Throws ApiError on non-2xx responses.
 *
 * @param path Path relative to API_URL, e.g. "/competitions" or "/matches/123".
 * @param searchParams Optional query params, e.g. { competitionId, status }.
 * @param init Extra fetch options (e.g. `next: { revalidate }` for ISR) merged in.
 */
export async function apiGet<T>(
  path: string,
  searchParams?: SearchParamsInit,
  init?: Omit<RequestInit, "method" | "body">
): Promise<T> {
  const url = buildUrl(path, searchParams);

  const res = await fetch(url, {
    ...init,
    method: "GET",
    headers: buildHeaders(init?.headers),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `GET ${path} failed with ${res.status}: ${body}`);
  }

  return (await res.json()) as T;
}

/** Shape returned by apps/api's list endpoints (/competitions, /teams, /matches, ...). */
export interface ApiListResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------------------------------------------------------------------------------------------
// Client-side helpers (Client Components only) — see module doc comment above for the
// server-vs-client split rationale. Not used by any page yet; piece 6 (favorites) is the first
// consumer.
// ---------------------------------------------------------------------------------------------

function getClientBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error(
      "NEXT_PUBLIC_API_URL env var is not set — add it to apps/web/.env.local and .env.example " +
        "(needed for authenticated Client Component calls to apps/api, e.g. favorites)."
    );
  }
  return baseUrl;
}

function buildClientUrl(baseUrl: string, path: string, searchParams?: SearchParamsInit): string {
  const url = new URL(path, baseUrl);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildClientHeaders(idToken: string | null | undefined, extra?: HeadersInit): HeadersInit {
  return {
    Accept: "application/json",
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    ...extra,
  };
}

export interface ApiClientRequestInit extends Omit<RequestInit, "method" | "body" | "headers"> {
  /**
   * Firebase ID token for `requireAuth`-protected routes. Get it via
   * `useAuth().getIdToken()` (lib/auth-context.tsx) right before the call — tokens are
   * short-lived and refreshed by the SDK, don't cache them yourself. Omit (or pass
   * null/undefined) for endpoints that don't require auth.
   */
  idToken?: string | null;
  headers?: HeadersInit;
}

/**
 * GET helper for Client Components. Use this — not `apiGet` above — for calls made from the
 * browser and/or that need a Firebase ID token attached.
 */
export async function apiGetClient<T>(
  path: string,
  searchParams?: SearchParamsInit,
  init?: ApiClientRequestInit
): Promise<T> {
  const { idToken, headers, ...rest } = init ?? {};
  const url = buildClientUrl(getClientBaseUrl(), path, searchParams);

  const res = await fetch(url, {
    ...rest,
    method: "GET",
    headers: buildClientHeaders(idToken, headers),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `GET ${path} failed with ${res.status}: ${body}`);
  }

  return (await res.json()) as T;
}

/**
 * POST/PATCH/PUT/DELETE helper for Client Components — e.g. piece 6's "add/remove favorite".
 * Sends `body` as JSON when provided. Returns `undefined` for 204 No Content responses.
 */
export async function apiMutateClient<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
  init?: ApiClientRequestInit
): Promise<T> {
  const { idToken, headers, ...rest } = init ?? {};
  const url = buildClientUrl(getClientBaseUrl(), path);

  const res = await fetch(url, {
    ...rest,
    method,
    headers: buildClientHeaders(idToken, {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new ApiError(res.status, `${method} ${path} failed with ${res.status}: ${errBody}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
