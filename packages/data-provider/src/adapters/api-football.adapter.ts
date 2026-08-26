import type { DataProviderAdapter } from "../provider.interface";
import { RateLimiter } from "../rate-limiter";
import type {
  CanonicalCompetition,
  CanonicalMatch,
  CanonicalMatchEvent,
  CanonicalMatchStatus,
  CanonicalPlayer,
  CanonicalSeason,
  CanonicalStandingRow,
  CanonicalTeam,
  CanonicalTopScorerRow,
  ExternalRef,
} from "../types";

const PROVIDER_NAME = "api-football";
const BASE_URL = "https://v3.football.api-sports.io";

// Xác nhận qua header response thật (2026-08): x-ratelimit-limit: 10 (request/phút, Free
// plan) — để margin an toàn còn 8/phút, tránh sát biên do request tính giờ lệch nhẹ.
// x-ratelimit-requests-limit: 100 (request/ngày) — KHÔNG throttle ở đây, để caller
// (sync-worker) tự quyết định phạm vi sync theo ngân sách ngày, xem ROADMAP Phase 1.
const REQUESTS_PER_MINUTE = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Đã verify với response thật (2026-08, Premier League id=39, season=2023, team=33):
// mapCompetition/mapSeason/mapTeam/mapPlayer/mapMatch/mapStandingRow + STATUS_MAP["FT"].
// mapMatchEvent (/fixtures/events) CHƯA verify — chưa có trận nào để test lúc đó.
// API-Football có thể đổi shape theo thời gian, re-verify nếu sync-worker báo lỗi map lạ.
const STATUS_MAP: Record<string, CanonicalMatchStatus> = {
  NS: "SCHEDULED",
  "1H": "LIVE",
  "2H": "LIVE",
  HT: "HALFTIME",
  FT: "FINISHED",
  PST: "POSTPONED",
  CANC: "CANCELLED",
};

function toExternalRef(id: string | number): ExternalRef {
  return { provider: PROVIDER_NAME, id: String(id) };
}

export interface ApiFootballAdapterOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  rateLimiter?: RateLimiter;
}

export class ApiFootballAdapter implements DataProviderAdapter {
  readonly providerName = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly rateLimiter: RateLimiter;

  constructor(options: ApiFootballAdapterOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.rateLimiter =
      options.rateLimiter ??
      new RateLimiter({ maxRequests: REQUESTS_PER_MINUTE, windowMs: RATE_LIMIT_WINDOW_MS });
  }

  private async request<T>(path: string, attempt = 1): Promise<T> {
    await this.rateLimiter.acquire();
    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
      headers: { "x-apisports-key": this.apiKey },
    });

    if (res.status === 429) {
      // Vẫn có thể dính 429 dù đã throttle (ví dụ có process khác dùng chung key) — retry
      // có backoff, tối đa 3 lần, tôn trọng header Retry-After nếu provider trả về.
      if (attempt > 3) {
        throw new Error(`api-football request failed: 429 (đã retry ${attempt - 1} lần) ${path}`);
      }
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 10_000 * attempt;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return this.request<T>(path, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(`api-football request failed: ${res.status} ${path}`);
    }

    const body = (await res.json()) as { errors?: unknown };
    // Xác nhận thật (2026-08): API-Football báo lỗi (hết quota ngày, param sai...) bằng
    // HTTP 200 kèm "errors" có nội dung trong body — KHÔNG phải mã lỗi HTTP. Không check
    // field này thì mọi lỗi loại này bị coi là "thành công" với response rỗng (bug thật đã
    // gặp: hết quota ngày → fetchMatches trả về 0 match một cách âm thầm, không throw).
    if (body.errors && (Array.isArray(body.errors) ? body.errors.length > 0 : Object.keys(body.errors).length > 0)) {
      throw new Error(`api-football request failed: ${JSON.stringify(body.errors)} ${path}`);
    }

    return body as T;
  }

  async fetchCompetitions(): Promise<CanonicalCompetition[]> {
    const data = await this.request<{ response: unknown[] }>("/leagues");
    return data.response.map((raw) => this.mapCompetition(raw));
  }

  async fetchSeasons(competitionExternalRef: ExternalRef): Promise<CanonicalSeason[]> {
    const data = await this.request<{ response: unknown[] }>(
      `/leagues?id=${competitionExternalRef.id}`,
    );
    const [raw] = data.response;
    if (!raw) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify, xem TODO ở đầu file
    const r = raw as Record<string, any>;
    const seasons: unknown[] = r.seasons ?? [];
    return seasons.map((season) => this.mapSeason(season as Record<string, unknown>, competitionExternalRef));
  }

  async fetchTeams(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalTeam[]> {
    const data = await this.request<{ response: unknown[] }>(
      `/teams?league=${competitionExternalRef.id}&season=${seasonExternalRef.id}`,
    );
    return data.response.map((raw) => this.mapTeam(raw));
  }

  async fetchPlayers(
    teamExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalPlayer[]> {
    // Verify với response thật (2026-08): 1 trang ~20 người, squad đầy đủ thường 3-4 trang
    // (paging.total) — lặp hết trang để lấy đủ squad, không chỉ trang 1.
    const players = [];
    let page = 1;
    let totalPages = 1;
    do {
      const data = await this.request<{
        response: unknown[];
        paging: { current: number; total: number };
      }>(`/players?team=${teamExternalRef.id}&season=${seasonExternalRef.id}&page=${page}`);
      players.push(...data.response.map((raw) => this.mapPlayer(raw, teamExternalRef)));
      totalPages = data.paging.total;
      page++;
    } while (page <= totalPages);
    return players;
  }

  async fetchMatches(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalMatch[]> {
    const data = await this.request<{ response: unknown[] }>(
      `/fixtures?league=${competitionExternalRef.id}&season=${seasonExternalRef.id}`,
    );
    return data.response.map((raw) => this.mapMatch(raw));
  }

  async fetchLiveMatches(): Promise<CanonicalMatch[]> {
    const data = await this.request<{ response: unknown[] }>("/fixtures?live=all");
    return data.response.map((raw) => this.mapMatch(raw));
  }

  async fetchMatch(externalId: string): Promise<CanonicalMatch> {
    const data = await this.request<{ response: unknown[] }>(`/fixtures?id=${externalId}`);
    const [raw] = data.response;
    if (!raw) throw new Error(`match not found: ${externalId}`);
    return this.mapMatch(raw);
  }

  async fetchMatchEvents(externalId: string): Promise<CanonicalMatchEvent[]> {
    const data = await this.request<{ response: unknown[] }>(`/fixtures/events?fixture=${externalId}`);
    return data.response.map((raw, index) => this.mapMatchEvent(raw, externalId, index));
  }

  async fetchStandings(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalStandingRow[]> {
    const data = await this.request<{ response: unknown[] }>(
      `/standings?league=${competitionExternalRef.id}&season=${seasonExternalRef.id}`,
    );
    // Verify với response thật (2026-08): response[0].league.standings là mảng CÁC NHÓM
    // (thường 1 nhóm cho giải vô địch quốc gia, nhiều nhóm cho giải có bảng như World Cup) —
    // mỗi nhóm là 1 mảng hàng xếp hạng. flat() để lấy hết hàng của mọi nhóm.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify hết, xem TODO ở đầu file
    const league = (data.response[0] as any)?.league;
    const rows: unknown[] = (league?.standings ?? []).flat();
    return rows.map((raw) => this.mapStandingRow(raw, seasonExternalRef));
  }

  async fetchTopScorers(
    _competitionExternalRef: ExternalRef,
    _seasonExternalRef: ExternalRef,
  ): Promise<CanonicalTopScorerRow[]> {
    // api-football có endpoint /players/topscorers tương đương (CHƯA verify thật shape — provider
    // này hiện đang bị chặn/suspend, không phải là default provider, xem CLAUDE.md § Data
    // provider). Throw rõ ràng thay vì trả [] để syncTopScorers (sync-catalog.ts) phân biệt được
    // "provider không hỗ trợ" khỏi "giải này không có top scorer nào" — caller đã bọc try/catch.
    throw new Error(
      "ApiFootballAdapter.fetchTopScorers: chưa implement (chỉ FootballDataAdapter — provider mặc định — có method này, xem ROADMAP Phase 3)",
    );
  }

  // ---- mapping: JSON thô của api-football -> canonical model ----

  private mapCompetition(raw: unknown): CanonicalCompetition {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify, xem TODO ở đầu file
    const r = raw as Record<string, any>;
    const isInternational = r.country?.name === "World";
    return {
      externalRef: toExternalRef(r.league.id),
      name: r.league.name,
      type: isInternational ? "INTERNATIONAL" : r.league.type === "Cup" ? "CUP" : "LEAGUE",
      countryCode: r.country?.code ?? undefined,
      logoUrl: r.league.logo ?? undefined,
    };
  }

  private mapSeason(
    raw: Record<string, unknown>,
    competitionExternalRef: ExternalRef,
  ): CanonicalSeason {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify, xem TODO ở đầu file
    const r = raw as Record<string, any>;
    return {
      externalRef: toExternalRef(r.year),
      competitionExternalRef,
      name: String(r.year),
      startDate: r.start,
      endDate: r.end,
      isCurrent: Boolean(r.current),
    };
  }

  private mapTeam(raw: unknown): CanonicalTeam {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify, xem TODO ở đầu file
    const r = raw as Record<string, any>;
    return {
      externalRef: toExternalRef(r.team.id),
      name: r.team.name,
      shortName: r.team.code ?? undefined,
      logoUrl: r.team.logo ?? undefined,
      countryCode: r.team.country ?? undefined,
      founded: r.team.founded ?? undefined,
    };
  }

  private mapPlayer(raw: unknown, teamExternalRef: ExternalRef): CanonicalPlayer {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify, xem TODO ở đầu file
    const r = raw as Record<string, any>;
    return {
      externalRef: toExternalRef(r.player.id),
      name: r.player.name,
      dateOfBirth: r.player.birth?.date ?? undefined,
      nationality: r.player.nationality ?? undefined,
      position: r.statistics?.[0]?.games?.position ?? undefined,
      teamExternalRef,
    };
  }

  private mapMatch(raw: unknown): CanonicalMatch {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify, xem TODO ở đầu file
    const r = raw as Record<string, any>;
    return {
      externalRef: toExternalRef(r.fixture.id),
      competitionExternalRef: toExternalRef(r.league.id),
      seasonExternalRef: toExternalRef(r.league.season),
      homeTeamExternalRef: toExternalRef(r.teams.home.id),
      awayTeamExternalRef: toExternalRef(r.teams.away.id),
      kickoffAt: r.fixture.date,
      status: STATUS_MAP[r.fixture.status.short] ?? "SCHEDULED",
      minute: r.fixture.status.elapsed ?? undefined,
      homeScore: r.goals.home ?? undefined,
      awayScore: r.goals.away ?? undefined,
    };
  }

  private mapMatchEvent(raw: unknown, matchExternalId: string, seq: number): CanonicalMatchEvent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify, xem TODO ở đầu file
    const r = raw as Record<string, any>;
    return {
      matchExternalRef: toExternalRef(matchExternalId),
      seq,
      minute: r.time.elapsed,
      type: this.mapEventType(r.type, r.detail),
      teamExternalRef: r.team?.id ? toExternalRef(r.team.id) : undefined,
      playerExternalRef: r.player?.id ? toExternalRef(r.player.id) : undefined,
      relatedPlayerExternalRef: r.assist?.id ? toExternalRef(r.assist.id) : undefined,
    };
  }

  private mapEventType(type: string, detail: string): CanonicalMatchEvent["type"] {
    if (type === "Goal") return detail === "Own Goal" ? "OWN_GOAL" : "GOAL";
    if (type === "Card") return detail === "Red Card" ? "RED_CARD" : "YELLOW_CARD";
    if (type === "subst") return "SUBSTITUTION";
    return "VAR";
  }

  private mapStandingRow(raw: unknown, seasonExternalRef: ExternalRef): CanonicalStandingRow {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật của api-football chưa verify, xem TODO ở đầu file
    const r = raw as Record<string, any>;
    return {
      seasonExternalRef,
      teamExternalRef: toExternalRef(r.team.id),
      position: r.rank,
      played: r.all.played,
      win: r.all.win,
      draw: r.all.draw,
      loss: r.all.lose,
      gf: r.all.goals.for,
      ga: r.all.goals.against,
      points: r.points,
    };
  }
}
