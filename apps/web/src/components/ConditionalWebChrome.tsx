"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NavBar } from "./NavBar";
import { PushNotificationListener } from "./PushNotificationListener";

/**
 * /admin/* (ROADMAP Phase 4) shares this app's port/root layout but is a completely separate
 * section — its own auth system (lib/admin-auth-context.tsx), its own nav (AdminGate's sidebar).
 * The public NavBar/PushNotificationListener (Firebase-auth-aware) don't belong there. Root
 * layout (app/layout.tsx) stays a Server Component; this one client wrapper is the smallest way
 * to make that one part of the tree pathname-aware, instead of splitting app/ into route groups
 * with two full root layouts (bigger change — every existing page would need to move).
 */
export function ConditionalWebChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <PushNotificationListener />
      <NavBar />
      <main className="flex flex-1 flex-col">{children}</main>
    </>
  );
}
