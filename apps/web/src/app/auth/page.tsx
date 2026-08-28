"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LogIn } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Trích message lỗi sạch ("Tên đăng nhập đã được sử dụng"...) từ ApiError ném ra bởi
 * apiMutateClient (lib/api-client.ts) — message thật có dạng
 * `${method} ${path} failed with ${status}: ${rawBodyText}`, rawBodyText là JSON `{error: "..."}`
 * trả về từ apps/api/src/routes/auth.ts. Fallback về message chung nếu parse thất bại (vd lỗi
 * network, không phải response JSON).
 */
function extractAuthErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const jsonStart = err.message.indexOf("{");
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(err.message.slice(jsonStart)) as { error?: string };
        if (parsed.error) return parsed.error;
      } catch {
        // rơi xuống fallback bên dưới
      }
    }
  }
  return fallback;
}

// Chỉ nhận path nội bộ ("/...") — chặn "//evil.com" (protocol-relative, browser hiểu như redirect
// ra ngoài) lỡ lọt vào query param `redirect`.
function safeRedirectTarget(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

// Đọc thẳng window.location.search tại thời điểm gọi (không qua useSearchParams()) — verify thật
// 2026-08-28: useSearchParams() trong Suspense boundary trả về giá trị cũ khi vào /auth qua
// client-side <Link> transition (server log cho thấy URL đúng có ?redirect=... nhưng router.push
// sau khi login vẫn đi "/"), đọc trực tiếp DOM tránh hẳn caching layer đó.
function getRedirectTarget(): string {
  if (typeof window === "undefined") return "/";
  return safeRedirectTarget(new URLSearchParams(window.location.search).get("redirect"));
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

// Validator theo từng field — vừa dùng cho live inline error (theo touched state, xem AuthPage),
// vừa dùng lại trong validateRegisterForm() cho lần chặn submit cuối cùng, tránh lặp rule 2 nơi.
function validateFullName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return "Họ tên phải có 2-100 ký tự";
  return null;
}

function validateUsername(value: string): string | null {
  if (value.length < 3 || value.length > 20) return "Tên đăng nhập phải có 3-20 ký tự";
  if (!USERNAME_PATTERN.test(value)) return "Tên đăng nhập chỉ gồm chữ, số và dấu gạch dưới";
  return null;
}

function validatePassword(value: string): string | null {
  if (value.length < 8) return "Mật khẩu phải có ít nhất 8 ký tự";
  if (!/[A-Za-z]/.test(value)) return "Mật khẩu phải có ít nhất 1 chữ cái";
  if (!/[A-Z]/.test(value)) return "Mật khẩu phải có ít nhất 1 chữ hoa";
  if (!/[0-9]/.test(value)) return "Mật khẩu phải có ít nhất 1 chữ số";
  return null;
}

function validateConfirmPassword(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) return "Xác nhận mật khẩu không khớp";
  return null;
}

function validateRegisterForm(
  fullName: string,
  username: string,
  password: string,
  confirmPassword: string,
): string | null {
  return (
    validateFullName(fullName) ??
    validateUsername(username) ??
    validatePassword(password) ??
    validateConfirmPassword(password, confirmPassword)
  );
}

/**
 * Đăng nhập/đăng ký: Google + Facebook popup, hoặc username/password tự build (xem
 * lib/auth-context.tsx cho lý do bỏ Phone sign-in). Tab "Đăng ký" validate y hệt server's zod
 * schema (apps/api/src/routes/auth.ts) trước khi gọi API, để user thấy lỗi ngay không cần round-trip.
 */
export default function AuthPage() {
  const { user, signInWithGoogle, signInWithFacebook, signInWithUsernamePassword, registerWithUsernamePassword } =
    useAuth();
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [fullName, setFullName] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Field nào đã bị blur ít nhất 1 lần — chỉ hiện lỗi field đó từ đó trở đi (tránh báo lỗi ngay ký
  // tự đầu tiên). Sau khi touched, lỗi tính lại LIVE mỗi lần gõ (derive thẳng từ state, không lưu
  // string lỗi riêng) — không cần debounce vì validator chỉ so sánh string, rẻ.
  const [registerTouched, setRegisterTouched] = useState({
    fullName: false,
    username: false,
    password: false,
    confirmPassword: false,
  });
  function touchRegisterField(field: keyof typeof registerTouched) {
    setRegisterTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }

  const fullNameError = registerTouched.fullName ? validateFullName(fullName) : null;
  const usernameError = registerTouched.username ? validateUsername(registerUsername) : null;
  const passwordError = registerTouched.password ? validatePassword(registerPassword) : null;
  const confirmPasswordError = registerTouched.confirmPassword
    ? validateConfirmPassword(registerPassword, confirmPassword)
    : null;

  // Vào /auth khi phiên Firebase đã đăng nhập sẵn (session cũ còn hiệu lực) — vẫn phải redirect
  // về `redirect`, không chỉ dừng ở thông báo "đã đăng nhập" bên dưới.
  useEffect(() => {
    if (user) router.push(getRedirectTarget());
  }, [user, router]);

  if (user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Bạn đã đăng nhập với {user.displayName ?? "tài khoản này"}.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleGoogle() {
    setError(null);
    setPending(true);
    try {
      await signInWithGoogle();
      router.push(getRedirectTarget());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập Google thất bại.");
    } finally {
      setPending(false);
    }
  }

  async function handleFacebook() {
    setError(null);
    setPending(true);
    try {
      await signInWithFacebook();
      router.push(getRedirectTarget());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập Facebook thất bại.");
    } finally {
      setPending(false);
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!loginUsername.trim() || !loginPassword) {
      setError("Nhập tên đăng nhập và mật khẩu");
      return;
    }

    setPending(true);
    try {
      await signInWithUsernamePassword(loginUsername.trim(), loginPassword);
      router.push(getRedirectTarget());
    } catch (err) {
      setError(extractAuthErrorMessage(err, "Đăng nhập thất bại, thử lại sau"));
    } finally {
      setPending(false);
    }
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // Đảm bảo lỗi field nào cũng hiện ra dù user chưa blur qua (vd submit ngay sau khi chỉ gõ 1
    // field) — lỗi hiện inline dưới từng field, không cần setError() chung nữa.
    setRegisterTouched({ fullName: true, username: true, password: true, confirmPassword: true });

    const validationError = validateRegisterForm(fullName, registerUsername, registerPassword, confirmPassword);
    if (validationError) return;

    setPending(true);
    try {
      await registerWithUsernamePassword(
        fullName.trim(),
        registerUsername.trim(),
        registerPassword,
        confirmPassword,
      );
      router.push(getRedirectTarget());
    } catch (err) {
      setError(extractAuthErrorMessage(err, "Đăng ký thất bại, thử lại sau"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold">
        <LogIn className="h-6 w-6" aria-hidden="true" />
        Đăng nhập
      </h1>

      <Card>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Button onClick={() => void handleGoogle()} disabled={pending} className="w-full">
              Đăng nhập với Google
            </Button>
            <Button
              onClick={() => void handleFacebook()}
              disabled={pending}
              variant="secondary"
              className="w-full"
            >
              Đăng nhập với Facebook
            </Button>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            hoặc
            <span className="h-px flex-1 bg-border" />
          </div>

          <Tabs defaultValue="login">
            <TabsList className="w-full">
              <TabsTrigger value="login" className="flex-1">
                Đăng nhập
              </TabsTrigger>
              <TabsTrigger value="register" className="flex-1">
                Đăng ký
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="pt-3">
              <form onSubmit={handleLogin} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="login-username">Tên đăng nhập</Label>
                  <Input
                    id="login-username"
                    autoComplete="username"
                    value={loginUsername}
                    onChange={(event) => setLoginUsername(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="login-password">Mật khẩu</Label>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                  />
                </div>
                <Button type="submit" variant="outline" disabled={pending}>
                  Đăng nhập
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register" className="pt-3">
              <form onSubmit={handleRegister} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="register-fullname">Họ tên</Label>
                  <Input
                    id="register-fullname"
                    autoComplete="name"
                    value={fullName}
                    aria-invalid={!!fullNameError}
                    onChange={(event) => setFullName(event.target.value)}
                    onBlur={() => touchRegisterField("fullName")}
                  />
                  {fullNameError ? <p className="text-xs text-destructive">{fullNameError}</p> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="register-username">Tên đăng nhập</Label>
                  <Input
                    id="register-username"
                    autoComplete="username"
                    placeholder="3-20 ký tự, chữ/số/gạch dưới"
                    value={registerUsername}
                    aria-invalid={!!usernameError}
                    onChange={(event) => setRegisterUsername(event.target.value)}
                    onBlur={() => touchRegisterField("username")}
                  />
                  {usernameError ? <p className="text-xs text-destructive">{usernameError}</p> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="register-password">Mật khẩu</Label>
                  <Input
                    id="register-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Ít nhất 8 ký tự, có chữ hoa và số"
                    value={registerPassword}
                    aria-invalid={!!passwordError}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                    onBlur={() => touchRegisterField("password")}
                  />
                  {passwordError ? <p className="text-xs text-destructive">{passwordError}</p> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="register-confirm-password">Xác nhận mật khẩu</Label>
                  <Input
                    id="register-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    aria-invalid={!!confirmPasswordError}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    onBlur={() => touchRegisterField("confirmPassword")}
                  />
                  {confirmPasswordError ? (
                    <p className="text-xs text-destructive">{confirmPasswordError}</p>
                  ) : null}
                </div>
                <Button type="submit" variant="outline" disabled={pending}>
                  Đăng ký
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
