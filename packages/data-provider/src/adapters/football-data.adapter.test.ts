import { describe, expect, it, vi } from "vitest";
import { FootballDataAdapter } from "./football-data.adapter";
import { RateLimiter } from "../rate-limiter";

// fetchImpl giả — không gọi network thật. RateLimiter dùng maxRequests lớn để test không
// bị chờ (đã có test riêng cho logic throttle ở rate-limiter.test.ts).
function makeAdapter(
  responses: Array<{ status: number; body: Record<string, unknown> }>,
  rateLimiter?: RateLimiter,
) {
  let call = 0;
  const fetchImpl = (async () => {
    const entry = responses[call] ?? responses[responses.length - 1];
    if (!entry) throw new Error("makeAdapter: không có response nào được cấu hình");
    const { status, body } = entry;
    call++;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;

  return new FootballDataAdapter({
    apiKey: "test-key",
    fetchImpl,
    rateLimiter: rateLimiter ?? new RateLimiter({ maxRequests: 1000, windowMs: 1000 }),
  });
}

describe("FootballDataAdapter — xử lý lỗi qua HTTP status thật (khác api-football)", () => {
  it("không throw khi response HTTP 200 bình thường", async () => {
    const adapter = makeAdapter([{ status: 200, body: { competitions: [] } }]);
    await expect(adapter.fetchCompetitions()).resolves.toEqual([]);
  });

  it("throw kèm message thật trong body khi HTTP 400 (token/param sai)", async () => {
    const adapter = makeAdapter([
      { status: 400, body: { message: "Your API token is invalid.", errorCode: 400 } },
    ]);
    await expect(adapter.fetchCompetitions()).rejects.toThrow(/Your API token is invalid/);
  });

  it("throw kèm message thật trong body khi HTTP 403 (thiếu quyền/token)", async () => {
    const adapter = makeAdapter([
      {
        status: 403,
        body: {
          message: "The resource you are looking for is restricted.",
          errorCode: 403,
        },
      },
    ]);
    await expect(adapter.fetchCompetitions()).rejects.toThrow(/restricted/);
  });

  it("fallback dùng statusText nếu body không có field message", async () => {
    const adapter = makeAdapter([{ status: 500, body: {} }]);
    await expect(adapter.fetchCompetitions()).rejects.toThrow(/500/);
  });
});

describe("FootballDataAdapter — rate limiter", () => {
  it("gọi rateLimiter.acquire() trước mỗi request", async () => {
    const rateLimiter = new RateLimiter({ maxRequests: 1000, windowMs: 1000 });
    const acquireSpy = vi.spyOn(rateLimiter, "acquire");
    const adapter = makeAdapter([{ status: 200, body: { competitions: [] } }], rateLimiter);

    await adapter.fetchCompetitions();

    expect(acquireSpy).toHaveBeenCalledTimes(1);
  });

  it("gọi acquire() 1 lần cho mỗi request thật, không gộp nhiều request thành 1 lần acquire", async () => {
    const rateLimiter = new RateLimiter({ maxRequests: 1000, windowMs: 1000 });
    const acquireSpy = vi.spyOn(rateLimiter, "acquire");
    const adapter = makeAdapter(
      [
        { status: 200, body: { competitions: [] } },
        { status: 200, body: { seasons: [], currentSeason: { id: 1 } } },
      ],
      rateLimiter,
    );

    await adapter.fetchCompetitions();
    await adapter.fetchSeasons({ provider: "football-data", id: "2021" });

    expect(acquireSpy).toHaveBeenCalledTimes(2);
  });
});

describe("FootballDataAdapter — standings chỉ lấy nhóm TOTAL", () => {
  it("bỏ qua nhóm HOME/AWAY, chỉ map nhóm TOTAL (tránh đè standings tổng bằng số liệu sân nhà/khách)", async () => {
    const adapter = makeAdapter([
      {
        status: 200,
        body: {
          standings: [
            {
              type: "TOTAL",
              table: [
                {
                  position: 1,
                  team: { id: 65 },
                  playedGames: 38,
                  won: 28,
                  draw: 7,
                  lost: 3,
                  points: 91,
                  goalsFor: 96,
                  goalsAgainst: 34,
                },
              ],
            },
            {
              type: "HOME",
              table: [
                {
                  position: 1,
                  team: { id: 65 },
                  playedGames: 19,
                  won: 16,
                  draw: 2,
                  lost: 1,
                  points: 50,
                  goalsFor: 50,
                  goalsAgainst: 10,
                },
              ],
            },
          ],
        },
      },
    ]);

    const rows = await adapter.fetchStandings(
      { provider: "football-data", id: "2021" },
      { provider: "football-data", id: "2023" },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.points).toBe(91);
    expect(rows[0]?.played).toBe(38);
  });
});

describe("FootballDataAdapter — season externalRef dùng năm, không dùng season.id nội bộ", () => {
  it("mapSeason set externalRef.id = năm bắt đầu (startDate), không phải season.id", async () => {
    const adapter = makeAdapter([
      {
        status: 200,
        body: {
          seasons: [
            { id: 1564, startDate: "2023-08-11", endDate: "2024-05-19" },
            { id: 2502, startDate: "2026-08-21", endDate: "2027-05-30" },
          ],
          currentSeason: { id: 2502 },
        },
      },
    ]);

    const seasons = await adapter.fetchSeasons({ provider: "football-data", id: "2021" });

    expect(seasons).toHaveLength(2);
    expect(seasons[0]?.externalRef.id).toBe("2023");
    expect(seasons[0]?.isCurrent).toBe(false);
    expect(seasons[1]?.externalRef.id).toBe("2026");
    expect(seasons[1]?.isCurrent).toBe(true);
  });
});

describe("FootballDataAdapter — fetchMatchEvents chưa hỗ trợ ở free tier", () => {
  it("throw lỗi rõ ràng thay vì trả [] âm thầm", async () => {
    const adapter = makeAdapter([{ status: 200, body: {} }]);
    await expect(adapter.fetchMatchEvents("435943")).rejects.toThrow(/không expose/);
  });
});

describe("FootballDataAdapter — fetchPlayers: 403 (team rời khỏi free-tier competitions)", () => {
  it("bug thật phát hiện qua sync thật (Luton Town id=389): trả [] thay vì throw, không chặn cả job", async () => {
    const adapter = makeAdapter([
      {
        status: 403,
        body: {
          message: "The resource you are looking for is restricted and apparently not within your permissions. Please check your subscription.",
          errorCode: 403,
        },
      },
    ]);

    const players = await adapter.fetchPlayers(
      { provider: "football-data", id: "389" },
      { provider: "football-data", id: "2023" },
    );

    expect(players).toEqual([]);
  });

  it("lỗi 403 khác (không phải fetchPlayers) vẫn throw như bình thường", async () => {
    const adapter = makeAdapter([
      { status: 403, body: { message: "restricted", errorCode: 403 } },
    ]);
    await expect(adapter.fetchCompetitions()).rejects.toThrow(/restricted/);
  });
});

describe("FootballDataAdapter — fetchTopScorers (xác nhận thật 2026-08-17, Premier League id=2021 season=2025)", () => {
  it("map goals/assists thật, coi assists null như 0", async () => {
    const adapter = makeAdapter([
      {
        status: 200,
        body: {
          scorers: [
            {
              player: { id: 38101, name: "Erling Haaland" },
              team: { id: 65, name: "Manchester City FC" },
              playedMatches: 36,
              goals: 27,
              assists: 8,
              penalties: 3,
            },
            {
              // Xác nhận thật: field "assists" có thể null (không phải 0) cho vài cầu thủ
              player: { id: 12345, name: "Eli Kroupi" },
              team: { id: 402, name: "Brentford FC" },
              playedMatches: 20,
              goals: 13,
              assists: null,
              penalties: null,
            },
          ],
        },
      },
    ]);

    const rows = await adapter.fetchTopScorers(
      { provider: "football-data", id: "2021" },
      { provider: "football-data", id: "2025" },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      seasonExternalRef: { provider: "football-data", id: "2025" },
      playerExternalRef: { provider: "football-data", id: "38101" },
      teamExternalRef: { provider: "football-data", id: "65" },
      playedMatches: 36,
      goals: 27,
      assists: 8,
    });
    expect(rows[1]?.assists).toBe(0);
  });
});
