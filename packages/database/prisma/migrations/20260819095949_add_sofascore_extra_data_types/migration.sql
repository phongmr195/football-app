-- AlterTable
ALTER TABLE "scraper_runs" ADD COLUMN     "dataTypes" TEXT[] DEFAULT ARRAY['events', 'lineups', 'statistics']::TEXT[];

-- CreateTable
CREATE TABLE "match_shots" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT,
    "minute" INTEGER NOT NULL,
    "shotType" TEXT NOT NULL,
    "situation" TEXT,
    "bodyPart" TEXT,
    "xg" DOUBLE PRECISION,
    "xgot" DOUBLE PRECISION,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "match_shots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_highlights" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,

    CONSTRAINT "match_highlights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_average_positions" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "averageX" DOUBLE PRECISION NOT NULL,
    "averageY" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "match_average_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_momentum" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "minute" DOUBLE PRECISION NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "match_momentum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_odds" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sofascoreMarketId" INTEGER NOT NULL,
    "marketName" TEXT NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "match_odds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_shots_matchId_idx" ON "match_shots"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "match_highlights_matchId_url_key" ON "match_highlights"("matchId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "match_average_positions_matchId_playerId_key" ON "match_average_positions"("matchId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "match_momentum_matchId_minute_key" ON "match_momentum"("matchId", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "match_odds_matchId_sofascoreMarketId_key" ON "match_odds"("matchId", "sofascoreMarketId");

-- AddForeignKey
ALTER TABLE "match_shots" ADD CONSTRAINT "match_shots_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_shots" ADD CONSTRAINT "match_shots_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_shots" ADD CONSTRAINT "match_shots_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_highlights" ADD CONSTRAINT "match_highlights_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_average_positions" ADD CONSTRAINT "match_average_positions_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_average_positions" ADD CONSTRAINT "match_average_positions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_average_positions" ADD CONSTRAINT "match_average_positions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_momentum" ADD CONSTRAINT "match_momentum_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_odds" ADD CONSTRAINT "match_odds_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
