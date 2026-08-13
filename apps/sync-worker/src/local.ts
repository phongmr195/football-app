import { syncAll } from "./sync-all";
import { syncLiveMatches } from "./sync-live-matches";

// SYNC_MODE=catalog: chạy syncAll() (competitions/seasons/teams/players/standings/matches).
// Mặc định (không set): giữ hành vi cũ, chỉ syncLiveMatches() cho Phase 0/2.
const mode = process.env.SYNC_MODE ?? "live";
const run = mode === "catalog" ? syncAll() : syncLiveMatches();

run
  .then((result) => console.log("sync done", result))
  .catch((err) => {
    console.error("sync failed", err);
    process.exit(1);
  });
