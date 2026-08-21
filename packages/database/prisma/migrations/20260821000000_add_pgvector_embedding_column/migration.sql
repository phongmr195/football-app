-- Phase 1 pgvector cho chat RAG (Knowledge corpus — AiMatchSummary/AiPlayerSummary/
-- AiPlayerComparison, ~661 dòng lúc viết migration này). Chỉ dùng để SO SÁNH với "RAG-lite" ILIKE
-- hiện có (apps/api/src/chat-retrieval.ts), CHƯA wire vào /chat/messages — xem
-- docs/architecture/PROJECT_PLAN.md §7.1.
--
-- CREATE EXTENSION + cột vector(768) không biểu diễn được qua schema.prisma DSL (không dùng
-- preview feature postgresqlExtensions — giữ đơn giản, đúng nguyên tắc "chỉ thêm khi cần đo được
-- nhu cầu"). Viết tay theo đúng style migration
-- 20260814000000_add_external_ref_provider_id_unique_index (SQL thuần + comment giải thích).
--
-- 768 = số chiều output Gemini text-embedding-004 (quyết định đã chốt cùng user — tái dùng
-- GEMINI_API_KEY có sẵn, không thêm provider/credential mới).
--
-- KHÔNG tạo ivfflat/hnsw index — ~661 dòng, brute-force cosine distance (ORDER BY embedding <=> $1)
-- đủ nhanh ở quy mô này; cân nhắc ANN index sau khi corpus lớn hơn nhiều, không over-engineer sớm.
CREATE EXTENSION IF NOT EXISTS vector;

-- Đổi index đơn (không unique, từ migration init) thành UNIQUE — cho phép
-- apps/sync-worker/src/scripts/backfill-embeddings.ts upsert an toàn theo (sourceType, sourceId),
-- chạy lại không tạo dòng trùng.
DROP INDEX IF EXISTS "embeddings_sourceType_sourceId_idx";
CREATE UNIQUE INDEX "embeddings_sourceType_sourceId_key" ON "embeddings" ("sourceType", "sourceId");

ALTER TABLE "embeddings" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
