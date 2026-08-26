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

// 7 loại data — KHÔNG kèm "commentary"/"odds" (khác 9 loại đầy đủ ở apps/api/src/
// scraper-competitions.ts's SCRAPER_DATA_TYPES, dùng cho pipeline admin trigger tay). Quyết định
// (2026-08-25): bỏ auto-fetch odds cho match LIVE (feature cũ, xem git history's live-odds.ts —
// 181/181 lần thử thất bại thật trên Render, ConnectionError khi gọi Sofascore, nghi IP datacenter
// bị chặn khác IP nhà — xem SystemLog trước lúc bị xoá cho chi tiết) — đổi qua scrape 1 LẦN DUY
// NHẤT ngay khi match chuyển FINISHED, không cần data theo thời gian thực (khác odds, cần cập
// nhật liên tục trong lúc đá) nên không có nhu cầu retry liên tục nếu Sofascore tạm không tới được.
const MATCH_LEVEL_DATA_TYPES = [
  "events",
  "lineups",
  "statistics",
  "shotmap",
  "highlights",
  "averagePositions",
  "momentum",
];

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

interface FinishedMatchInfo {
  id: string;
  competitionId: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
}

async function loadRoster(teamId: string) {
  return prisma.player.findMany({ where: { teamId }, select: { id: true, name: true } });
}

// spawn() đơn giản hoá — KHÔNG import apps/api/src/process-runner.ts (cross-app, xem CLAUDE.md).
// Chỉ cần spawn + đợi exit + gom stderr, không cần timeout/kill phức tạp như bên đó (1 match/lần
// gọi, không có batch lớn như scraper admin).
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

// Gọi ĐÚNG 1 LẦN khi match VỪA chuyển sang FINISHED (từ cả sync-live-matches.ts's applyMatchUpdate
// VÀ sync-catalog.ts's syncMatches(), cùng guard "status !== FINISHED && m.status === FINISHED" ở
// cả 2 nơi — không cần throttle Map riêng ở đây vì bản chất chỉ trigger 1 lần/match, khác hẳn
// live-odds.ts cũ (mỗi tick trong lúc LIVE, cần throttle để không gọi liên tục). Tự build manifest
// 1 match trong memory (không cần bước generate-sofascore-manifest.ts riêng), spawn scraper.py
// (đã bundle sẵn trong Docker image, xem Dockerfile), rồi ingest trực tiếp qua
// ingestSofascoreOutputs() (cùng process, cùng app — không duplicate logic upsert). CHỈ chạy khi
// SOFASCORE_SCRAPE_ENABLED=true (deploy Render mới có Python/TLS binary bundle sẵn — local dev/
// docker-compose KHÔNG set biến này, tự skip, không throw lỗi Python-not-found mỗi lần match
// FINISHED). Thất bại (Sofascore không tới được, tên đội không khớp game_id...) KHÔNG retry tự
// động — admin có thể tự backfill tay qua /admin/scraper nếu cần.
export async function scrapeMatchDetailsIfNeeded(match: FinishedMatchInfo): Promise<void> {
  if (process.env.SOFASCORE_SCRAPE_ENABLED !== "true") return;

  const [competition, season, homeTeam, awayTeam, homeRoster, awayRoster] = await Promise.all([
    prisma.competition.findUniqueOrThrow({ where: { id: match.competitionId } }),
    prisma.season.findUniqueOrThrow({ where: { id: match.seasonId } }),
    prisma.team.findUniqueOrThrow({ where: { id: match.homeTeamId } }),
    prisma.team.findUniqueOrThrow({ where: { id: match.awayTeamId } }),
    loadRoster(match.homeTeamId),
    loadRoster(match.awayTeamId),
  ]);

  const externalRefId = readExternalRefId(competition.externalRef);
  const sofascoreKey = externalRefId ? SOFASCORE_COMPETITIONS[externalRefId] : undefined;
  if (!sofascoreKey) return; // Giải không có Sofascore support (vd Champions League) — bỏ qua, không phải lỗi.

  const workDir = mkdtempSync(join(tmpdir(), "sofascore-match-"));
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
          homeRoster,
          awayRoster,
        },
      ],
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await runPython([
      "scraper/scraper.py",
      manifestPath,
      outputDir,
      "--data-types",
      MATCH_LEVEL_DATA_TYPES.join(","),
    ]);
    if (result.code !== 0) {
      // stderr đầy đủ đi vào `detail` (Json field, không bị cắt) — KHÔNG dồn vào message (chỉ
      // 2000 ký tự, xem logger.ts's logError). Bug thật đã gặp ở live-odds.ts cũ (2026-08-25):
      // soccerdata's _download_and_save() retry 5 lần, log lỗi thật (TLS/403/timeout...) qua
      // logger.exception ở MỖI lần retry rồi mới raise 1 ConnectionError chung — cắt
      // stderr.slice(-1000) (giữ ĐUÔI) chỉ còn lại wrapper vô nghĩa, mất hết traceback thật ở đầu.
      // Xem đầy đủ qua "Xem thêm" ở /admin/system-logs.
      void logError(
        `scrapeMatchDetailsIfNeeded: scraper.py thất bại cho match ${match.id} (exit ${result.code})`,
        result.stderr,
      );
      return;
    }

    if (readdirSync(outputDir).length === 0) return;
    const summary = await ingestSofascoreOutputs(outputDir);
    console.log(`scrapeMatchDetailsIfNeeded: match ${match.id} — ${JSON.stringify(summary)}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
