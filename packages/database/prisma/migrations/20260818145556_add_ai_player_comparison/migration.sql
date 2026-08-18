-- CreateTable
CREATE TABLE "ai_player_comparison" (
    "id" TEXT NOT NULL,
    "playerAId" TEXT NOT NULL,
    "playerBId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_player_comparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_player_comparison_playerAId_playerBId_key" ON "ai_player_comparison"("playerAId", "playerBId");

-- AddForeignKey
ALTER TABLE "ai_player_comparison" ADD CONSTRAINT "ai_player_comparison_playerAId_fkey" FOREIGN KEY ("playerAId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_player_comparison" ADD CONSTRAINT "ai_player_comparison_playerBId_fkey" FOREIGN KEY ("playerBId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
