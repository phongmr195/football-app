/**
 * Sinh manifest cho apps/scraper-sofascore/backfill-roster.py — chạy:
 *   pnpm --filter @football-app/sync-worker generate-roster-backfill-manifest -- \
 *     --competition-id id --season-id id --sofascore-key key --sofascore-season str [--out path]
 *
 * Chỉ chọn team CÓ THAM GIA competition/season này (qua Match) và roster ĐANG RỖNG (0 player) —
 * đây là gap-fill cho case football-data.org 403 khi lấy squad (team đã rời giải free-tier "hiện
 * tại" — verify thật 2026-08-19: Girona FC/RCD Mallorca/Real Oviedo, xem CLAUDE.md § Scraper),
 * KHÔNG phải nguồn thay thế football-data.org cho team đã có data.
 */
import { prisma } from "@football-app/database";
import { writeFileSync } from "node:fs";

const DEFAULT_OUT = "roster-manifest.json";

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

  const emptyTeams: { ourTeamId: string; teamName: string }[] = [];
  for (const [id, name] of teamsById) {
    const count = await prisma.player.count({ where: { teamId: id } });
    if (count === 0) emptyTeams.push({ ourTeamId: id, teamName: name });
  }

  console.log(`Tổng ${teamsById.size} team trong competition/season này, ${emptyTeams.length} team roster rỗng.`);

  const manifest = { competitionKey: sofascoreKey, season: sofascoreSeason, teams: emptyTeams };
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`Đã ghi ${out} (${emptyTeams.length} team).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("generate-roster-backfill-manifest failed:", err);
    process.exit(1);
  });
