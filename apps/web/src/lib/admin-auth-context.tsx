"use client";

/**
 * Auth context for /admin/* (ROADMAP Phase 4) — completely independent from lib/auth-context.tsx
 * (Firebase, for consumer-facing pages). Admin login is username/password against `AdminUser`
 * (apps/api/src/routes/admin.ts's POST /admin/login), backed by a hand-issued JWT — no Firebase
 * involvement at all. Scoped to app/admin/layout.tsx only, not the root layout.
 *
 * Token is kept in localStorage (no server-side session/cookie infra exists anywhere in this app
 * to reuse) — a known tradeoff vs. an httpOnly cookie (XSS exposure), acceptable for a small
 * internal tool with no third-party script inclusion.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGetClient, apiMutateClient } from "./api-client";

const TOKEN_STORAGE_KEY = "admin_token";

export interface AdminUser {
  id: string;
  username: string;
}

interface AdminAuthContextValue {
  adminUser: AdminUser | null;
  /** Bearer token for authenticated apps/api calls — pass as `idToken` to apiGetClient/
   * apiMutateClient (apps/web/src/lib/api-client.ts), same shape as the Firebase ID token the
   * consumer-facing pages use, just issued by a different system. */
  token: string | null;
  /** True until the initial stored-token check (GET /admin/me) resolves. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Toàn bộ setState nằm trong callback của .then() (kể cả nhánh "không có token") — không gọi
    // trực tiếp trong thân effect — để không vi phạm react-hooks/set-state-in-effect (cùng cách
    // đã dùng ở SearchBox.tsx cho debounce timeout).
    let cancelled = false;
    Promise.resolve().then(async () => {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!stored) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const me = await apiGetClient<AdminUser>("/admin/me", undefined, { idToken: stored });
        if (cancelled) return;
        setToken(stored);
        setAdminUser(me);
      } catch {
        // Token hết hạn/không hợp lệ nữa (AdminUser bị xoá, JWT hết hạn 7 ngày...) — dọn sạch,
        // AdminGate sẽ điều hướng về /admin/login.
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiMutateClient<{ token: string; id: string; username: string }>(
      "/admin/login",
      "POST",
      { username, password },
    );
    localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
    setToken(result.token);
    setAdminUser({ id: result.id, username: result.username });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setAdminUser(null);
  }, []);

  return (
    <AdminAuthContext.Provider value={{ adminUser, token, loading, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth() must be called within an <AdminAuthProvider> (see app/admin/layout.tsx).");
  }
  return ctx;
}
