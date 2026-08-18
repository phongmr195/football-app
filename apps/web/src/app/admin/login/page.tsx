"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAdminAuth } from "@/lib/admin-auth-context";

// Route riêng (không phải gate ẩn như bản Piece 1 cũ) — AdminGate (components/admin/AdminGate.tsx)
// biết bỏ qua chính route này khi kiểm tra "chưa đăng nhập -> redirect /admin/login", tránh vòng
// lặp redirect vô hạn.
export default function AdminLoginPage() {
  const router = useRouter();
  const { adminUser, login } = useAdminAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Đã đăng nhập rồi mà vẫn vào /admin/login (vd bấm back) -> đưa thẳng vào dashboard.
  useEffect(() => {
    if (adminUser) router.replace("/admin");
  }, [adminUser, router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      router.replace("/admin");
    } catch {
      setError("Sai tên đăng nhập hoặc mật khẩu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <Card className="flex w-80 flex-col gap-4 px-6 py-8">
        <h1 className="flex items-center justify-center gap-2 text-center text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          <Lock className="h-5 w-5" aria-hidden="true" />
          Football App — Admin
        </h1>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <Input
            placeholder="Tên đăng nhập"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <Input
            placeholder="Mật khẩu"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
