/**
 * Shared browser WebSocket connection to apps/api's `/live` endpoint (Phase 2 Bước 2), used by
 * `lib/use-live-match.ts`'s `useLiveMatch` to push `match.snapshot` updates directly into React
 * Query's cache instead of relying solely on Bước 1's REST polling.
 *
 * One socket for the whole tab (module-level singleton), lazily created on the first
 * `subscribeToMatch` call — not one socket per subscribed match, and not one per component. A
 * refcount per matchId means N components subscribing to the same match only send one wire
 * `subscribe`/`unsubscribe` message, and `activeMatchIds` remembers what should be subscribed so
 * a reconnect can re-subscribe everything that was active before the drop.
 *
 * Deliberately does NOT change `["match", matchId, "live"]`'s shape — `onSnapshot` writes the
 * exact same `LiveMatchState | null` that `useLiveMatch`'s `queryFn` (REST) would resolve to, so
 * `LiveMatchPanel` (and anything else reading that query key) needs zero changes.
 */
"use client";

import type { QueryClient } from "@tanstack/react-query";
import { getWsBaseUrl } from "./api-client";
import type { LiveMatchState, MatchComment } from "./types";

type ServerMessage =
  | { type: "match.snapshot"; matchId: string; data: LiveMatchState | null }
  | { type: "comment.new"; matchId: string; data: MatchComment }
  | { type: "error"; message: string }
  // Unknown/future message types shouldn't crash the handler.
  | { type: string; [key: string]: unknown };

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

let socket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Most recent `QueryClient` passed to `subscribeToMatch` — there's only ever one in this app
 * (single `QueryClientProvider` at the root), stashed here so socket event handlers (which aren't
 * called with a `queryClient` argument) can reach it. */
let latestQueryClient: QueryClient | null = null;

/** matchId -> number of active `subscribeToMatch` callers still holding it open. */
const refCounts = new Map<string, number>();

/** matchIds that should be subscribed on the wire right now — survives reconnects so `handleOpen`
 * knows what to re-subscribe. */
const activeMatchIds = new Set<string>();

/** Wire messages queued because the socket isn't open yet (still connecting, or not created). */
const pendingMessages: string[] = [];

/** matchId -> callbacks to invoke for each `comment.new` — a plain listener registry (not
 * React Query cache overwrite like `match.snapshot`) since comments need to be APPENDED to a
 * list, not replaced. */
const commentListeners = new Map<string, Set<(comment: MatchComment) => void>>();

function send(message: Record<string, unknown>): void {
  const payload = JSON.stringify(message);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(payload);
  } else {
    pendingMessages.push(payload);
  }
}

function flushPending(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  while (pendingMessages.length > 0) {
    const payload = pendingMessages.shift();
    if (payload !== undefined) socket.send(payload);
  }
}

function handleMessage(event: MessageEvent<string>): void {
  let message: ServerMessage;
  try {
    message = JSON.parse(event.data) as ServerMessage;
  } catch {
    return;
  }

  if (message.type === "match.snapshot") {
    const snapshot = message as { type: "match.snapshot"; matchId: string; data: LiveMatchState | null };
    latestQueryClient?.setQueryData(["match", snapshot.matchId, "live"], snapshot.data);
  } else if (message.type === "comment.new") {
    const commentMsg = message as { type: "comment.new"; matchId: string; data: MatchComment };
    for (const listener of commentListeners.get(commentMsg.matchId) ?? []) {
      listener(commentMsg.data);
    }
  } else if (message.type === "error") {
    // Not user-facing — see plan doc, malformed/unrecognized client messages only.
    console.warn("[realtime] server reported an error:", (message as { message: string }).message);
  }
}

function handleOpen(): void {
  reconnectAttempt = 0;
  // Re-subscribe to everything still active (first connect included — harmless no-op there since
  // there's nothing to invalidate yet beyond what useLiveMatch already fetches on mount), and
  // invalidate so the REST fallback (Bước 1) catches up on anything missed while disconnected.
  for (const matchId of activeMatchIds) {
    send({ type: "subscribe", matchId });
    latestQueryClient?.invalidateQueries({ queryKey: ["match", matchId, "live"] });
  }
  flushPending();
}

function scheduleReconnect(): void {
  if (reconnectTimer) return; // already scheduled
  const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** reconnectAttempt, MAX_BACKOFF_MS);
  const jitter = Math.random() * 0.3 * backoff;
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoff + jitter);
}

function handleCloseOrError(): void {
  socket = null;
  scheduleReconnect();
}

function connect(): void {
  const ws = new WebSocket(`${getWsBaseUrl()}/live`);
  socket = ws;
  ws.onopen = handleOpen;
  ws.onmessage = handleMessage;
  ws.onclose = handleCloseOrError;
  ws.onerror = handleCloseOrError;
}

function ensureSocket(): void {
  if (socket) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connect();
}

/**
 * Subscribe to live updates for `matchId`. Safe to call from multiple components at once for the
 * same matchId — only the first caller triggers a wire `subscribe` message, and the underlying
 * socket is created lazily on first use overall.
 *
 * Returns an unsubscribe function; call it from a `useEffect` cleanup. Only sends the wire
 * `unsubscribe` message once every caller for that matchId has unsubscribed.
 */
// Wire-level subscribe, shared by subscribeToMatch/subscribeToMatchComments below — the server
// subscribes to BOTH the live-state and comments Redis channels on the same `{type:"subscribe"}`
// message (see apps/api's ws-server.ts), so there's only ever one wire subscription per matchId
// regardless of which purpose(s) a caller needs it for.
function ensureWireSubscription(matchId: string): () => void {
  ensureSocket();

  const count = refCounts.get(matchId) ?? 0;
  refCounts.set(matchId, count + 1);
  if (count === 0) {
    activeMatchIds.add(matchId);
    send({ type: "subscribe", matchId });
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return; // guard against double-invocation of the cleanup callback
    unsubscribed = true;

    const current = refCounts.get(matchId) ?? 0;
    if (current <= 1) {
      refCounts.delete(matchId);
      activeMatchIds.delete(matchId);
      send({ type: "unsubscribe", matchId });
    } else {
      refCounts.set(matchId, current - 1);
    }
  };
}

export function subscribeToMatch(matchId: string, queryClient: QueryClient): () => void {
  latestQueryClient = queryClient;
  return ensureWireSubscription(matchId);
}

/** Subscribe to new comments for `matchId`. `onComment` is called once per newly-arrived
 * comment — dedup against already-loaded comments is the caller's job (see `use-match-comments.ts`). */
export function subscribeToMatchComments(matchId: string, onComment: (comment: MatchComment) => void): () => void {
  const listeners = commentListeners.get(matchId) ?? new Set();
  listeners.add(onComment);
  commentListeners.set(matchId, listeners);

  const unsubscribeWire = ensureWireSubscription(matchId);
  return () => {
    listeners.delete(onComment);
    if (listeners.size === 0) commentListeners.delete(matchId);
    unsubscribeWire();
  };
}
