"use client";

import { useEffect } from "react";
import { listenForForegroundMessages } from "@/lib/push-notifications";

/**
 * Mounted once, app-wide (see app/layout.tsx) — not just on /favorites where the "Bật thông báo
 * bàn thắng" button lives, since a user can enable push there and then navigate anywhere else;
 * the foreground listener needs to stay alive regardless of which page is currently open.
 * Renders nothing — this is a side-effect-only component.
 */
export function PushNotificationListener() {
  useEffect(() => {
    const unsubscribe = listenForForegroundMessages();
    return unsubscribe;
  }, []);

  return null;
}
