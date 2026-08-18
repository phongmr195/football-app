"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Heart, Shield, StarOff, User } from "lucide-react";
import { Badge, Button, Card, Container } from "@football-app/ui";
import { useAuth } from "@/lib/auth-context";
import { listDevices, registerDevice, unregisterDevice } from "@/lib/devices";
import { playerPositionMeta } from "@/lib/format";
import { requestPushPermission } from "@/lib/push-notifications";
import { useFavoritePlayers, useFavoriteTeams, useToggleFavorite } from "@/lib/use-favorites";

/**
 * Per-user private data (favorited teams/players) — inherently not cacheable/public, unlike the
 * rest of the browse pages, so this stays a Client Component rather than a Server
 * Component + ISR page. Needs both auth state (Firebase, browser-only) and the resulting data
 * fetch, so there's no meaningful server-rendered part to keep here.
 *
 * Lists come from the shared `["favorites", "teams"|"players"]` React Query cache (see
 * lib/use-favorites.ts) — the same cache `components/FavoriteButton.tsx` reads/writes on
 * /teams/[id] and /players/[id], so unfavoriting here (or favoriting from a detail page) stays
 * consistent everywhere without an extra round-trip.
 */
type NotificationOptInStatus =
  | "idle"
  | "checking"
  | "requesting"
  | "enabled"
  | "disabling"
  | "denied"
  | "unsupported"
  | "error";

export default function FavoritesPage() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const teamsQuery = useFavoriteTeams();
  const playersQuery = useFavoritePlayers();
  const { unfavorite: unfavoriteTeamMutation } = useToggleFavorite("team");
  const { unfavorite: unfavoritePlayerMutation } = useToggleFavorite("player");
  const [notificationStatus, setNotificationStatus] = useState<NotificationOptInStatus>("idle");
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const teams = teamsQuery.data ?? [];
  const players = playersQuery.data ?? [];
  const loadingData = user ? teamsQuery.isLoading || playersQuery.isLoading : false;

  // Trạng thái nút phải phản ánh đúng thực tế đã lưu ở backend, không chỉ state trong session
  // hiện tại — nếu không, reload trang sau khi đã bật thông báo sẽ lại hiện "Bật thông báo bàn
  // thắng" dù trình duyệt này thật ra đã đăng ký rồi (bug thật user báo). Cách kiểm tra: nếu
  // Notification.permission đã "granted" (không cần hỏi lại), gọi requestPushPermission() để lấy
  // token HIỆN TẠI của trình duyệt này (getToken() trả lại token cũ, không tạo mới, không hỏi
  // permission lại lần nữa vì đã granted), rồi so với danh sách device đã đăng ký ở backend.
  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    let cancelled = false;
    (async () => {
      setNotificationStatus("checking");
      try {
        const [token, idToken] = await Promise.all([requestPushPermission(), getIdToken()]);
        if (!token) {
          if (!cancelled) setNotificationStatus("idle");
          return;
        }
        const devices = await listDevices(idToken);
        const existing = devices.find((d) => d.fcmToken === token);
        if (cancelled) return;
        if (existing) {
          setDeviceId(existing.id);
          setNotificationStatus("enabled");
        } else {
          setNotificationStatus("idle");
        }
      } catch (err) {
        console.error("check existing device registration failed", err);
        if (!cancelled) setNotificationStatus("idle");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, getIdToken]);

  async function handleEnableNotifications() {
    setNotificationStatus("requesting");
    try {
      const token = await requestPushPermission();
      if (!token) {
        // requestPushPermission() returns null both for "browser doesn't support push" and for
        // "user declined" — Notification.permission still tells the two apart afterwards.
        const unsupported =
          typeof window === "undefined" ||
          !("Notification" in window) ||
          !("serviceWorker" in navigator);
        setNotificationStatus(unsupported ? "unsupported" : "denied");
        return;
      }
      const idToken = await getIdToken();
      await registerDevice(token, idToken);
      // POST /devices trả về Device row đã upsert — nhưng registerDevice() hiện chỉ trả về void
      // (xem lib/devices.ts), nên lấy lại deviceId qua listDevices thay vì đổi return type của
      // registerDevice() chỉ để phục vụ 1 chỗ gọi này.
      const devices = await listDevices(idToken);
      const justRegistered = devices.find((d) => d.fcmToken === token);
      setDeviceId(justRegistered?.id ?? null);
      setNotificationStatus("enabled");
    } catch (err) {
      console.error("handleEnableNotifications failed", err);
      setNotificationStatus("error");
    }
  }

  async function handleDisableNotifications() {
    if (!deviceId) return;
    setNotificationStatus("disabling");
    try {
      await unregisterDevice(deviceId, await getIdToken());
      setDeviceId(null);
      setNotificationStatus("idle");
    } catch (err) {
      console.error("handleDisableNotifications failed", err);
      setNotificationStatus("error");
    }
  }

  if (authLoading) {
    return (
      <Container size="md" className="py-10">
        <p className="text-sm text-zinc-400 dark:text-zinc-600">…</p>
      </Container>
    );
  }

  if (!user) {
    return (
      <Container size="md" className="py-10">
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">
            Đăng nhập để xem danh sách đội bóng và cầu thủ bạn đang theo dõi.
          </p>
          <Link href="/auth">
            <Button>Đăng nhập</Button>
          </Link>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" className="py-10">
      <h1 className="mb-4 flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <Heart className="h-6 w-6" aria-hidden="true" />
        Yêu thích
      </h1>

      <Card padding="sm" className="mb-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
          Nhận thông báo ngay khi đội bóng bạn theo dõi ghi bàn.
        </p>
        <div className="flex items-center gap-3">
          {notificationStatus === "enabled" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleDisableNotifications()}
              disabled={notificationStatus !== "enabled"}
            >
              Tắt thông báo bàn thắng
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void handleEnableNotifications()}
              disabled={notificationStatus === "requesting" || notificationStatus === "checking"}
            >
              Bật thông báo bàn thắng
            </Button>
          )}
          {notificationStatus === "denied" && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              Bạn đã từ chối quyền thông báo.
            </span>
          )}
          {notificationStatus === "unsupported" && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              Trình duyệt không hỗ trợ thông báo đẩy.
            </span>
          )}
          {notificationStatus === "error" && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              Không thể bật thông báo, thử lại sau.
            </span>
          )}
        </div>
      </Card>

      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        <Shield className="h-5 w-5" aria-hidden="true" />
        Đội bóng
      </h2>
      {loadingData ? (
        <p className="mb-8 text-sm text-zinc-400 dark:text-zinc-600">Đang tải…</p>
      ) : teams.length === 0 ? (
        <Card className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có đội bóng nào trong danh sách yêu thích.
        </Card>
      ) : (
        <ul className="mb-8 flex flex-col gap-2">
          {teams.map((team) => (
            <li key={team.id}>
              <Card padding="sm" className="flex items-center justify-between gap-4">
                <Link href={`/teams/${team.id}`} className="flex items-center gap-3">
                  {team.logoUrl ? (
                    <Image
                      src={team.logoUrl}
                      alt={team.name}
                      width={32}
                      height={32}
                      className="h-8 w-8 object-contain"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded bg-zinc-100 dark:bg-zinc-800" />
                  )}
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{team.name}</span>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => unfavoriteTeamMutation.mutate(team.id)}
                >
                  <StarOff className="h-4 w-4" aria-hidden="true" />
                  Bỏ theo dõi
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        <User className="h-5 w-5" aria-hidden="true" />
        Cầu thủ
      </h2>
      {loadingData ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">Đang tải…</p>
      ) : players.length === 0 ? (
        <Card className="text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có cầu thủ nào trong danh sách yêu thích.
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {players.map((player) => {
            const { label, variant } = playerPositionMeta(player.position);
            return (
              <li key={player.id}>
                <Card padding="sm" className="flex items-center justify-between gap-4">
                  <Link href={`/players/${player.id}`} className="flex flex-col">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {player.name}
                    </span>
                  </Link>
                  <div className="flex items-center gap-3">
                    <Badge variant={variant}>{label}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={() => unfavoritePlayerMutation.mutate(player.id)}
                    >
                      <StarOff className="h-4 w-4" aria-hidden="true" />
                      Bỏ theo dõi
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
