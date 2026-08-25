# AI (`packages/ai-provider`)

Docs cho tầng AI/LLM — chỉ load khi làm việc ở đây, `apps/api/src/ai-provider.ts`/`routes/chat.ts`/
`routes/player-compare.ts`, hoặc `apps/sync-worker/src/ai-provider.ts`/`match-summary.ts`/
`player-summary.ts`/`player-comparison.ts`.

## Provider

- Gọi thẳng Anthropic API — KHÔNG qua AWS Bedrock (không cần approval/IAM riêng ở quy mô này).
- `LlmProvider` interface + `AnthropicAdapter`/`GeminiAdapter`/`GroqAdapter` — constructor
  `{ apiKey, model?, fetchImpl? }`, KHÔNG throw khi thiếu `apiKey` (lỗi chỉ lộ lúc gọi
  `generateText()`).
- Chọn qua `createLlmProvider()` (`apps/{api,sync-worker}/src/ai-provider.ts`), env `LLM_PROVIDER`
  (`"anthropic"` mặc định | `"gemini"` | `"groq"`):
  - Anthropic: `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` (mặc định `claude-haiku-4-5-20251001`).
  - Gemini: `GEMINI_API_KEY` + `GEMINI_MODEL` (mặc định `gemini-3.5-flash-lite`, free tier).
  - Groq: `GROQ_API_KEY` + `GROQ_MODEL` (mặc định `openai/gpt-oss-20b`, free tier, OpenAI-compatible
    API). Danh mục model đổi thường xuyên — tra `GET /openai/v1/models` nếu 404 `model_not_found`,
    không tin tên model cứng trong training data.
  - `FallbackLlmProvider` (`src/fallback-provider.ts`) — set `LLM_FALLBACK_PROVIDER` để tự chuyển
    provider khác khi primary fail (rate limit/network), throw lỗi gộp nếu cả 2 fail.
- `GeminiAdapter`: field top-level `system_instruction` là snake_case (khác camelCase còn lại của
  API) — verify lại nếu gặp lỗi 400. Key qua header `x-goog-api-key`, không phải query param.

## `ai_match_summary` (job nền, sync-worker)

`generateMatchSummaryIfNeeded()` (`match-summary.ts`) sinh khi match FINISHED, trigger từ 2 nơi
(`sync-live-matches.ts` + `sync-catalog.ts`), tự idempotent qua `AiMatchSummary.matchId` unique.
Gọi KHÔNG `await`.

- `Commentary`/`MatchEvent` rỗng trong DB (không provider nào ghi) — summary chỉ dựa tỉ số +
  `Standing`, không tường thuật theo phút. Giới hạn dữ liệu, không phải giới hạn AI.
- Backfill match cũ: `backfill-match-summaries [limit]` — tốn phí thật, không chạy không giới hạn.
- KHÔNG dùng `AiUsageLog` (job hệ thống, không có user để cap quota) — chỉ `console.log` token/cost.
- Test: mock module `"./ai-provider"` trong `sync-catalog.test.ts`/`sync-live-matches.test.ts`, nếu
  không sẽ gọi LLM thật (key rỗng) làm chậm/flaky test không liên quan.

## AI trong `apps/api` (đồng bộ theo request user)

`player_compare`/`chat` — có `AiUsageLog` cap riêng (20/24h và 30/24h), check trước khi gọi LLM.

- **`chat`**: "RAG-lite" qua SQL `ILIKE` trực tiếp (không embedding/pgvector — corpus quá nhỏ để
  cần vector search, chỉ thêm khi corpus đủ lớn). Retrieval chỉ quét tin nhắn MỚI NHẤT (không quét
  lại lịch sử session) — câu hỏi dùng đại từ thay tên riêng sẽ mất context nếu câu trả lời trước
  không nhắc lại tên. Không xử lý dấu (cần `unaccent`, chưa thêm).
- `GET /chat/sessions/:sessionId/messages` LUÔN filter thêm `userId` — không tin `sessionId` một
  mình là biên giới quyền truy cập.
