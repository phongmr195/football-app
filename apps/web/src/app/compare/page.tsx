"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, Scale, Sparkles } from "lucide-react";
import { Badge, Button, Card, Container } from "@football-app/ui";
import { ApiError, apiMutateClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PlayerPicker } from "@/components/PlayerPicker";
import type { PlayerCompareResponse, SearchPlayerItem } from "@/lib/types";

const STAT_ROWS: { key: "appearances" | "goals" | "assists" | "yellowCards" | "redCards"; label: string }[] = [
  { key: "appearances", label: "Ra sân" },
  { key: "goals", label: "Bàn thắng" },
  { key: "assists", label: "Kiến tạo" },
  { key: "yellowCards", label: "Thẻ vàng" },
  { key: "redCards", label: "Thẻ đỏ" },
];

/**
 * Trang duy nhất trong apps/web gọi 1 endpoint gọi LLM đồng bộ (POST /players/compare,
 * apps/api/src/routes/player-compare.ts) — user tự bấm nút, chấp nhận chờ vài giây, khác các
 * trang browse khác (ISR, không cần "use client"). Không ISR/SEO vì action-oriented, không phải
 * nội dung để index.
 */
export default function ComparePage() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [playerA, setPlayerA] = useState<SearchPlayerItem | null>(null);
  const [playerB, setPlayerB] = useState<SearchPlayerItem | null>(null);
  const [result, setResult] = useState<PlayerCompareResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCompare = Boolean(playerA && playerB && playerA.id !== playerB.id);

  async function handleCompare() {
    if (!playerA || !playerB) return;
    setPending(true);
    setError(null);
    try {
      const idToken = await getIdToken();
      const data = await apiMutateClient<PlayerCompareResponse>(
        "/players/compare",
        "POST",
        { playerAId: playerA.id, playerBId: playerB.id },
        { idToken },
      );
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setError("Chưa có đủ số liệu mùa giải để so sánh 2 cầu thủ này.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Bạn đã dùng hết lượt so sánh AI hôm nay (tối đa 20 lượt/ngày), vui lòng thử lại vào ngày mai.");
      } else {
        setError("Không thể so sánh lúc này, vui lòng thử lại.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Container size="md" className="py-10">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <Scale className="h-6 w-6" aria-hidden="true" />
        So sánh cầu thủ
      </h1>

      {authLoading ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">…</p>
      ) : !user ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">
            Đăng nhập để so sánh 2 cầu thủ bằng AI.
          </p>
          <Link href="/auth">
            <Button>Đăng nhập</Button>
          </Link>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <PlayerPicker
              label="Cầu thủ 1"
              selected={playerA}
              onSelect={setPlayerA}
              onClear={() => setPlayerA(null)}
              excludeId={playerB?.id}
              className="flex-1"
            />
            <PlayerPicker
              label="Cầu thủ 2"
              selected={playerB}
              onSelect={setPlayerB}
              onClear={() => setPlayerB(null)}
              excludeId={playerA?.id}
              className="flex-1"
            />
          </Card>

          <div className="mt-4 flex justify-center">
            <Button onClick={() => void handleCompare()} disabled={!canCompare || pending} className="gap-1.5">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {pending ? "Đang phân tích..." : "So sánh"}
            </Button>
          </div>

          {error ? (
            <Card className="mt-6 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </Card>
          ) : null}

          {result ? (
            <>
              <Card padding="none" className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <th className="px-4 py-3 font-medium">{result.playerA.name}</th>
                      <th className="px-3 py-3 text-center font-medium"></th>
                      <th className="px-4 py-3 text-right font-medium">{result.playerB.name}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STAT_ROWS.map((row) => (
                      <tr key={row.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                        <td className="px-4 py-2 font-semibold text-zinc-900 dark:text-zinc-50">
                          {result.playerA.statistics?.[row.key] ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-zinc-400 dark:text-zinc-600">
                          {row.label}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-zinc-900 dark:text-zinc-50">
                          {result.playerB.statistics?.[row.key] ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card className="mt-6 flex flex-col gap-2 py-6">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Nhận xét mang tính tham khảo
                  {result.cached ? (
                    <Badge variant="default" className="ml-1">
                      Đã lưu trước đó
                    </Badge>
                  ) : null}
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{result.comparison.content}</p>
              </Card>
            </>
          ) : null}
        </>
      )}
    </Container>
  );
}
