import { prisma } from "@football-app/database";

export interface ComputeNextIntervalOptions {
  tightIntervalMs?: number;
  idleIntervalMs?: number;
  lookaheadMinutes?: number;
}

// Adaptive polling (Phase 2 Bước 4) — thay EventBridge/Step Functions bằng logic in-process, chạy
// hoàn toàn bằng query DB nội bộ, không phụ thuộc provider API nào cho "sắp diễn ra" (xem plan
// Phase 2 Bước 3+4 § B1). Dùng @@index([status, kickoffAt]) đã có sẵn trên Match, select: { id:
// true } để rẻ nhất (exists-check, không load cả row).
//
// Giá trị cụ thể (so với rate limit self-cap 8 req/phút, hard cap thật 10 req/phút của cả 2
// adapter, xem CLAUDE.md § Data provider):
// - Tight: 15s (4 req/phút) khi có trận LIVE/HALFTIME hoặc SCHEDULED sắp kickoff trong
//   lookaheadMinutes tới — nhanh gấp đôi cadence cố định hiện tại (30s), vẫn dư margin.
// - Idle: 5 phút (0.2 req/phút) khi không có gì gần — poll nhanh lúc idle cũng không lấy được gì
//   mới, 5 phút đủ để "thức dậy" đúng lúc trận vào lookahead window.
export async function computeNextInterval({
  tightIntervalMs = 15_000,
  idleIntervalMs = 300_000,
  lookaheadMinutes = 15,
}: ComputeNextIntervalOptions = {}): Promise<number> {
  const now = new Date();
  const nearMatch = await prisma.match.findFirst({
    where: {
      OR: [
        { status: "LIVE" },
        { status: "HALFTIME" },
        {
          status: "SCHEDULED",
          kickoffAt: { gte: now, lte: new Date(now.getTime() + lookaheadMinutes * 60_000) },
        },
      ],
    },
    select: { id: true },
  });

  return nearMatch ? tightIntervalMs : idleIntervalMs;
}
