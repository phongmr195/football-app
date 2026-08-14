import type { DataProviderAdapter, ExternalRef } from "@football-app/data-provider";
import { prisma } from "@football-app/database";

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
    if (existing) {
      await prisma.match.update({ where: { id: existing.id }, data });
    } else {
      await prisma.match.create({ data });
    }
  }

  return { syncedCount: matches.length - skipped, skipped };
}

// Đồng bộ toàn bộ 1 giải đấu cho 1 season: teams -> players (từng team) -> standings + matches.
// Giả định syncCompetitions + syncSeasons đã chạy trước (competition/season đã có trong DB).
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

  return {
    teams: teamsResult.syncedCount,
    players: playersSynced,
    standings: standingsResult.syncedCount,
    matches: matchesResult.syncedCount,
  };
}
