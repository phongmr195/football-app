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

const PROVIDER_NAME = "football-data";
const BASE_URL = "https://api.football-data.org/v4";

// Xác nhận qua header response thật (2026-08): x-requests-available-minute (đếm ngược trong
// window hiện tại, max 10) — Free tier football-data.org giới hạn 10 request/phút, KHÔNG có
// giới hạn/ngày (khác hẳn API-Football, đây chính là lý do đổi provider — xem CLAUDE.md).
// Để margin an toàn còn 8/phút, cùng style với ApiFootballAdapter.
const REQUESTS_PER_MINUTE = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Xác nhận thật (2026-08, competition=2021 Premier League, season=2023, area=World Cup id=2000):
// mapCompetition/mapSeason/mapTeam/mapPlayer/mapMatch/mapStandingRow + STATUS_MAP đã verify với
// response thật. football-data.org KHÔNG có status "TIMED-vs-SCHEDULED" phân biệt rõ như tài liệu
// gợi ý — cả 2 đều xuất hiện thật trong dữ liệu tương lai (TIMED phổ biến hơn SCHEDULED). Các status
// IN_PLAY/PAUSED/SUSPENDED/AWARDED CHƯA gặp thật trong session này (không có trận nào đang live lúc
// verify) — map theo tài liệu, re-verify nếu sync-worker báo lỗi map lạ khi có trận live thật.
const STATUS_MAP: Record<string, CanonicalMatchStatus> = {
  SCHEDULED: "SCHEDULED",
  TIMED: "SCHEDULED",
  IN_PLAY: "LIVE",
  PAUSED: "HALFTIME",
  FINISHED: "FINISHED",
  POSTPONED: "POSTPONED",
  SUSPENDED: "POSTPONED",
  CANCELLED: "CANCELLED",
  AWARDED: "FINISHED", // trận xử thắng bằng walkover/forfeit — coi như đã kết thúc
};

function toExternalRef(id: string | number): ExternalRef {
  return { provider: PROVIDER_NAME, id: String(id) };
}

// Custom error giữ status HTTP thật — cần để fetchPlayers phân biệt được 403 "team đã rời khỏi
// free-tier competitions" (xem ghi chú ở fetchPlayers) khỏi các lỗi khác (401/404/500...).
class FootballDataRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FootballDataRequestError";
  }
}

// season.startDate luôn có dạng "YYYY-MM-DD" (verify thật) — lấy 4 ký tự đầu để ra năm bắt đầu
// season, KHÔNG dùng new Date().getFullYear() để tránh lệch do parse timezone.
function yearFromStartDate(startDate: string): string {
  return startDate.slice(0, 4);
}

export interface FootballDataAdapterOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  rateLimiter?: RateLimiter;
}

export class FootballDataAdapter implements DataProviderAdapter {
  readonly providerName = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly rateLimiter: RateLimiter;

  constructor(options: FootballDataAdapterOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.rateLimiter =
      options.rateLimiter ??
      new RateLimiter({ maxRequests: REQUESTS_PER_MINUTE, windowMs: RATE_LIMIT_WINDOW_MS });
  }

  private async request<T>(path: string, attempt = 1): Promise<T> {
    await this.rateLimiter.acquire();
    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
      headers: { "X-Auth-Token": this.apiKey },
    });

    if (res.status === 429) {
      // Vẫn có thể dính 429 dù đã throttle (ví dụ có process khác dùng chung key) — retry có
      // backoff, tối đa 3 lần, tôn trọng header Retry-After nếu provider trả về. CHƯA verify thật
      // shape của response 429 (không cố tình vượt quota để tránh tốn ngân sách/nguy cơ suspend
      // key) — retry logic mirror ApiFootballAdapter, coi là an toàn hợp lý.
      if (attempt > 3) {
        throw new Error(
          `football-data request failed: 429 (đã retry ${attempt - 1} lần) ${path}`,
        );
      }
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 10_000 * attempt;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return this.request<T>(path, attempt + 1);
    }

    if (!res.ok) {
      // Xác nhận thật (2026-08): football-data.org báo lỗi bằng HTTP status code thật (400 param/
      // token sai, 403 thiếu token/không đủ quyền, 404 không tồn tại...) kèm body JSON
      // { message, errorCode } — KHÔNG có quirk "HTTP 200 + errors trong body" như API-Football.
      let message = res.statusText;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        // body không phải JSON hợp lệ — giữ statusText
      }
      throw new FootballDataRequestError(
        `football-data request failed: ${res.status} ${message} ${path}`,
        res.status,
      );
    }

    return (await res.json()) as T;
  }

  async fetchCompetitions(): Promise<CanonicalCompetition[]> {
    const data = await this.request<{ competitions: unknown[] }>("/competitions");
    return data.competitions.map((raw) => this.mapCompetition(raw));
  }

  async fetchSeasons(competitionExternalRef: ExternalRef): Promise<CanonicalSeason[]> {
    const data = await this.request<{
      seasons: unknown[];
      currentSeason?: { id: number };
    }>(`/competitions/${competitionExternalRef.id}`);
    const currentSeasonId = data.currentSeason?.id;
    return (data.seasons ?? []).map((season) =>
      this.mapSeason(season as Record<string, unknown>, competitionExternalRef, currentSeasonId),
    );
  }

  async fetchTeams(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalTeam[]> {
    // Xác nhận thật (2026-08): /competitions/{id}/teams?season=<year> nhận năm dạng số thường
    // (KHÔNG phải season.id nội bộ của football-data.org) — cùng convention với /matches, xem
    // ghi chú season externalRef ở mapSeason.
    const data = await this.request<{ teams: unknown[] }>(
      `/competitions/${competitionExternalRef.id}/teams?season=${seasonExternalRef.id}`,
    );
    return data.teams.map((raw) => this.mapTeam(raw));
  }

  async fetchPlayers(
    teamExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalPlayer[]> {
    // Xác nhận thật (2026-08): /teams/{id}?season=<year> trả "squad" đã lọc theo season (verify:
    // không truyền season trả squad hiện tại khác số lượng/thứ tự so với truyền season=2023) — 1
    // request/team, KHÔNG cần phân trang (khác api-football phải phân trang /players).
    try {
      const data = await this.request<{ squad?: unknown[] }>(
        `/teams/${teamExternalRef.id}?season=${seasonExternalRef.id}`,
      );
      return (data.squad ?? []).map((raw) => this.mapPlayer(raw, teamExternalRef));
    } catch (err) {
      // BUG THẬT phát hiện qua sync thật (2026-08, Premier League season=2023, team=389 Luton
      // Town): /teams/{id} trả 403 cho team ĐÃ RỜI khỏi TOÀN BỘ 13 giải free-tier ở season HIỆN
      // TẠI (Luton hiện chỉ đá League One — không thuộc free tier), dù season lịch sử được truyền
      // vào (2023, khi Luton còn đá Premier League — nằm trong free tier) không liên quan. Nghĩa
      // là football-data.org gate quyền truy cập /teams/{id} theo giải đội đang đá BÂY GIỜ, không
      // theo season query param. Trả [] + log warn thay vì throw để không chặn cả job sync (các
      // team khác trong cùng competition/season vẫn hợp lệ) — sync-worker vẫn tiếp tục được với
      // squad rỗng cho riêng team này.
      if (err instanceof FootballDataRequestError && err.status === 403) {
        console.warn(
          `football-data: team ${teamExternalRef.id} trả 403 khi lấy squad (có thể đã rời khỏi mọi giải free-tier ở season hiện tại) — trả squad rỗng, không chặn job sync`,
        );
        return [];
      }
      throw err;
    }
  }

  async fetchMatches(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalMatch[]> {
    const data = await this.request<{ matches: unknown[] }>(
      `/competitions/${competitionExternalRef.id}/matches?season=${seasonExternalRef.id}`,
    );
    return data.matches.map((raw) => this.mapMatch(raw));
  }

  async fetchLiveMatches(): Promise<CanonicalMatch[]> {
    // /matches (không kèm competition) tự giới hạn theo các giải mà key hiện có quyền truy cập
    // (verify thật: resultSet.competitions trả về đúng các mã giải Free tier) — status=LIVE là
    // shorthand hợp lệ của provider (verify: trả HTTP 200 rỗng khi không có trận live, không 400).
    const data = await this.request<{ matches: unknown[] }>("/matches?status=LIVE");
    return data.matches.map((raw) => this.mapMatch(raw));
  }

  async fetchMatch(externalId: string): Promise<CanonicalMatch> {
    // Xác nhận thật (2026-08): /matches/{id} trả object match trực tiếp ở top-level, KHÔNG bọc
    // trong { matches: [...] } hay { response: [...] } như các endpoint danh sách.
    const data = await this.request<Record<string, unknown>>(`/matches/${externalId}`);
    return this.mapMatch(data);
  }

  async fetchMatchEvents(_externalId: string): Promise<CanonicalMatchEvent[]> {
    // Xác nhận thật (2026-08): GET /matches/{id} (free tier) KHÔNG trả timeline booking/goal chi
    // tiết (không có field "bookings"/"goals"/"lineup" như v2 API cũ) — đây là feature trả phí,
    // không chỉ là "chưa fully implement" như mapMatchEvent của ApiFootballAdapter. Throw rõ ràng
    // thay vì trả [] để tránh downstream hiểu lầm "trận này không có event nào".
    throw new Error(
      `football-data.org (free tier) không expose match events chi tiết — fixture ${_externalId}`,
    );
  }

  async fetchStandings(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalStandingRow[]> {
    const data = await this.request<{
      standings: Array<{ type: string; table: unknown[] }>;
    }>(`/competitions/${competitionExternalRef.id}/standings?season=${seasonExternalRef.id}`);
    // Xác nhận thật (2026-08, Premier League season=2023 VÀ Champions League group stage
    // season=2023): "standings" là mảng nhiều nhóm cùng dữ liệu nhưng khác "type"
    // (TOTAL/HOME/AWAY) — chỉ lấy nhóm "TOTAL" (tổng, không tách sân nhà/khách), nếu không sẽ
    // upsert đè standings TOTAL bằng số liệu HOME/AWAY (bug thật nếu không filter). Với giải có
    // vòng bảng (group stage), mỗi nhóm bảng có 1 entry "TOTAL" riêng — flatMap để lấy hết.
    const rows = data.standings.filter((s) => s.type === "TOTAL").flatMap((s) => s.table);
    return rows.map((raw) => this.mapStandingRow(raw, seasonExternalRef));
  }

  async fetchTopScorers(
    competitionExternalRef: ExternalRef,
    seasonExternalRef: ExternalRef,
  ): Promise<CanonicalTopScorerRow[]> {
    // Xác nhận thật (2026-08-17, Premier League id=2021, season=2025): /competitions/{id}/scorers
    // là endpoint FREE TIER thật (không phải feature trả phí như fetchMatchEvents ở trên) —
    // limit=100 trả đủ 100 dòng thật (không cap thấp hơn ngầm), sort sẵn theo goals desc. Mỗi
    // dòng có field "assists" thật (vd Haaland 27 goals/8 assists, verify thật) — đủ để derive cả
    // TopScorer LẪN TopAssist từ CÙNG 1 request, không cần gọi thêm endpoint nào khác.
    // GIỚI HẠN ĐÃ BIẾT: đây là top-N theo GOALS, không phải bảng kiến tạo đầy đủ của giải — 1
    // tiền vệ ghi ít bàn nhưng kiến tạo nhiều có thể không lọt top 100 scorers nên bị thiếu khỏi
    // TopAssist. Không có endpoint "assists" riêng trên free tier — chấp nhận cho Phase 3 MVP,
    // xem ghi chú ở sync-catalog.ts's syncTopScorers().
    const data = await this.request<{
      scorers: Array<{
        player: { id: number };
        team: { id: number };
        playedMatches: number;
        goals: number;
        assists: number | null;
      }>;
    }>(
      `/competitions/${competitionExternalRef.id}/scorers?season=${seasonExternalRef.id}&limit=100`,
    );
    return data.scorers.map((row) => ({
      seasonExternalRef,
      playerExternalRef: toExternalRef(row.player.id),
      teamExternalRef: toExternalRef(row.team.id),
      playedMatches: row.playedMatches,
      goals: row.goals,
      // Xác nhận thật: "assists" có thể là null (không phải 0) cho vài cầu thủ trong response —
      // coi null như 0 cho downstream, KHÔNG throw/skip dòng đó (goals vẫn hợp lệ để làm TopScorer).
      assists: row.assists ?? 0,
    }));
  }

  // ---- mapping: JSON thô của football-data.org -> canonical model ----

  private mapCompetition(raw: unknown): CanonicalCompetition {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật đã verify nhưng để linh hoạt như adapter khác
    const r = raw as Record<string, any>;
    // Xác nhận thật (2026-08, toàn bộ 13 giải Free tier): field "type" của football-data.org chỉ
    // có 2 giá trị "LEAGUE"|"CUP" — KHÔNG có giá trị riêng cho giải quốc tế (không giống
    // API-Football có country.name==="World"). area.code==="INT" CHỈ đúng cho FIFA World Cup
    // (area.name="World") — European Championship (id=2018) area.code là "EUR" (giống Champions
    // League, một giải CLB) nên vẫn map thành "CUP", KHÔNG "INTERNATIONAL". Đây là giới hạn đã
    // biết (không thể phân biệt giải đội tuyển quốc gia châu lục vs giải CLB châu lục chỉ từ shape
    // response này) — chấp nhận vì MVP tập trung giải quốc nội + Champions League, re-visit nếu
    // cần chính xác cho các giải đội tuyển.
    const isWorldCompetition = r.area?.code === "INT";
    return {
      externalRef: toExternalRef(r.id),
      name: r.name,
      type: isWorldCompetition ? "INTERNATIONAL" : r.type === "CUP" ? "CUP" : "LEAGUE",
      countryCode: r.area?.code ?? undefined,
      logoUrl: r.emblem ?? undefined,
    };
  }

  private mapSeason(
    raw: Record<string, unknown>,
    competitionExternalRef: ExternalRef,
    currentSeasonId: number | undefined,
  ): CanonicalSeason {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật đã verify nhưng để linh hoạt như adapter khác
    const r = raw as Record<string, any>;
    const year = yearFromStartDate(r.startDate);
    return {
      // QUYẾT ĐỊNH QUAN TRỌNG: externalRef.id = năm bắt đầu season (string), KHÔNG dùng
      // season.id nội bộ của football-data.org (ví dụ 1564 cho Premier League 2023/24) — để
      // tương thích với apps/sync-worker/src/sync-all.ts (seasonExternalRef.id = SYNC_SEASON_YEAR)
      // và sync-catalog.ts findSeason() (lookup theo Season.name = năm), xem CLAUDE.md/nhiệm vụ.
      externalRef: toExternalRef(year),
      competitionExternalRef,
      name: year,
      startDate: r.startDate,
      endDate: r.endDate,
      isCurrent: currentSeasonId !== undefined && r.id === currentSeasonId,
    };
  }

  private mapTeam(raw: unknown): CanonicalTeam {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật đã verify nhưng để linh hoạt như adapter khác
    const r = raw as Record<string, any>;
    return {
      externalRef: toExternalRef(r.id),
      name: r.name,
      shortName: r.shortName ?? r.tla ?? undefined,
      logoUrl: r.crest ?? undefined,
      countryCode: r.area?.code ?? undefined,
      founded: r.founded ?? undefined,
    };
  }

  private mapPlayer(raw: unknown, teamExternalRef: ExternalRef): CanonicalPlayer {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật đã verify nhưng để linh hoạt như adapter khác
    const r = raw as Record<string, any>;
    return {
      externalRef: toExternalRef(r.id),
      name: r.name,
      dateOfBirth: r.dateOfBirth ?? undefined,
      nationality: r.nationality ?? undefined,
      position: r.position ?? undefined,
      teamExternalRef,
    };
  }

  private mapMatch(raw: unknown): CanonicalMatch {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật đã verify nhưng để linh hoạt như adapter khác
    const r = raw as Record<string, any>;
    return {
      externalRef: toExternalRef(r.id),
      competitionExternalRef: toExternalRef(r.competition.id),
      // r.season.id là season id nội bộ football-data.org (khác năm) — dùng r.season.startDate để
      // ra externalRef năm, đúng convention đã chọn ở mapSeason (KHÔNG dùng r.season.id).
      seasonExternalRef: toExternalRef(yearFromStartDate(r.season.startDate)),
      homeTeamExternalRef: toExternalRef(r.homeTeam.id),
      awayTeamExternalRef: toExternalRef(r.awayTeam.id),
      kickoffAt: r.utcDate,
      status: STATUS_MAP[r.status] ?? "SCHEDULED",
      // football-data.org (free tier) không có field "minute"/"elapsed" riêng cho trận đang live
      // trong response đã verify (chỉ có status) — để undefined, CHƯA verify thật với trận live
      // (không có trận nào live lúc verify session này).
      minute: r.minute ?? undefined,
      homeScore: r.score?.fullTime?.home ?? undefined,
      awayScore: r.score?.fullTime?.away ?? undefined,
    };
  }

  private mapStandingRow(raw: unknown, seasonExternalRef: ExternalRef): CanonicalStandingRow {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape thật đã verify nhưng để linh hoạt như adapter khác
    const r = raw as Record<string, any>;
    return {
      seasonExternalRef,
      teamExternalRef: toExternalRef(r.team.id),
      position: r.position,
      played: r.playedGames,
      win: r.won,
      draw: r.draw,
      loss: r.lost,
      gf: r.goalsFor,
      ga: r.goalsAgainst,
      points: r.points,
    };
  }
}
