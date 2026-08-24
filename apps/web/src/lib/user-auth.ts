/**
 * Fetchers cho apps/api's `/auth/register` + `/auth/login` (username+password cho user thường,
 * xem apps/api/src/routes/auth.ts) — 2 endpoint PUBLIC, không cần idToken (chưa đăng nhập lúc gọi
 * các endpoint này). Trả về `customToken` để auth-context.tsx tự
 * `signInWithCustomToken(auth, customToken)`, ra Firebase ID token thật.
 */
import { apiMutateClient } from "./api-client";

export interface RegisterResponse {
  customToken: string;
}

export interface LoginResponse {
  customToken: string;
}

export async function registerWithUsername(
  fullName: string,
  username: string,
  password: string,
  confirmPassword: string,
): Promise<RegisterResponse> {
  return apiMutateClient<RegisterResponse>("/auth/register", "POST", {
    fullName,
    username,
    password,
    confirmPassword,
  });
}

export async function loginWithUsername(username: string, password: string): Promise<LoginResponse> {
  return apiMutateClient<LoginResponse>("/auth/login", "POST", { username, password });
}
