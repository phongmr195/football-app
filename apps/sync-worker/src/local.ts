import { syncLiveMatches } from "./sync-live-matches";

syncLiveMatches()
  .then((result) => console.log("sync done", result))
  .catch((err) => {
    console.error("sync failed", err);
    process.exit(1);
  });
