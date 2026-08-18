"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { History, Sparkles } from "lucide-react";
import { Button, Card, Container } from "@football-app/ui";
import { ApiError, apiGetClient } from "@/lib/api-client";
import { BackButton } from "@/components/BackButton";
import { useAuth } from "@/lib/auth-context";
import { formatKickoffAt } from "@/lib/format";
import type { PlayerCompareHistoryEntry } from "@/lib/types";

/**
 * Lịch sử so sánh cầu thủ của user — khác AiPlayerComparison (cache CHUNG toàn app, không gắn
 * user nào), đọc từ PlayerCompareHistory (gắn userId, xem apps/api/src/routes/player-compare.ts).
 * Client Component cùng lý do /favorites: cần auth state trình duyệt-only, không có phần nào
 * render được ở server.
 */
export default function CompareHistoryPage() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [items, setItems] = useState<PlayerCompareHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await getIdToken();
        const data = await apiGetClient<{ items: PlayerCompareHistoryEntry[] }>(
          "/players/compare/history",
          undefined,
          { idToken },
        );
        if (!cancelled) setItems(data.items);
      } catch (err) {
        console.error("CompareHistoryPage: tải lịch sử thất bại", err);
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Không thể tải lịch sử.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getIdToken]);

  return (
    <Container size="md" className="py-10">
      <BackButton />
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <History className="h-6 w-6" aria-hidden="true" />
        Lịch sử so sánh
      </h1>

      {authLoading ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">…</p>
      ) : !user ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">Đăng nhập để xem lịch sử so sánh cầu thủ của bạn.</p>
          <Link href="/auth">
            <Button>Đăng nhập</Button>
          </Link>
        </Card>
      ) : error ? (
        <Card className="text-sm text-red-600 dark:text-red-400">{error}</Card>
      ) : items === null ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">Đang tải…</p>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Bạn chưa so sánh cầu thủ nào.
          <Link href="/compare">
            <Button variant="outline">So sánh ngay</Button>
          </Link>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((entry) => (
            <li key={entry.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-1 items-center gap-2">
                    {entry.playerA.team?.logoUrl ? (
                      <Image
                        src={entry.playerA.team.logoUrl}
                        alt={entry.playerA.team.name}
                        width={20}
                        height={20}
                        className="h-5 w-5 object-contain"
                      />
                    ) : null}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{entry.playerA.name}</span>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-600">vs</span>
                  <div className="flex flex-1 items-center justify-end gap-2 text-right">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{entry.playerB.name}</span>
                    {entry.playerB.team?.logoUrl ? (
                      <Image
                        src={entry.playerB.team.logoUrl}
                        alt={entry.playerB.team.name}
                        width={20}
                        height={20}
                        className="h-5 w-5 object-contain"
                      />
                    ) : null}
                  </div>
                </div>

                <p className="flex items-start gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {entry.comparison.content}
                </p>

                <span className="text-xs text-zinc-400 dark:text-zinc-600">
                  Xem lúc {formatKickoffAt(entry.viewedAt)}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
