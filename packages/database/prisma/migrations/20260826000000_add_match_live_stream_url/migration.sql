-- Admin nhập link live stream (YouTube hoặc HLS) cho từng trận, xem schema.prisma's Match.liveStreamUrl.
ALTER TABLE "matches" ADD COLUMN "liveStreamUrl" TEXT;
