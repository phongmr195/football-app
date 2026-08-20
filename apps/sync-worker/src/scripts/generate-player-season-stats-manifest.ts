/**
 * Sinh manifest cho apps/scraper-sofascore/scrape-player-season-stats.py — chạy:
 *   pnpm --filter @football-app/sync-worker generate-player-season-stats-manifest -- \
 *     --competition-id id --season-id id --sofascore-key key --sofascore-season str [--out path]
 *
 * KHÁC generate-sofascore-manifest.ts (theo TỪNG match) — đây là 1 lần fetch DUY NHẤT cho cả
 * competition/season (Sofascore's /unique-tournament/{id}/season/{id}/top-players/overall, xem
 * CLAUDE.md § Scraper), nên cần roster ĐẦY ĐỦ CỦA MỌI team (không chỉ team roster rỗng như
 * generate-roster-backfill-manifest.ts) để so khớp tên cầu thủ theo đúng team Sofascore trả về.
 */
import { prisma } from "@football-app/database";
import { writeFileSync } from "node:fs";

const DEFAULT_OUT = "player-season-stats-manifest.json";

function parseArgs() {
  const args = process.argv.slice(2);
  let out = DEFAULT_OUT;
  let competitionId: string | undefined;
  let seasonId: string | undefined;
  let sofascoreKey: string | undefined;
  let sofascoreSeason: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i]!;
    if (args[i] === "--competition-id") competitionId = args[++i];
    if (args[i] === "--season-id") seasonId = args[++i];
    if (args[i] === "--sofascore-key") sofascoreKey = args[++i];
    if (args[i] === "--sofascore-season") sofascoreSeason = args[++i];
  }
  if (!competitionId || !seasonId || !sofascoreKey || !sofascoreSeason) {
    throw new Error(
      "Thiếu tham số bắt buộc: --competition-id --season-id --sofascore-key --sofascore-season",
    );
  }
  return { out, competitionId, seasonId, sofascoreKey, sofascoreSeason };
}

async function main() {
  const { out, competitionId, seasonId, sofascoreKey, sofascoreSeason } = parseArgs();

  const matches = await prisma.match.findMany({
    where: { competitionId, seasonId },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { id: true, name: true } },
      awayTeam: { select: { id: true, name: true } },
    },
  });

  const teamsById = new Map<string, string>();
  for (const m of matches) {
    teamsById.set(m.homeTeamId, m.homeTeam.name);
    teamsById.set(m.awayTeamId, m.awayTeam.name);
  }

  const teams = await Promise.all(
    [...teamsById].map(async ([id, name]) => ({
      teamId: id,
      teamName: name,
      roster: await prisma.player.findMany({ where: { teamId: id }, select: { id: true, name: true } }),
    })),
  );

  console.log(`Sinh manifest cho ${teams.length} team (season ${seasonId}).`);

  const manifest = { competitionKey: sofascoreKey, season: sofascoreSeason, seasonId, teams };
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`Đã ghi ${out}.`);
}

// `process.exitCode` (KHÔNG `process.exit()`) — xem comment ở
// apps/sync-worker/src/scripts/ingest-player-season-stats.ts (cùng bug class).
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("generate-player-season-stats-manifest failed:", err);
    process.exitCode = 1;
  });
