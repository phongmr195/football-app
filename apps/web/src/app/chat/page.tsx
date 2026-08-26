"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Plus, Send } from "lucide-react";
import { Button, Card, Container } from "@football-app/ui";
import { ApiError, apiGetClient, apiMutateClient, type ApiListResponse } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatKickoffAt } from "@/lib/format";
import type { ChatMessage, ChatSendResponse, ChatSessionSummary } from "@/lib/types";

/**
 * Trang chat AI — piece cuối Phase 5. Giống /compare, đây là 1 trong số ít trang gọi LLM đồng bộ
 * (POST /chat/messages, apps/api/src/routes/chat.ts) nên chấp nhận chờ vài giây mỗi lượt gửi.
 * Retrieval là "RAG-lite" qua SQL (quét tên đội/cầu thủ trong tin nhắn), KHÔNG dùng embedding/
 * pgvector — corpus text thật hiện còn nhỏ, xem plan piece này.
 */
export default function ChatPage() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    (async () => {
      try {
        const idToken = await getIdToken();
        const data = await apiGetClient<ApiListResponse<ChatSessionSummary>>(
          "/chat/sessions",
          { pageSize: 20 },
          { idToken, signal: controller.signal },
        );
        setSessions(data.items);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("ChatPage: tải lịch sử session thất bại", err);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ tải lại khi user đổi, không cần refetch mỗi lần sessionId đổi (list tự cập nhật sau khi gửi xong)
  }, [user]);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadSession(id: string) {
    setError(null);
    setSessionId(id);
    try {
      const idToken = await getIdToken();
      const data = await apiGetClient<{ items: ChatMessage[] }>(`/chat/sessions/${id}/messages`, undefined, { idToken });
      setMessages(data.items);
    } catch (err) {
      console.error("ChatPage: tải tin nhắn thất bại", err);
      setError("Không thể tải cuộc trò chuyện này.");
    }
  }

  function startNewSession() {
    setSessionId(null);
    setMessages([]);
    setError(null);
  }

  async function handleSend() {
    const message = input.trim();
    if (!message || sending) return;
    setError(null);
    setSending(true);
    // Hiện tin nhắn user ngay (optimistic) — không đợi round-trip mới thấy gì.
    const optimisticUserMessage: ChatMessage = { id: `local-${Date.now()}`, role: "USER", content: message, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, optimisticUserMessage]);
    setInput("");
    try {
      const idToken = await getIdToken();
      const data = await apiMutateClient<ChatSendResponse>(
        "/chat/messages",
        "POST",
        { sessionId: sessionId ?? undefined, message },
        { idToken },
      );
      setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        { id: `reply-${Date.now()}`, role: "ASSISTANT", content: data.reply.content, createdAt: data.reply.createdAt },
      ]);
      setSessions((prev) => {
        const others = (prev ?? []).filter((s) => s.sessionId !== data.sessionId);
        return [
          { sessionId: data.sessionId, lastActivityAt: data.reply.createdAt, messageCount: (prev?.find((s) => s.sessionId === data.sessionId)?.messageCount ?? 0) + 2 },
          ...others,
        ];
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMessage.id));
      if (err instanceof ApiError && err.status === 429) {
        setError("Bạn đã dùng hết 30 lượt chat AI hôm nay, thử lại vào ngày mai.");
      } else {
        setError("Không thể gửi tin nhắn lúc này, vui lòng thử lại.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Container size="lg" className="py-10">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        <MessageCircle className="h-6 w-6" aria-hidden="true" />
        Chat AI
      </h1>

      {authLoading ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">…</p>
      ) : !user ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">Đăng nhập để chat với AI về đội bóng/cầu thủ.</p>
          <Link href="/auth">
            <Button>Đăng nhập</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" onClick={startNewSession} className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Cuộc trò chuyện mới
            </Button>
            <div className="flex flex-col gap-1">
              {(sessions ?? []).map((s) => (
                <button
                  key={s.sessionId}
                  type="button"
                  onClick={() => void loadSession(s.sessionId)}
                  className={
                    "rounded-lg px-3 py-2 text-left text-sm transition-colors " +
                    (s.sessionId === sessionId
                      ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800")
                  }
                >
                  <div className="truncate">{formatKickoffAt(s.lastActivityAt)}</div>
                  <div className="text-xs opacity-70">{s.messageCount} tin nhắn</div>
                </button>
              ))}
            </div>
          </div>

          <Card className="flex h-[60vh] flex-col gap-3 p-0">
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Hỏi về 1 đội bóng hoặc cầu thủ bất kỳ, ví dụ &ldquo;Haaland mùa này ghi được bao nhiêu bàn?&rdquo;
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={"flex " + (m.role === "USER" ? "justify-end" : "justify-start")}>
                    <div
                      className={
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm " +
                        (m.role === "USER"
                          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                          : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50")
                      }
                    >
                      {m.content}
                    </div>
                  </div>
                ))
              )}
              {sending ? (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Đang trả lời...
                  </div>
                </div>
              ) : null}
              <div ref={scrollBottomRef} />
            </div>

            {error ? <p className="px-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
              className="flex items-center gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Nhập câu hỏi..."
                disabled={sending}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <Button type="submit" disabled={sending || !input.trim()} className="gap-1.5">
                <Send className="h-4 w-4" aria-hidden="true" />
                Gửi
              </Button>
            </form>
          </Card>
        </div>
      )}
    </Container>
  );
}
