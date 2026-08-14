"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@football-app/ui";
import { useAuth } from "@/lib/auth-context";

/**
 * Sign-in state shown in NavBar — "Đăng nhập" (signed out) or an avatar/name dropdown with
 * account info + "Yêu thích" + "Đăng xuất" (signed in). Kept as its own Client Component so
 * NavBar itself can stay a Server Component (see the "Reducing JS bundle size" pattern in
 * Next.js docs: only the interactive slice ships JS).
 */
export function AuthStatus() {
  const { user, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

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

  const name = user.displayName ?? user.phoneNumber ?? "Tài khoản";
  const contact = user.email ?? user.phoneNumber ?? null;
  const initial = name.charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {user.photoURL ? (
          <Image
            src={user.photoURL}
            alt={name}
            width={28}
            height={28}
            className="h-7 w-7 rounded-full border border-zinc-200 object-cover dark:border-zinc-700"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {initial}
          </span>
        )}
        <span className="max-w-32 truncate">{name}</span>
      </button>

      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
            {user.photoURL ? (
              <Image
                src={user.photoURL}
                alt={name}
                width={40}
                height={40}
                className="h-10 w-10 rounded-full border border-zinc-200 object-cover dark:border-zinc-700"
              />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {initial}
              </span>
            )}
            <div className="flex flex-col overflow-hidden">
              <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                {name}
              </span>
              {contact ? (
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {contact}
                </span>
              ) : null}
            </div>
          </div>

          <Link
            href="/favorites"
            onClick={() => setOpen(false)}
            className="mt-3 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Yêu thích
          </Link>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Đăng xuất
          </button>
        </div>
      ) : null}
    </div>
  );
}
