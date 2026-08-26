/**
 * Sinh manifest.json cho apps/scraper-sofascore/scraper.py — chạy:
 *   pnpm --filter @football-app/sync-worker generate-sofascore-manifest [--limit N] [--out path]
 *     [--competition-id id --season-id id --sofascore-key key --sofascore-season str]
 *
 * Mặc định (không truyền 4 flag mới) vẫn giữ hành vi cũ — chỉ scope Premier League, mùa giải
 * 2025-2026 — để lệnh CLI thủ công đã ghi trong README/CLAUDE.md không đổi. 4 flag mới cho phép
 * chọn giải/mùa khác (dùng bởi apps/api's scraper-orchestrator.ts khi admin trigger qua UI, xem
 * ROADMAP — trang admin Sofascore scraper) — truyền ID trực tiếp, bỏ qua lookup theo tên.
 * football-data.org đặt tên season theo NĂM BẮT ĐẦU (verify thật: season "2025" =
 * 2025-08-15 → 2026-05-24 = "mùa 2025-2026" thật, KHÔNG PHẢI season "2026" — season đó là
 * 2026-08-21 → 2027-05-30, mùa TIẾP THEO, dù được đánh dấu isCurrent=true tại thời điểm chạy).
 */
import "../load-env";
import { prisma } from "@football-app/database";
import { writeFileSync } from "node:fs";

const DEFAULT_COMPETITION_NAME = "Premier League";
const DEFAULT_SEASON_NAME = "2025";
const DEFAULT_SOFASCORE_COMPETITION_KEY = "ENG-Premier League";
const DEFAULT_SOFASCORE_SEASON = "2025-26";
const DEFAULT_LIMIT = 5;
const DEFAULT_OUT = "manifest.json";
// 3 loại cũ mặc định khi không truyền --data-types (CLI thủ công, khác trang admin luôn truyền
// đủ) — khớp DEFAULT_SCRAPER_DATA_TYPES ở apps/api/src/scraper-competitions.ts (không import
// chung được — 2 app riêng, xem CLAUDE.md § Scraper/AI về convention "duplicate nhỏ hơn coupling").
const DEFAULT_DATA_TYPES = ["events", "lineups", "statistics"];

// Mỗi loại data map tới 1 Prisma relation rỗng — dùng để lọc "match nào cần scrape CHO LOẠI NÀY".
// Key PHẢI khớp 9 giá trị ở SCRAPER_DATA_TYPES (apps/api/src/scraper-competitions.ts).
const NEEDS_SCRAPE_RELATION: Record<string, string> = {
  events: "events",
  lineups: "lineups",
  statistics: "statistics",
  commentary: "commentaries",
  shotmap: "shots",
  highlights: "highlights",
  averagePositions: "averagePositions",
  momentum: "momentum",
  odds: "odds",
};

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let out = DEFAULT_OUT;
  let competitionId: string | undefined;
  let seasonId: string | undefined;
  let sofascoreKey: string | undefined;
  let sofascoreSeason: string | undefined;
  let dataTypes = DEFAULT_DATA_TYPES;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = Number(args[++i]);
    if (args[i] === "--out") out = args[++i]!;
    if (args[i] === "--competition-id") competitionId = args[++i];
    if (args[i] === "--season-id") seasonId = args[++i];
    if (args[i] === "--sofascore-key") sofascoreKey = args[++i];
    if (args[i] === "--sofascore-season") sofascoreSeason = args[++i];
    if (args[i] === "--data-types") dataTypes = args[++i]!.split(",");
  }
  for (const type of dataTypes) {
    if (!(type in NEEDS_SCRAPE_RELATION)) {
      throw new Error(`--data-types chứa giá trị không hợp lệ: "${type}"`);
    }
  }
  return { limit, out, competitionId, seasonId, sofascoreKey, sofascoreSeason, dataTypes };
}

async function loadRoster(teamId: string) {
  const players = await prisma.player.findMany({ where: { teamId }, select: { id: true, name: true } });
  return players;
}

async function main() {
  const { limit, out, competitionId, seasonId, sofascoreKey, sofascoreSeason, dataTypes } = parseArgs();

  const competition = competitionId
    ? await prisma.competition.findUnique({ where: { id: competitionId } })
    : await prisma.competition.findFirst({
        where: { name: DEFAULT_COMPETITION_NAME, externalRef: { path: ["provider"], equals: "football-data" } },
      });
  if (!competition) throw new Error(`Không tìm thấy Competition (id=${competitionId ?? "default"})`);

  const season = seasonId
    ? await prisma.season.findUnique({ where: { id: seasonId } })
    : await prisma.season.findUnique({
        where: { competitionId_name: { competitionId: competition.id, name: DEFAULT_SEASON_NAME } },
      });
  if (!season) throw new Error(`Không tìm thấy Season (id=${seasonId ?? "default"})`);

  const resolvedSofascoreKey = sofascoreKey ?? DEFAULT_SOFASCORE_COMPETITION_KEY;
  const resolvedSofascoreSeason = sofascoreSeason ?? DEFAULT_SOFASCORE_SEASON;

  // "Match cần scrape" = FINISHED VÀ thiếu data cho ÍT NHẤT 1 loại đang được yêu cầu (OR) — KHÔNG
  // cố định theo `events` như trước (bug thật nếu giữ nguyên: admin chỉ chọn lại "shotmap" cho
  // match ĐÃ có `events` từ lần chạy trước sẽ không bao giờ được chọn, dù chưa hề có MatchShot).
  //
  // Ngoại lệ: chọn ĐÚNG 1 loại "odds" — verify thật 2026-08-22 (gọi trực tiếp Sofascore's
  // /event/{id}/odds/1/all cho 1 trận SCHEDULED thật) xác nhận odds pre-match có sẵn TRƯỚC khi đá,
  // không cần đợi FINISHED. Khác 9 loại còn lại, KHÔNG lọc theo "thiếu data" (odds.none) — cho
  // phép chạy lại nhiều lần để cập nhật tỉ lệ mới nhất, đúng ý định đã ghi sẵn ở
  // ingest-sofascore.ts's odds upsert ("odds hợp lệ để UPDATE lại khi re-scrape"). Sort theo
  // kickoffAt TĂNG dần (trận sắp đá sớm nhất trước) — ngược hướng "desc" (mới kết thúc trước) của
  // nhánh FINISHED. Chỉ áp dụng khi CHỌN DUY NHẤT odds — chọn kèm loại khác vẫn giữ hành vi cũ
  // (FINISHED-only), vì không có cách sort/limit kết hợp rõ nghĩa giữa 2 tập "sắp đá" và "mới đá
  // xong" trong 1 query.
  const isOddsOnly = dataTypes.length === 1 && dataTypes[0] === "odds";
  const matches = await prisma.match.findMany({
    where: isOddsOnly
      ? { competitionId: competition.id, seasonId: season.id, status: { in: ["SCHEDULED", "LIVE"] } }
      : {
          competitionId: competition.id,
          seasonId: season.id,
          status: "FINISHED",
          OR: dataTypes.map((type) => ({ [NEEDS_SCRAPE_RELATION[type]!]: { none: {} } })),
        },
    orderBy: { kickoffAt: isOddsOnly ? "asc" : "desc" },
    take: limit,
    include: { homeTeam: { select: { id: true, name: true } }, awayTeam: { select: { id: true, name: true } } },
  });

  console.log(`Tìm thấy ${matches.length} match cần scrape (limit=${limit}).`);

  const manifestMatches = await Promise.all(
    matches.map(async (match) => ({
      ourMatchId: match.id,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeTeamName: match.homeTeam.name,
      awayTeamName: match.awayTeam.name,
      kickoffAt: match.kickoffAt.toISOString(),
      homeRoster: await loadRoster(match.homeTeamId),
      awayRoster: await loadRoster(match.awayTeamId),
    })),
  );

  const manifest = {
    competitionKey: resolvedSofascoreKey,
    season: resolvedSofascoreSeason,
    matches: manifestMatches,
  };
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`Đã ghi ${out} (${manifestMatches.length} match).`);
}

// `process.exitCode` (KHÔNG `process.exit()`) — xem comment ở
// apps/sync-worker/src/scripts/ingest-player-season-stats.ts (cùng bug class).
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("generate-sofascore-manifest failed:", err);
    process.exitCode = 1;
  });
