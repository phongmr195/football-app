import type { DataProviderAdapter } from "../provider.interface";
import type {
  CanonicalMatch,
  CanonicalMatchEvent,
  CanonicalMatchStatus,
  CanonicalStandingRow,
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

  async fetchStandings(seasonExternalRef: ExternalRef): Promise<CanonicalStandingRow[]> {
    const data = await this.request<{ response: unknown[] }>(
      `/standings?season=${seasonExternalRef.id}`,
    );
    // TODO: shape thật của /standings lồng nhau sâu hơn — cần map lại khi test với response thật
    return data.response.map((raw) => this.mapStandingRow(raw, seasonExternalRef));
  }

  // ---- mapping: JSON thô của api-football -> canonical model ----

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
