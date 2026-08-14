"use client";

/**
 * React context wrapping the Firebase JS SDK's auth state (Google + Phone sign-in) for
 * apps/web. Mounted once in app/layout.tsx around the whole app (NavBar needs it too, for the
 * "Đăng nhập"/"Đăng xuất" state).
 */
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  RecaptchaVerifier,
  onAuthStateChanged,
  signInWithPhoneNumber as firebaseSignInWithPhoneNumber,
  signInWithPopup,
  signOut as firebaseSignOut,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { auth } from "./firebase";

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
  /**
   * Step 1 of phone sign-in: sends an SMS code. `recaptchaContainerId` must be the id of an
   * empty, currently-mounted DOM element (invisible reCAPTCHA renders into it) — see
   * app/auth/page.tsx.
   */
  sendPhoneCode: (phoneNumber: string, recaptchaContainerId: string) => Promise<void>;
  /** Step 2 of phone sign-in: confirms the SMS code sent by `sendPhoneCode`. */
  confirmPhoneCode: (code: string) => Promise<void>;
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

  // Phone sign-in is a 2-step flow (send code -> confirm code); these need to survive between
  // the two calls but don't need to trigger re-renders themselves, hence refs over state.
  const confirmationResultRef = useRef<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

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

  const sendPhoneCode = useCallback(async (phoneNumber: string, recaptchaContainerId: string) => {
    // Reuse a single RecaptchaVerifier per container across retries (e.g. user mistypes the
    // phone number and resubmits) — creating a new one each call without clearing the old one
    // leaks widgets into the DOM.
    if (!recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, recaptchaContainerId, {
        size: "invisible",
      });
    }
    confirmationResultRef.current = await firebaseSignInWithPhoneNumber(
      auth,
      phoneNumber,
      recaptchaVerifierRef.current
    );
  }, []);

  const confirmPhoneCode = useCallback(async (code: string) => {
    if (!confirmationResultRef.current) {
      throw new Error("Chưa gửi mã xác nhận — gọi sendPhoneCode trước khi confirmPhoneCode.");
    }
    await confirmationResultRef.current.confirm(code);
    confirmationResultRef.current = null;
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
        sendPhoneCode,
        confirmPhoneCode,
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
