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
import { prisma } from "@football-app/database";
import { writeFileSync } from "node:fs";

const DEFAULT_COMPETITION_NAME = "Premier League";
const DEFAULT_SEASON_NAME = "2025";
const DEFAULT_SOFASCORE_COMPETITION_KEY = "ENG-Premier League";
const DEFAULT_SOFASCORE_SEASON = "2025-26";
const DEFAULT_LIMIT = 5;
const DEFAULT_OUT = "manifest.json";

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let out = DEFAULT_OUT;
  let competitionId: string | undefined;
  let seasonId: string | undefined;
  let sofascoreKey: string | undefined;
  let sofascoreSeason: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = Number(args[++i]);
    if (args[i] === "--out") out = args[++i]!;
    if (args[i] === "--competition-id") competitionId = args[++i];
    if (args[i] === "--season-id") seasonId = args[++i];
    if (args[i] === "--sofascore-key") sofascoreKey = args[++i];
    if (args[i] === "--sofascore-season") sofascoreSeason = args[++i];
  }
  return { limit, out, competitionId, seasonId, sofascoreKey, sofascoreSeason };
}

async function loadRoster(teamId: string) {
  const players = await prisma.player.findMany({ where: { teamId }, select: { id: true, name: true } });
  return players;
}

async function main() {
  const { limit, out, competitionId, seasonId, sofascoreKey, sofascoreSeason } = parseArgs();

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

  // Match FINISHED chưa có MatchEvent nào — coi là "chưa scrape Sofascore", tránh sinh lại manifest
  // cho match đã ingest xong ở lần chạy trước.
  const matches = await prisma.match.findMany({
    where: { competitionId: competition.id, seasonId: season.id, status: "FINISHED", events: { none: {} } },
    orderBy: { kickoffAt: "desc" },
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

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("generate-sofascore-manifest failed:", err);
    process.exit(1);
  });
