import type { DataProviderAdapter } from "../provider.interface";
import type {
  CanonicalCompetition,
  CanonicalMatch,
  CanonicalMatchEvent,
  CanonicalMatchStatus,
  CanonicalPlayer,
  CanonicalSeason,
  CanonicalStandingRow,
  CanonicalTeam,
  ExternalRef,
} from "../types";

const PROVIDER_NAME = "api-football";
const BASE_URL = "https://v3.football.api-sports.io";

// TODO: xác nhận lại chính xác field name theo response thật khi có API key test
// (docs API-Football có thể thay đổi theo thời gian) — mapping dưới đây là khung sườn,
// chưa verify với response thật.
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
}

export class ApiFootballAdapter implements DataProviderAdapter {
  readonly providerName = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiFootballAdapterOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
      headers: { "x-apisports-key": this.apiKey },
    });
    if (!res.ok) {
      throw new Error(`api-football request failed: ${res.status} ${path}`);
    }
    return res.json() as Promise<T>;
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
    // TODO: /players trả về phân trang (paging.total) — mới lấy trang 1, đủ cho squad
    // thông thường (~20-30 người/trang); cần lặp trang khi squad dài hơn 1 trang.
    const data = await this.request<{ response: unknown[] }>(
      `/players?team=${teamExternalRef.id}&season=${seasonExternalRef.id}`,
    );
    return data.response.map((raw) => this.mapPlayer(raw, teamExternalRef));
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
    // TODO: shape thật của /standings lồng nhau sâu hơn (response[0].league.standings[0] là mảng
    // hàng thật) — cần map lại khi test với response thật.
    return data.response.map((raw) => this.mapStandingRow(raw, seasonExternalRef));
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
