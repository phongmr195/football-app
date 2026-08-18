-- CreateTable
CREATE TABLE "player_compare_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_compare_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_compare_history_userId_comparisonId_key" ON "player_compare_history"("userId", "comparisonId");

-- AddForeignKey
ALTER TABLE "player_compare_history" ADD CONSTRAINT "player_compare_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_compare_history" ADD CONSTRAINT "player_compare_history_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "ai_player_comparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;
