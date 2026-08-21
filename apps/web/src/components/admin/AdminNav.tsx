"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  CalendarClock,
  CalendarRange,
  Coins,
  Download,
  Flag,
  Landmark,
  LayoutDashboard,
  Settings,
  Shield,
  Trophy,
  User,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@football-app/ui";

// Mọi trang ngoài "/" chỉ là stub cho tới khi build ở các piece sau (xem ROADMAP Phase 4) — link
// thật (không phải href="#") để không tạo dead-end UX, nhưng nội dung trang chỉ ghi "chưa triển khai".
// Icon khớp đúng icon dùng ở từng trang tương ứng (xem AdminResourcePage's `icon` prop).
const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/competitions", label: "Giải đấu", icon: Trophy },
  { href: "/admin/seasons", label: "Mùa giải", icon: CalendarRange },
  { href: "/admin/teams", label: "Đội bóng", icon: Shield },
  { href: "/admin/team-statistics", label: "Thống kê đội", icon: BarChart3 },
  { href: "/admin/players", label: "Cầu thủ", icon: User },
  { href: "/admin/stadiums", label: "Sân vận động", icon: Landmark },
  { href: "/admin/coaches", label: "HLV", icon: UserCog },
  { href: "/admin/referees", label: "Trọng tài", icon: Flag },
  { href: "/admin/matches", label: "Trận đấu", icon: CalendarClock },
  { href: "/admin/config", label: "Cấu hình", icon: Settings },
  { href: "/admin/notifications", label: "Nhật ký thông báo", icon: Bell },
  { href: "/admin/ai-usage-logs", label: "Nhật ký sử dụng AI", icon: Coins },
  { href: "/admin/scraper", label: "Scraper dữ liệu", icon: Download },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const isActive = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
