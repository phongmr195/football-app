"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MessageSquare, Send, Smile } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useMatchComments, usePostMatchComment } from "@/lib/use-match-comments";
import type { MatchComment, MatchCommentAuthor } from "@/lib/types";

const MENTION_SPLIT_RE = /(@[a-zA-Z0-9_]{2,40})/g;
// Stable reference (không phải `[]` literal mới mỗi render) — dùng trong useMemo's deps dưới, nếu
// không memo hoá lại chạy mỗi render trong lúc đang loading.
const EMPTY_COMMENTS: MatchComment[] = [];

// Bộ emoji cố định, không cần thư viện emoji-picker riêng (nặng, không cần thiết cho nhu cầu
// "thả 1 emoji nhanh" ở khung comment) — ưu tiên vài emoji hay dùng cho bóng đá trước.
const QUICK_EMOJIS = [
  "⚽", "🔥", "👏", "🎉", "😂", "😍", "😮", "😭", "👍", "👎",
  "❤️", "💪", "🙌", "🤔", "😴", "🥳", "🎯", "🏆", "🟨", "🟥",
];

function authorLabel(author: MatchCommentAuthor): string {
  return author.displayName ?? "Người dùng";
}

/** Render content với `@username` được tô đậm — cùng regex charset đã dùng ở backend
 * (apps/api/src/routes/match-comments.ts's MENTION_RE), không xác thực lại có phải mention hợp lệ
 * hay không (chỉ để hiển thị, backend đã quyết định mentionedUserIds thật). */
function CommentContent({ content }: { content: string }) {
  const parts = content.split(MENTION_SPLIT_RE);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="font-medium text-blue-600 dark:text-blue-400">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function CommentRow({ comment }: { comment: MatchComment }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {authorLabel(comment.author)}
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-600">
          {new Date(comment.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        <CommentContent content={comment.content} />
      </p>
    </li>
  );
}

/** Bình luận trận đấu — luôn hiện trên trang chi tiết trận, không phụ thuộc trạng thái live.
 * Realtime qua WebSocket (xem lib/use-match-comments.ts). @mention chỉ gợi ý user ĐANG CÙNG CHAT
 * (comment trong 30 phút gần nhất, đọc từ danh sách đã tải — không có endpoint search user riêng),
 * theo `mentionHandle` (username, hoặc slug từ displayName cho user Google/Facebook không có
 * username) — xem apps/api/src/routes/match-comments.ts. */
export function MatchComments({ matchId }: { matchId: string }) {
  const { user, loading: authLoading } = useAuth();
  const commentsQuery = useMatchComments(matchId);
  const postComment = usePostMatchComment(matchId);

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const comments = commentsQuery.data ?? EMPTY_COMMENTS;

  // `Date.now()` không được gọi trong render/useMemo (react-hooks/purity) — tính qua effect,
  // refresh mỗi phút thay vì tick liên tục (đủ mượt cho 1 gợi ý autocomplete, không cần chính xác
  // tới giây).
  const [activeSince, setActiveSince] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setActiveSince(Date.now() - 30 * 60 * 1000);
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Chỉ gợi ý user ĐANG CÙNG CHAT (comment trong 30 phút gần nhất) — không phải bất kỳ ai từng
  // comment trận này, có thể đã rời đi từ lâu. Cùng ngưỡng với server-side resolve, xem
  // apps/api/src/routes/match-comments.ts's MENTION_ACTIVE_WINDOW_MS.
  const mentionableUsers = useMemo(() => {
    if (activeSince === null) return [];
    const byId = new Map<string, MatchCommentAuthor>();
    for (const c of comments) {
      if (c.author.mentionHandle && new Date(c.createdAt).getTime() >= activeSince) {
        byId.set(c.author.id, c.author);
      }
    }
    return [...byId.values()];
  }, [comments, activeSince]);

  const mentionQuery = input.match(/@([a-zA-Z0-9_]*)$/)?.[1];
  const mentionSuggestions =
    mentionQuery !== undefined
      ? mentionableUsers
          .filter((u) => u.mentionHandle!.toLowerCase().startsWith(mentionQuery.toLowerCase()))
          .slice(0, 5)
      : [];

  function pickMention(mentionHandle: string) {
    setInput((prev) => prev.replace(/@[a-zA-Z0-9_]*$/, `@${mentionHandle} `));
  }

  // Chèn đúng vị trí con trỏ (không phải luôn nối vào cuối) — đọc selectionStart/End TRƯỚC khi
  // setInput (state cũ), rồi set lại vị trí con trỏ sau emoji vừa chèn ở frame kế tiếp (DOM value
  // chỉ cập nhật xong sau khi React re-render).
  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    setInput((prev) => prev.slice(0, start) + emoji + prev.slice(end));
    const cursor = start + emoji.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  async function handleSubmit() {
    const content = input.trim();
    if (!content) return;
    setError(null);
    try {
      await postComment.mutateAsync(content);
      setInput("");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Bạn đang bình luận quá nhanh, thử lại sau."
          : "Không gửi được bình luận, thử lại sau.",
      );
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && mentionSuggestions.length === 0) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        Bình luận
      </h3>

      {commentsQuery.isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Chưa có bình luận nào.</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {comments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} />
          ))}
        </ul>
      )}

      {authLoading ? null : !user ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/auth" className="underline">
            Đăng nhập
          </Link>{" "}
          để bình luận.
        </p>
      ) : (
        <div className="relative flex flex-col gap-2">
          {mentionSuggestions.length > 0 ? (
            <div className="absolute bottom-full left-0 z-10 mb-1 flex w-56 flex-col rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
              {mentionSuggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => pickMention(suggestion.mentionHandle!)}
                  className="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="text-sm">{suggestion.displayName ?? suggestion.mentionHandle}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">@{suggestion.mentionHandle}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Viết bình luận... gõ @ để tag người đã bình luận"
              rows={2}
              className="flex-1 resize-none"
            />
            <Popover>
              <PopoverTrigger
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label="Chèn emoji"
              >
                <Smile className="h-4 w-4" aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2">
                <div className="grid grid-cols-5 gap-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="rounded-md p-1.5 text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              size="icon"
              disabled={!input.trim() || postComment.isPending}
              onClick={() => void handleSubmit()}
              aria-label="Gửi bình luận"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
