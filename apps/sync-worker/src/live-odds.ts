import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@football-app/database";
import { ingestSofascoreOutputs } from "./ingest-sofascore";
import { logError } from "./logger";

// Duplicate của apps/api/src/scraper-competitions.ts's SCRAPER_COMPETITIONS — apps/api và
// apps/sync-worker không import code qua lại (2 app riêng, xem CLAUDE.md § Scraper). CHỈ 5 giải
// quốc gia Sofascore/soccerdata hỗ trợ thật (không có Champions League) — match thuộc giải khác
// tự bỏ qua, không phải lỗi.
const SOFASCORE_COMPETITIONS: Record<string, string> = {
  "2021": "ENG-Premier League",
  "2014": "ESP-La Liga",
  "2002": "GER-Bundesliga",
  "2019": "ITA-Serie A",
  "2015": "FRA-Ligue 1",
};

// football-data.org đặt tên season theo NĂM BẮT ĐẦU ("2025") — soccerdata cần "2025-26". Duplicate
// của scraper-competitions.ts's toSofascoreSeasonString(), cùng lý do trên.
function toSofascoreSeasonString(dbSeasonName: string): string {
  const startYear = Number(dbSeasonName);
  const endYearShort = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${dbSeasonName}-${endYearShort}`;
}

export function readExternalRefId(externalRef: unknown): string | null {
  if (typeof externalRef !== "object" || externalRef === null) return null;
  const id = (externalRef as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

// Throttle trong memory — KHÔNG cần bảng DB riêng để track "lần cuối fetch" (MatchOdds không có
// cột timestamp, xem packages/database/prisma/schema.prisma). Reset khi process restart — chấp
// nhận được, tệ nhất chỉ tốn 1 lần fetch thừa ngay sau redeploy.
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const lastFetchedAt = new Map<string, number>();

interface LiveMatchInfo {
  id: string;
  competitionId: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
}

// spawn() đơn giản hoá — KHÔNG import apps/api/src/process-runner.ts (cross-app, xem CLAUDE.md).
// Chỉ cần spawn + đợi exit + gom stderr, không cần timeout/kill phức tạp như bên đó (odds chỉ 1
// request/match, không có batch lớn như scraper admin).
function runPython(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", args);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => resolve({ code: null, stderr: `spawn error: ${err.message}` }));
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

// Gọi khi sync-live-matches.ts phát hiện match đang LIVE/HALFTIME — tự build manifest 1 match
// (không cần bước generate-sofascore-manifest.ts riêng, đã có đủ thông tin trong tay), spawn
// scraper.py --data-types odds (đã bundle sẵn trong Docker image, xem Dockerfile), rồi ingest
// trực tiếp qua ingestSofascoreOutputs() (cùng process, cùng app — không duplicate logic upsert).
// CHỈ chạy khi LIVE_ODDS_ENABLED=true (deploy Render mới có Python/TLS binary bundle sẵn — local
// dev/docker-compose KHÔNG set biến này, tự skip, không throw lỗi Python-not-found mỗi tick).
export async function refreshLiveOddsIfNeeded(match: LiveMatchInfo): Promise<void> {
  if (process.env.LIVE_ODDS_ENABLED !== "true") return;

  const last = lastFetchedAt.get(match.id);
  if (last && Date.now() - last < REFRESH_INTERVAL_MS) return;

  const [competition, season, homeTeam, awayTeam] = await Promise.all([
    prisma.competition.findUniqueOrThrow({ where: { id: match.competitionId } }),
    prisma.season.findUniqueOrThrow({ where: { id: match.seasonId } }),
    prisma.team.findUniqueOrThrow({ where: { id: match.homeTeamId } }),
    prisma.team.findUniqueOrThrow({ where: { id: match.awayTeamId } }),
  ]);

  const externalRefId = readExternalRefId(competition.externalRef);
  const sofascoreKey = externalRefId ? SOFASCORE_COMPETITIONS[externalRefId] : undefined;
  if (!sofascoreKey) return; // Giải không có Sofascore support (vd Champions League) — bỏ qua, không phải lỗi.

  lastFetchedAt.set(match.id, Date.now());

  const workDir = mkdtempSync(join(tmpdir(), "live-odds-"));
  const manifestPath = join(workDir, "manifest.json");
  const outputDir = join(workDir, "output");
  try {
    const manifest = {
      competitionKey: sofascoreKey,
      season: toSofascoreSeasonString(season.name),
      matches: [
        {
          ourMatchId: match.id,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          homeTeamName: homeTeam.name,
          awayTeamName: awayTeam.name,
          kickoffAt: new Date().toISOString(),
          homeRoster: [],
          awayRoster: [],
        },
      ],
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await runPython(["scraper/scraper.py", manifestPath, outputDir, "--data-types", "odds"]);
    if (result.code !== 0) {
      void logError(`refreshLiveOddsIfNeeded: scraper.py thất bại cho match ${match.id} (exit ${result.code}): ${result.stderr.slice(-1000)}`);
      return;
    }

    if (readdirSync(outputDir).length === 0) return;
    const summary = await ingestSofascoreOutputs(outputDir);
    console.log(`refreshLiveOddsIfNeeded: match ${match.id} — oddsUpserted=${summary.oddsUpserted}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
