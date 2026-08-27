"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGetClient, apiMutateClient } from "./api-client";
import { useAuth } from "./auth-context";
import { subscribeToMatchComments } from "./realtime-client";
import type { MatchComment } from "./types";

function commentsQueryKey(matchId: string) {
  return ["match", matchId, "comments"] as const;
}

function appendIfNew(prev: MatchComment[] | undefined, comment: MatchComment): MatchComment[] {
  if (!prev) return [comment];
  if (prev.some((c) => c.id === comment.id)) return prev;
  return [...prev, comment];
}

/** REST load + WebSocket append — REST gives the initial page, WS pushes new comments as they
 * arrive (see apps/api/src/routes/match-comments.ts's publishComment()). */
export function useMatchComments(matchId: string) {
  const queryClient = useQueryClient();
  const queryKey = commentsQueryKey(matchId);

  const query = useQuery({
    queryKey,
    queryFn: () => apiGetClient<{ items: MatchComment[] }>(`/matches/${matchId}/comments`).then((r) => r.items),
  });

  useEffect(() => {
    return subscribeToMatchComments(matchId, (comment) => {
      queryClient.setQueryData<MatchComment[]>(queryKey, (prev) => appendIfNew(prev, comment));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey derived from matchId, không cần liệt kê riêng
  }, [matchId, queryClient]);

  return query;
}

/** Internal User.id (cuid) của người đang đăng nhập — client chỉ có sẵn Firebase UID, cần fetch
 * riêng để so khớp với mentionedUserIds/author.id (đều là internal id). */
export function useCurrentUserId() {
  const { user, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["me", user?.uid ?? null],
    queryFn: async () => {
      const idToken = await getIdToken();
      const { id } = await apiGetClient<{ id: string }>("/auth/me", undefined, { idToken });
      return id;
    },
    enabled: !!user,
    staleTime: Infinity,
  });
}

export function usePostMatchComment(matchId: string) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = commentsQueryKey(matchId);

  return useMutation({
    mutationFn: async (content: string) => {
      const idToken = await getIdToken();
      return apiMutateClient<MatchComment>(`/matches/${matchId}/comments`, "POST", { content }, { idToken });
    },
    onSuccess: (comment) => {
      // WS sẽ tự đẩy lại chính comment này (mình cũng là subscriber) — set trước để hiện ngay,
      // appendIfNew() lo phần dedup khi bản WS tới sau.
      queryClient.setQueryData<MatchComment[]>(queryKey, (prev) => appendIfNew(prev, comment));
    },
  });
}
