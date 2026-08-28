"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** <Link> tới /auth kèm trang hiện tại qua ?redirect= — AuthPage quay lại đúng trang này sau khi
 * đăng nhập/đăng ký thành công (xem app/auth/page.tsx). */
export function AuthLink({ children, className }: { children: ReactNode; className?: string }) {
  const pathname = usePathname();
  return (
    <Link href={`/auth?redirect=${encodeURIComponent(pathname)}`} className={className}>
      {children}
    </Link>
  );
}
