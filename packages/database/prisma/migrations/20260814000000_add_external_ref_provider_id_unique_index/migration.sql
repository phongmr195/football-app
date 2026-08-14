-- Real bug found via code review: sync-worker's lookup functions in apps/sync-worker/src/sync-catalog.ts
-- matched rows by `externalRef->>'id'` ONLY, never `externalRef->>'provider'`. Two different providers
-- (api-football, football-data.org) can assign the same numeric id to two different real-world entities;
-- nothing prevented that collision from silently corrupting/overwriting the wrong row. The application-level
-- fix (filter by both provider AND id) is in the same PR — this migration adds a DB-level safety net + a
-- fast lookup path for the exact (provider, id) equality pattern the sync-worker actually queries.
--
-- Expression/functional index (not representable in schema.prisma's DSL) on the two JSON keys we always
-- filter by together. Partial (`WHERE "externalRef" IS NOT NULL`) because the column is nullable and NULLs
-- must not be forced unique. B-tree (default) is correct here, not GIN — this is an exact-match equality
-- lookup, not a containment query.
--
-- Verified against real data (2026-08-14) before applying: no existing rows in any of these 4 tables
-- share the same (provider, id) pair, so this does not fail on pre-existing duplicates.
CREATE UNIQUE INDEX "competitions_external_ref_provider_id_key"
  ON "competitions" (("externalRef"->>'provider'), ("externalRef"->>'id'))
  WHERE "externalRef" IS NOT NULL;

CREATE UNIQUE INDEX "teams_external_ref_provider_id_key"
  ON "teams" (("externalRef"->>'provider'), ("externalRef"->>'id'))
  WHERE "externalRef" IS NOT NULL;

CREATE UNIQUE INDEX "players_external_ref_provider_id_key"
  ON "players" (("externalRef"->>'provider'), ("externalRef"->>'id'))
  WHERE "externalRef" IS NOT NULL;

CREATE UNIQUE INDEX "matches_external_ref_provider_id_key"
  ON "matches" (("externalRef"->>'provider'), ("externalRef"->>'id'))
  WHERE "externalRef" IS NOT NULL;
