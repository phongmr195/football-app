"use client";

import { Badge, type BadgeVariant } from "@football-app/ui";
import { estimateLiveMinute } from "@/lib/format";
import { useLiveMatches } from "@/lib/use-live-match";

export interface LiveStatusBadgeProps {
  matchId: string;
  label: string;
  variant: BadgeVariant;
  kickoffAt: string;
}

/**
 * Badge cho match LIVE/HALFTIME kèm số phút, dùng ở list `/matches` (Server Component, ISR —
 * không tự có số phút vì `Match` list response không kèm `LiveMatchState`). Tái dùng
 * `useLiveMatches()` (đã có sẵn cho `LiveMatchesTicker`, gọi `GET /matches/live` — Redis-cached
 * 5s TTL) thay vì tạo query riêng — React Query dedupe theo `queryKey` nên nhiều badge trên cùng
 * trang chỉ tốn 1 request, không nhân theo số trận LIVE hiện trên list.
 *
 * `label`/`variant` vẫn lấy từ data server render (giữ nguyên rủi ro staleness đã biết của ISR,
 * ngoài scope thay đổi ở đây) — chỉ THÊM số phút khi tìm thấy match này trong `/matches/live`,
 * không thay label/variant để tránh nhảy trạng thái ngược lại nếu response 2 nguồn lệch nhau.
 */
export function LiveStatusBadge({ matchId, label, variant, kickoffAt }: LiveStatusBadgeProps) {
  const { data: liveMatches } = useLiveMatches();
  const live = liveMatches?.find((m) => m.id === matchId);
  // Chỉ ước lượng khi provider không có minute thật VÀ status thật đang LIVE (không đoán trong
  // lúc HALFTIME — không biết break kéo dài bao lâu, xem estimateLiveMinute()).
  const minute =
    live?.liveState?.minute ?? (live?.liveState?.status === "LIVE" ? estimateLiveMinute(kickoffAt) : null);

  return <Badge variant={variant}>{minute !== null ? `${label} · ${minute}'` : label}</Badge>;
}
