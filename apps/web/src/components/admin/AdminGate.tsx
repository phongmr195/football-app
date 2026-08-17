"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { AdminNav } from "./AdminNav";

const LOGIN_PATH = "/admin/login";

/**
 * Gates every /admin/* route (mounted in app/admin/layout.tsx) except /admin/login itself, which
 * needs to render while logged out. Auth state comes from useAdminAuth() (username/password + JWT,
 * see lib/admin-auth-context.tsx) — completely independent from the Firebase-based useAuth() the
 * public pages use.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { adminUser, loading, logout } = useAdminAuth();
  const isLoginPage = pathname === LOGIN_PATH;

  useEffect(() => {
    if (!loading && !adminUser && !isLoginPage) {
      router.replace(LOGIN_PATH);
    }
  }, [loading, adminUser, isLoginPage, router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (loading || !adminUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
        <Skeleton className="h-40 w-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-6 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="px-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Football App — Admin
        </span>
        <AdminNav />
        <div className="mt-auto flex flex-col gap-2 px-3">
          <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {adminUser.username}
          </span>
          <Button variant="outline" size="sm" onClick={logout}>
            Đăng xuất
          </Button>
        </div>
      </aside>
      <main className="flex-1 bg-zinc-50 p-8 dark:bg-black">{children}</main>
    </div>
  );
}
