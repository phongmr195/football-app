"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGetClient } from "@/lib/api-client";
import type { MatchOddsResponse, PrimaryOdds } from "@/lib/types";
import { MatchOdds } from "./MatchOdds";

export interface MatchOddsPreviewProps {
  matchId: string;
  primaryOdds: PrimaryOdds;
}

/**
 * 1 dòng preview (Chủ nhà/Hòa/Khách, decimal) + nút "Xem thêm" mở popup hiện đầy đủ market —
 * dùng chung ở mọi block hiện match sắp diễn ra/đang live (UpcomingMatchesBlock, LiveMatchesTicker,
 * matches/page.tsx). Luôn nằm trong 1 <Card> có sẵn <Link> khác cho phần tên đội/giờ đá — nút Xem
 * thêm PHẢI stopPropagation + preventDefault để không kích hoạt Link cha khi bấm.
 *
 * Data đầy đủ (GET /matches/:id/odds) chỉ fetch LẦN ĐẦU mở popup (query `enabled` theo `open`,
 * không tải trước cho mọi match trong list — primaryOdds (1 con số/bên) đã đủ cho dòng preview).
 */
export function MatchOddsPreview({ matchId, primaryOdds }: MatchOddsPreviewProps) {
  const [open, setOpen] = useState(false);

  const fullOddsQuery = useQuery({
    queryKey: ["match-odds", matchId],
    queryFn: () => apiGetClient<MatchOddsResponse>(`/matches/${matchId}/odds`),
    enabled: open,
  });

  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-2 py-1.5 text-xs dark:bg-zinc-900"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="flex gap-3 text-zinc-600 dark:text-zinc-300">
        <span>1: {primaryOdds.home.toFixed(2)}</span>
        <span>X: {primaryOdds.draw.toFixed(2)}</span>
        <span>2: {primaryOdds.away.toFixed(2)}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Xem thêm
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Nhiều trận có 15-17 market — không giới hạn chiều cao thì popup tràn khỏi viewport
            (dialog mặc định canh giữa dọc, không tự cap height). max-h + overflow-y-auto giữ
            margin trên/dưới cố định (viewport - 8rem) và cho phần nội dung tự scroll khi dài. */}
        <DialogContent className="max-h-[calc(100vh-8rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tỉ lệ cược</DialogTitle>
          </DialogHeader>
          {fullOddsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Đang tải...
            </div>
          ) : fullOddsQuery.data ? (
            <MatchOdds odds={fullOddsQuery.data} />
          ) : (
            <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Có lỗi xảy ra, thử lại sau.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
