"use client";

/**
 * React context wrapping the Firebase JS SDK's auth state (Google + Facebook popup, và
 * username/password của chính app — xem "signInWithUsername"/"registerWithUsername" dưới) cho
 * apps/web. Mounted once in app/layout.tsx around the whole app (NavBar needs it too, for the
 * "Đăng nhập"/"Đăng xuất" state).
 *
 * Phone sign-in đã BỎ (2026-08-24) — Firebase Phone Auth bắt buộc gói Blaze (trả phí) + tính phí
 * theo từng SMS, không có free tier, xem CLAUDE.md § Authentication. Thay bằng username/password
 * tự build (apps/api/src/routes/auth.ts) — backend mint 1 Firebase custom token khi đăng ký/đăng
 * nhập thành công, client signInWithCustomToken() bằng token đó để vẫn ra được Firebase ID token
 * thật, không cần sửa gì ở tầng verify token (requireAuth) hay mọi API đã có.
 */
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { auth } from "./firebase";
import { loginWithUsername, registerWithUsername } from "./user-auth";

interface AuthContextValue {
  user: User | null;
  /** True until the first `onAuthStateChanged` callback fires (initial auth check). */
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  /**
   * Requires the Facebook provider to be enabled in Firebase Console (Authentication ->
   * Sign-in method -> Facebook) with a real Facebook App ID/Secret, and that Facebook App's
   * OAuth redirect URI whitelisted to Firebase's handler — see CLAUDE.md § Authentication for
   * the exact steps. Throws Firebase's own `auth/operation-not-allowed` error if the provider
   * isn't enabled yet.
   */
  signInWithFacebook: () => Promise<void>;
  /** Đăng ký username/password mới — validate đầy đủ đã chạy ở server (apps/api's
   * registerBodySchema), lỗi cụ thể (username trùng, password yếu, confirmPassword không khớp...)
   * ném ra qua ApiError, xem extractAuthErrorMessage() trong app/auth/page.tsx. Tự đăng nhập luôn
   * sau khi đăng ký thành công (không cần bước đăng nhập riêng). */
  registerWithUsernamePassword: (
    fullName: string,
    username: string,
    password: string,
    confirmPassword: string,
  ) => Promise<void>;
  signInWithUsernamePassword: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Current user's Firebase ID token, or null if signed out. Firebase ID tokens are short-lived
   * (~1h) and `getIdToken()` transparently refreshes them, so callers should fetch a fresh token
   * right before each authenticated request rather than caching it — see the architecture note
   * in lib/api-client.ts (apiGetClient/apiMutateClient) for how this feeds piece 6 (favorites).
   */
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const signInWithFacebook = useCallback(async () => {
    await signInWithPopup(auth, new FacebookAuthProvider());
  }, []);

  const registerWithUsernamePassword = useCallback(
    async (fullName: string, username: string, password: string, confirmPassword: string) => {
      const { customToken } = await registerWithUsername(fullName, username, password, confirmPassword);
      const credential = await signInWithCustomToken(auth, customToken);
      // fullName chỉ lưu ở UserProfile.displayName (Postgres, xem apps/api/src/routes/auth.ts) —
      // Firebase's User object KHÔNG tự biết giá trị này (signInWithCustomToken không set
      // displayName). Đồng bộ sang đây 1 lần lúc đăng ký để AuthStatus.tsx (đọc user.displayName)
      // hiện đúng tên thật thay vì rơi về fallback "Tài khoản".
      await updateProfile(credential.user, { displayName: fullName });
    },
    [],
  );

  const signInWithUsernamePassword = useCallback(async (username: string, password: string) => {
    const { customToken } = await loginWithUsername(username, password);
    await signInWithCustomToken(auth, customToken);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const getIdToken = useCallback(async () => {
    return auth.currentUser ? await auth.currentUser.getIdToken() : null;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInWithGoogle,
        signInWithFacebook,
        registerWithUsernamePassword,
        signInWithUsernamePassword,
        signOut,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be called within an <AuthProvider> (see app/layout.tsx).");
  }
  return ctx;
}
