import { formatMatchEventLabel } from "@/lib/format";
import type { MatchEvent } from "@/lib/types";

export interface MatchEventsTimelineProps {
  events: MatchEvent[];
}

/**
 * Server Component thuần (không polling) — khác `LiveMatchPanel`'s event list, vốn CHỈ hiện khi
 * match đang LIVE/HALFTIME (`if (!isLive) return null`). Match FINISHED (toàn bộ data scrape từ
 * Sofascore, xem apps/scraper-sofascore) không đi qua LiveMatchPanel nên cần 1 chỗ hiện event
 * timeline tĩnh riêng — data fetch 1 lần server-side ở page.tsx, không cần poll vì đã đông cứng.
 */
export function MatchEventsTimeline({ events }: MatchEventsTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Chưa có dữ liệu diễn biến trận đấu.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200"
        >
          <span className="w-8 shrink-0 text-zinc-500 dark:text-zinc-400">{event.minute}&apos;</span>
          <span>{formatMatchEventLabel(event)}</span>
        </li>
      ))}
    </ul>
  );
}
