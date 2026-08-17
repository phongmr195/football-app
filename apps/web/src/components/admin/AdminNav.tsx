"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@football-app/ui";

// Mọi trang ngoài "/" chỉ là stub cho tới khi build ở các piece sau (xem ROADMAP Phase 4) — link
// thật (không phải href="#") để không tạo dead-end UX, nhưng nội dung trang chỉ ghi "chưa triển khai".
const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/competitions", label: "Giải đấu" },
  { href: "/admin/teams", label: "Đội bóng" },
  { href: "/admin/players", label: "Cầu thủ" },
  { href: "/admin/matches", label: "Trận đấu" },
  { href: "/admin/config", label: "Cấu hình" },
  { href: "/admin/notifications", label: "Nhật ký thông báo" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map(({ href, label }) => {
        const isActive = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
