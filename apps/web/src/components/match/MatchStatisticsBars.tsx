import type { MatchStatisticsResponse } from "@/lib/types";

export interface MatchStatisticsBarsProps {
  statistics: MatchStatisticsResponse;
}

// Sofascore's raw shape thật (xem apps/scraper-sofascore/scraper.py's map_statistics) — home/away
// lưu CÙNG 1 object raw (mỗi item đã có sẵn cả homeValue/awayValue), chỉ cần đọc từ 1 bên.
interface SofascoreStatItem {
  name?: unknown;
  homeValue?: unknown;
  awayValue?: unknown;
}
interface SofascoreStatGroup {
  groupName?: unknown;
  statisticsItems?: unknown;
}
interface SofascoreStatsRaw {
  groups?: unknown;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function StatBar({ name, homeValue, awayValue }: { name: string; homeValue: number; awayValue: number }) {
  const total = homeValue + awayValue;
  const homePercent = total > 0 ? (homeValue / total) * 100 : 50;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{homeValue}</span>
        <span>{name}</span>
        <span>{awayValue}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="bg-blue-500" style={{ width: `${homePercent}%` }} />
        <div className="bg-red-500" style={{ width: `${100 - homePercent}%` }} />
      </div>
    </div>
  );
}

/**
 * Server Component — render generic theo `raw.groups[].statisticsItems[]` (name/homeValue/
 * awayValue), KHÔNG hardcode theo field đã model hoá của MatchStatistic (shotsOnGoal/corners/
 * fouls/offsides hầu hết `null` trong data thật, xem CLAUDE.md § Scraper). Cách này tự động hiện
 * đúng những gì Sofascore thực sự trả cho từng trận.
 */
export function MatchStatisticsBars({ statistics }: MatchStatisticsBarsProps) {
  const raw = (statistics.home?.raw ?? statistics.away?.raw) as SofascoreStatsRaw | null | undefined;
  const groups = Array.isArray(raw?.groups) ? (raw.groups as SofascoreStatGroup[]) : [];

  if (groups.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Chưa có dữ liệu thống kê trận đấu.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group, groupIndex) => {
        const items = Array.isArray(group.statisticsItems)
          ? (group.statisticsItems as SofascoreStatItem[])
          : [];
        const validItems = items.filter(
          (item): item is { name: string; homeValue: number; awayValue: number } =>
            typeof item.name === "string" && isFiniteNumber(item.homeValue) && isFiniteNumber(item.awayValue),
        );
        if (validItems.length === 0) return null;

        return (
          <div key={groupIndex} className="flex flex-col gap-3">
            {typeof group.groupName === "string" ? (
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{group.groupName}</h3>
            ) : null}
            {validItems.map((item) => (
              <StatBar key={item.name} name={item.name} homeValue={item.homeValue} awayValue={item.awayValue} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
