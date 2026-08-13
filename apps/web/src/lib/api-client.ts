/**
 * Minimal typed fetch helper for calling apps/api (Hono REST backend).
 *
 * Base URL comes from `API_URL`, a server-only env var (see .env.example) — this matches
 * the convention already documented in .claude/skills/add-web-page/SKILL.md, which fetches
 * directly from Server Components via `process.env.API_URL`. There is no
 * `NEXT_PUBLIC_API_URL` yet: keep calls to this module in Server Components / server-side
 * code (route handlers, generateStaticParams, etc.) until a Client Component actually needs
 * to hit the API directly, at which point add that env var deliberately.
 *
 * Auth: apps/api's read endpoints (competitions/teams/players/matches/standings/statistics)
 * don't require auth today. Once Firebase Auth is wired on the web client, add an
 * `Authorization: Bearer <idToken>` header in `buildHeaders` below.
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
    // TODO(auth): once Firebase Auth is wired, attach `Authorization: Bearer <idToken>` here.
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
