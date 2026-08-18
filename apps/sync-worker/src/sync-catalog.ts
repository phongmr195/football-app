import type { DataProviderAdapter, ExternalRef } from "@football-app/data-provider";
import { prisma } from "@football-app/database";
import { generateMatchSummaryIfNeeded } from "./match-summary";

// Thứ tự phụ thuộc bắt buộc: syncCompetitions -> syncSeasons -> syncTeams -> syncPlayers,
// syncStandings/syncMatches cần competition+season đã sync, syncMatches cần team đã sync.
// Đây là "cron đơn giản" cho Phase 1 (ROADMAP) — chưa cần Step Functions/adaptive polling.

// Luôn filter theo CẢ provider VÀ id — 2 provider khác nhau có thể trùng id số (vd api-football
// id "39" vs football-data.org id "39" là 2 giải khác nhau). Filter chỉ theo id có thể match nhầm
// row của provider khác, silently corrupt/overwrite data (xem migration
// 20260814000000_add_external_ref_provider_id_unique_index cho DB-level safety net tương ứng).
async function findCompetitionByExternalId(provider: string, externalId: string) {
  return prisma.competition.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: provider } },
        { externalRef: { path: ["id"], equals: externalId } },
      ],
    },
  });
}

async function findTeamByExternalId(provider: string, externalId: string) {
  return prisma.team.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: provider } },
        { externalRef: { path: ["id"], equals: externalId } },
      ],
    },
  });
}

async function findPlayerByExternalId(provider: string, externalId: string) {
  return prisma.player.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: provider } },
        { externalRef: { path: ["id"], equals: externalId } },
      ],
    },
  });
}

export async function syncCompetitions(adapter: DataProviderAdapter) {
  const competitions = await adapter.fetchCompetitions();

  for (const c of competitions) {
    const existing = await findCompetitionByExternalId(adapter.providerName, c.externalRef.id);
    const data = {
      name: c.name,
      type: c.type,
      countryCode: c.countryCode,
      logoUrl: c.logoUrl,
      externalRef: c.externalRef as object,
    };
    if (existing) {
      await prisma.competition.update({ where: { id: existing.id }, data });
    } else {
      await prisma.competition.create({ data });
    }
  }

  return { syncedCount: competitions.length };
}

export async function syncSeasons(adapter: DataProviderAdapter, competitionExternalRef: ExternalRef) {
  const competition = await findCompetitionByExternalId(adapter.providerName, competitionExternalRef.id);
  if (!competition) {
    throw new Error(`competition chưa được sync: ${competitionExternalRef.id} — chạy syncCompetitions trước`);
  }

  const seasons = await adapter.fetchSeasons(competitionExternalRef);

  for (const s of seasons) {
    await prisma.season.upsert({
      where: { competitionId_name: { competitionId: competition.id, name: s.name } },
      create: {
        competitionId: competition.id,
        name: s.name,
        startDate: new Date(s.startDate),
        endDate: new Date(s.endDate),
        isCurrent: s.isCurrent,
      },
      update: {
        startDate: new Date(s.startDate),
        endDate: new Date(s.endDate),
        isCurrent: s.isCurrent,
      },
    });
  }

  return { syncedCount: seasons.length };
}

async function findSeason(provider: string, competitionExternalRef: ExternalRef, seasonExternalRef: ExternalRef) {
  const competition = await findCompetitionByExternalId(provider, competitionExternalRef.id);
  if (!competition) {
    throw new Error(`competition chưa được sync: ${competitionExternalRef.id} — chạy syncCompetitions trước`);
  }
  // seasonExternalRef.id === Season.name (năm), xem ghi chú trong packages/data-provider adapter
  const season = await prisma.season.findFirst({
    where: { competitionId: competition.id, name: seasonExternalRef.id },
  });
  if (!season) {
    throw new Error(`season chưa được sync: ${seasonExternalRef.id} — chạy syncSeasons trước`);
  }
  return { competition, season };
}

export async function syncTeams(
  adapter: DataProviderAdapter,
  competitionExternalRef: ExternalRef,
  seasonExternalRef: ExternalRef,
) {
  const teams = await adapter.fetchTeams(competitionExternalRef, seasonExternalRef);

  for (const t of teams) {
    const existing = await findTeamByExternalId(adapter.providerName, t.externalRef.id);
    const data = {
      name: t.name,
      shortName: t.shortName,
      logoUrl: t.logoUrl,
      countryCode: t.countryCode,
      founded: t.founded,
      externalRef: t.externalRef as object,
    };
    if (existing) {
      await prisma.team.update({ where: { id: existing.id }, data });
    } else {
      await prisma.team.create({ data });
    }
  }

  return { syncedCount: teams.length };
}

export async function syncPlayers(
  adapter: DataProviderAdapter,
  teamExternalRef: ExternalRef,
  seasonExternalRef: ExternalRef,
) {
  const team = await findTeamByExternalId(adapter.providerName, teamExternalRef.id);
  if (!team) {
    throw new Error(`team chưa được sync: ${teamExternalRef.id} — chạy syncTeams trước`);
  }

  const players = await adapter.fetchPlayers(teamExternalRef, seasonExternalRef);

  for (const p of players) {
    const existing = await findPlayerByExternalId(adapter.providerName, p.externalRef.id);
    const data = {
      name: p.name,
      dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : undefined,
      nationality: p.nationality,
      position: p.position,
      teamId: team.id,
      externalRef: p.externalRef as object,
    };
    if (existing) {
      await prisma.player.update({ where: { id: existing.id }, data });
    } else {
      await prisma.player.create({ data });
    }
  }

  return { syncedCount: players.length };
}

export async function syncStandings(
  adapter: DataProviderAdapter,
  competitionExternalRef: ExternalRef,
  seasonExternalRef: ExternalRef,
) {
  const { season } = await findSeason(adapter.providerName, competitionExternalRef, seasonExternalRef);
  const rows = await adapter.fetchStandings(competitionExternalRef, seasonExternalRef);

  let skipped = 0;
  for (const row of rows) {
    const team = await findTeamByExternalId(adapter.providerName, row.teamExternalRef.id);
    if (!team) {
      skipped++;
      continue; // team lạ (chưa sync) — bỏ qua, không chặn cả job
    }
    await prisma.standing.upsert({
      where: { seasonId_teamId: { seasonId: season.id, teamId: team.id } },
      create: {
        seasonId: season.id,
        teamId: team.id,
        position: row.position,
        played: row.played,
        win: row.win,
        draw: row.draw,
        loss: row.loss,
        gf: row.gf,
        ga: row.ga,
        gd: row.gf - row.ga,
        points: row.points,
      },
      update: {
        position: row.position,
        played: row.played,
        win: row.win,
        draw: row.draw,
        loss: row.loss,
        gf: row.gf,
        ga: row.ga,
        gd: row.gf - row.ga,
        points: row.points,
      },
    });
  }

  return { syncedCount: rows.length - skipped, skipped };
}

export async function syncMatches(
  adapter: DataProviderAdapter,
  competitionExternalRef: ExternalRef,
  seasonExternalRef: ExternalRef,
) {
  const { competition, season } = await findSeason(adapter.providerName, competitionExternalRef, seasonExternalRef);
  const matches = await adapter.fetchMatches(competitionExternalRef, seasonExternalRef);

  let skipped = 0;
  for (const m of matches) {
    const homeTeam = await findTeamByExternalId(adapter.providerName, m.homeTeamExternalRef.id);
    const awayTeam = await findTeamByExternalId(adapter.providerName, m.awayTeamExternalRef.id);
    if (!homeTeam || !awayTeam) {
      skipped++;
      continue; // team lạ (chưa sync) — bỏ qua, không chặn cả job
    }

    const existing = await prisma.match.findFirst({
      where: {
        AND: [
          { externalRef: { path: ["provider"], equals: adapter.providerName } },
          { externalRef: { path: ["id"], equals: m.externalRef.id } },
        ],
      },
    });
    const data = {
      competitionId: competition.id,
      seasonId: season.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoffAt: new Date(m.kickoffAt),
      status: m.status,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      externalRef: m.externalRef as object,
    };
    let matchId: string;
    if (existing) {
      await prisma.match.update({ where: { id: existing.id }, data });
      matchId = existing.id;
    } else {
      const created = await prisma.match.create({ data });
      matchId = created.id;
    }

    // Đường "chắc chắn" bắt transition sang FINISHED — xem ghi chú tương tự ở
    // sync-live-matches.ts (đường "nhanh"). syncMatches() re-sync định kỳ toàn bộ lịch mùa giải
    // nên chắc chắn bắt được match FINISHED kể cả khi sync-worker down lúc trận đấu diễn ra.
    // generateMatchSummaryIfNeeded tự idempotent, an toàn khi cả 2 đường cùng trigger. KHÔNG await.
    if (existing?.status !== "FINISHED" && m.status === "FINISHED") {
      void generateMatchSummaryIfNeeded(matchId).catch((err) => {
        console.error(`syncMatches: generateMatchSummaryIfNeeded thất bại cho match ${matchId}`, err);
      });
    }
  }

  return { syncedCount: matches.length - skipped, skipped };
}

// Nguồn cho TopScorer/TopAssist/PlayerStatistics(appearances,goals,assists) — 1 request
// (adapter.fetchTopScorers) trả cả goals lẫn assists nên derive được cả 2 bảng xếp hạng từ cùng
// 1 tập dữ liệu. GIỚI HẠN ĐÃ BIẾT (xem football-data.adapter.ts's fetchTopScorers): đây là top-N
// theo GOALS (N=100), không phải bảng kiến tạo đầy đủ của giải — cầu thủ ghi ít bàn nhưng kiến
// tạo nhiều có thể bị thiếu khỏi TopAssist nếu không lọt top 100 scorers. Chấp nhận cho Phase 3
// MVP, football-data.org free tier không có endpoint assists riêng.
export async function syncTopScorers(
  adapter: DataProviderAdapter,
  competitionExternalRef: ExternalRef,
  seasonExternalRef: ExternalRef,
) {
  const { season } = await findSeason(adapter.providerName, competitionExternalRef, seasonExternalRef);
  const rows = await adapter.fetchTopScorers(competitionExternalRef, seasonExternalRef);

  let skipped = 0;
  const resolved: Array<{ playerId: string; playedMatches: number; goals: number; assists: number }> = [];
  for (const row of rows) {
    const player = await findPlayerByExternalId(adapter.providerName, row.playerExternalRef.id);
    const team = await findTeamByExternalId(adapter.providerName, row.teamExternalRef.id);
    if (!player || !team) {
      skipped++; // cầu thủ/team lạ (vd đã chuyển đi, chưa sync) — bỏ qua, không chặn cả job
      continue;
    }
    resolved.push({
      playerId: player.id,
      playedMatches: row.playedMatches,
      goals: row.goals,
      assists: row.assists,
    });

    await prisma.playerStatistics.upsert({
      where: { playerId_seasonId: { playerId: player.id, seasonId: season.id } },
      create: {
        playerId: player.id,
        seasonId: season.id,
        appearances: row.playedMatches,
        goals: row.goals,
        assists: row.assists,
      },
      update: { appearances: row.playedMatches, goals: row.goals, assists: row.assists },
    });
  }

  // adapter.fetchTopScorers đã trả sẵn theo goals desc, nhưng sort lại tường minh ở đây — không
  // phụ thuộc ngầm vào thứ tự của provider (adapter khác có thể trả thứ tự khác).
  const byGoals = [...resolved].sort((a, b) => b.goals - a.goals);
  for (let i = 0; i < byGoals.length; i++) {
    const row = byGoals[i]!;
    await prisma.topScorer.upsert({
      where: { seasonId_playerId: { seasonId: season.id, playerId: row.playerId } },
      create: { seasonId: season.id, playerId: row.playerId, goals: row.goals, rank: i + 1 },
      update: { goals: row.goals, rank: i + 1 },
    });
  }

  // Bỏ assists=0 khỏi bảng kiến tạo — không có giá trị xếp hạng.
  const byAssists = resolved.filter((r) => r.assists > 0).sort((a, b) => b.assists - a.assists);
  for (let i = 0; i < byAssists.length; i++) {
    const row = byAssists[i]!;
    await prisma.topAssist.upsert({
      where: { seasonId_playerId: { seasonId: season.id, playerId: row.playerId } },
      create: { seasonId: season.id, playerId: row.playerId, assists: row.assists, rank: i + 1 },
      update: { assists: row.assists, rank: i + 1 },
    });
  }

  return { syncedCount: resolved.length, skipped };
}

// Tính TeamStatistics + CleanSheet trực tiếp từ Match đã sync (KHÔNG cần gọi thêm provider nào)
// — mirror cách getRecentForm() (apps/api/src/routes/standings.ts) tính từ dữ liệu match có sẵn.
// yellowCards/redCards/minutesPlayed của PlayerStatistics KHÔNG tính được ở đây (cần dữ liệu
// match-event cấp độ cầu thủ, football-data.org free tier không có — xem CLAUDE.md/ROADMAP Phase
// 3), giữ mặc định 0 của schema thay vì suy đoán.
export async function syncTeamAggregates(seasonId: string) {
  const matches = await prisma.match.findMany({
    where: { seasonId, status: "FINISHED" },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });

  interface Agg {
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    cleanSheets: number;
  }
  const stats = new Map<string, Agg>();
  function ensure(teamId: string): Agg {
    let agg = stats.get(teamId);
    if (!agg) {
      agg = { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0 };
      stats.set(teamId, agg);
    }
    return agg;
  }

  for (const m of matches) {
    if (m.homeScore === null || m.awayScore === null) continue; // FINISHED nhưng thiếu tỉ số — dữ liệu bất thường, bỏ qua
    const home = ensure(m.homeTeamId);
    const away = ensure(m.awayTeamId);
    home.goalsFor += m.homeScore;
    home.goalsAgainst += m.awayScore;
    away.goalsFor += m.awayScore;
    away.goalsAgainst += m.homeScore;
    if (m.homeScore > m.awayScore) {
      home.wins++;
      away.losses++;
    } else if (m.homeScore < m.awayScore) {
      away.wins++;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
    }
    if (m.awayScore === 0) home.cleanSheets++;
    if (m.homeScore === 0) away.cleanSheets++;
  }

  for (const [teamId, s] of stats) {
    await prisma.teamStatistics.upsert({
      where: { teamId_seasonId: { teamId, seasonId } },
      create: { teamId, seasonId, ...s },
      update: { ...s },
    });
  }

  const ranked = [...stats.entries()]
    .filter(([, s]) => s.cleanSheets > 0)
    .sort((a, b) => b[1].cleanSheets - a[1].cleanSheets);
  for (let i = 0; i < ranked.length; i++) {
    const [teamId, s] = ranked[i]!;
    await prisma.cleanSheet.upsert({
      where: { seasonId_teamId: { seasonId, teamId } },
      create: { seasonId, teamId, count: s.cleanSheets, rank: i + 1 },
      update: { count: s.cleanSheets, rank: i + 1 },
    });
  }

  return { teamsProcessed: stats.size, cleanSheetTeams: ranked.length };
}

// Đồng bộ toàn bộ 1 giải đấu cho 1 season: teams -> players (từng team) -> standings + matches
// -> top scorers/assists + team/clean-sheet aggregates. Giả định syncCompetitions + syncSeasons
// đã chạy trước (competition/season đã có trong DB).
export async function syncCompetitionSeason(
  adapter: DataProviderAdapter,
  competitionExternalRef: ExternalRef,
  seasonExternalRef: ExternalRef,
) {
  const teamsResult = await syncTeams(adapter, competitionExternalRef, seasonExternalRef);

  const teams = await adapter.fetchTeams(competitionExternalRef, seasonExternalRef);
  let playersSynced = 0;
  for (const team of teams) {
    const result = await syncPlayers(adapter, team.externalRef, seasonExternalRef);
    playersSynced += result.syncedCount;
  }

  const standingsResult = await syncStandings(adapter, competitionExternalRef, seasonExternalRef);
  const matchesResult = await syncMatches(adapter, competitionExternalRef, seasonExternalRef);

  // Không phải adapter nào cũng có fetchTopScorers (vd ApiFootballAdapter hiện throw, xem
  // provider.interface.ts) — degrade gracefully, không chặn phần sync chính đã thành công ở trên.
  const topScorersResult = await syncTopScorers(adapter, competitionExternalRef, seasonExternalRef).catch(
    (err) => {
      console.warn(
        `syncTopScorers thất bại cho competition ${competitionExternalRef.id} season ${seasonExternalRef.id} (provider ${adapter.providerName}) — bỏ qua`,
        err,
      );
      return { syncedCount: 0, skipped: 0 };
    },
  );

  const { season } = await findSeason(adapter.providerName, competitionExternalRef, seasonExternalRef);
  const teamAggregatesResult = await syncTeamAggregates(season.id);

  return {
    teams: teamsResult.syncedCount,
    players: playersSynced,
    standings: standingsResult.syncedCount,
    matches: matchesResult.syncedCount,
    topScorers: topScorersResult.syncedCount,
    teamAggregates: teamAggregatesResult.teamsProcessed,
  };
}
