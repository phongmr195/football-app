"use client";

import { LayoutDashboard } from "lucide-react";
import { useAdminAuth } from "@/lib/admin-auth-context";

export default function AdminDashboardPage() {
  const { adminUser } = useAdminAuth();

  return (
    <div className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <LayoutDashboard className="h-6 w-6" aria-hidden="true" />
        Dashboard
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Xin chào, {adminUser?.username}. Chọn 1 mục ở menu bên trái để quản lý dữ liệu.
      </p>
    </div>
  );
}
