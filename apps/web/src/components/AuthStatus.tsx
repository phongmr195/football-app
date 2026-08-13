"use client";

import Link from "next/link";
import { Button } from "@football-app/ui";
import { useAuth } from "@/lib/auth-context";

/**
 * Sign-in state shown in NavBar — "Đăng nhập" (signed out) or name/phone + "Đăng xuất" (signed
 * in). Kept as its own Client Component so NavBar itself can stay a Server Component (see the
 * "Reducing JS bundle size" pattern in Next.js docs: only the interactive slice ships JS).
 */
export function AuthStatus() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return <span className="text-sm text-zinc-400 dark:text-zinc-600">…</span>;
  }

  if (!user) {
    return (
      <Link href="/auth">
        <Button size="sm" variant="outline">
          Đăng nhập
        </Button>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-zinc-700 dark:text-zinc-300">
        {user.displayName ?? user.phoneNumber ?? "Tài khoản"}
      </span>
      <Button size="sm" variant="ghost" onClick={() => void signOut()}>
        Đăng xuất
      </Button>
    </div>
  );
}
