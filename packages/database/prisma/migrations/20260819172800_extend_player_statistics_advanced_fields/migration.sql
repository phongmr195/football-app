-- AlterTable
ALTER TABLE "player_statistics" ADD COLUMN     "cleanSheet" INTEGER,
ADD COLUMN     "expectedAssists" DOUBLE PRECISION,
ADD COLUMN     "expectedGoals" DOUBLE PRECISION,
ADD COLUMN     "interceptions" INTEGER,
ADD COLUMN     "keyPasses" INTEGER,
ADD COLUMN     "kilometersCovered" DOUBLE PRECISION,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "saves" INTEGER,
ADD COLUMN     "successfulDribbles" INTEGER,
ADD COLUMN     "tackles" INTEGER,
ADD COLUMN     "topSpeed" DOUBLE PRECISION;
