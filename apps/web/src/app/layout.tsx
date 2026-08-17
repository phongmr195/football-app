import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ConditionalWebChrome } from "@/components/ConditionalWebChrome";
import { AuthProvider } from "@/lib/auth-context";
import { QueryProvider } from "@/lib/query-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "My Football",
  description: "My Football — competitions, teams, matches and standings.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* AuthProvider wraps ConditionalWebChrome too (not just {children}) because it renders
            <AuthStatus />, which needs the auth context — see Next.js docs on context providers:
            "render providers as deep as possible", here that's just below <body>. QueryProvider
            wraps AuthProvider (order doesn't functionally matter, they're independent contexts,
            but use-favorites.ts's hooks need both React Query and auth context available
            wherever FavoriteButton/favorites/page.tsx render, so both must be above it too).
            ConditionalWebChrome hides NavBar/PushNotificationListener under /admin/* — see its
            own doc comment for why that section has its own auth system and nav entirely. */}
        <QueryProvider>
          <AuthProvider>
            <ConditionalWebChrome>{children}</ConditionalWebChrome>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
