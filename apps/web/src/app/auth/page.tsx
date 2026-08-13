"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Container } from "@football-app/ui";
import { useAuth } from "@/lib/auth-context";

const RECAPTCHA_CONTAINER_ID = "recaptcha-container";

/**
 * Simple sign-in page: Google (1-click popup) or Phone (2-step: send SMS code -> confirm code).
 * Deliberately minimal for Phase 1 auth wiring — not a polished account settings page.
 */
export default function AuthPage() {
  const { user, signInWithGoogle, sendPhoneCode, confirmPhoneCode } = useAuth();
  const router = useRouter();

  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (user) {
    return (
      <Container size="sm" className="py-10">
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Bạn đã đăng nhập với {user.displayName ?? user.phoneNumber ?? "tài khoản này"}.
          </p>
        </Card>
      </Container>
    );
  }

  async function handleGoogle() {
    setError(null);
    setPending(true);
    try {
      await signInWithGoogle();
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập Google thất bại.");
    } finally {
      setPending(false);
    }
  }

  async function handleSendCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await sendPhoneCode(phoneNumber, RECAPTCHA_CONTAINER_ID);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi được mã xác nhận.");
    } finally {
      setPending(false);
    }
  }

  async function handleConfirmCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await confirmPhoneCode(code);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mã xác nhận không đúng.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Container size="sm" className="py-10">
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Đăng nhập</h1>

      <Card className="flex flex-col gap-6">
        <Button onClick={() => void handleGoogle()} disabled={pending} className="w-full">
          Đăng nhập với Google
        </Button>

        <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-600">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          hoặc
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>

        {step === "phone" ? (
          <form onSubmit={handleSendCode} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
              Số điện thoại (kèm mã quốc gia, ví dụ +84901234567)
              <input
                type="tel"
                required
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="+84901234567"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>
            <Button type="submit" variant="outline" disabled={pending}>
              Gửi mã xác nhận
            </Button>
          </form>
        ) : (
          <form onSubmit={handleConfirmCode} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
              Mã xác nhận (SMS gửi tới {phoneNumber})
              <input
                type="text"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>
            <Button type="submit" variant="outline" disabled={pending}>
              Xác nhận
            </Button>
          </form>
        )}

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {/* Invisible reCAPTCHA widget required by RecaptchaVerifier for phone sign-in. */}
        <div id={RECAPTCHA_CONTAINER_ID} />
      </Card>
    </Container>
  );
}
