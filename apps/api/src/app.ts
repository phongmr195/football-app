import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { healthRoute } from "./routes/health";
import { competitionsRoute } from "./routes/competitions";
import { teamsRoute } from "./routes/teams";
import { playersRoute } from "./routes/players";
import { playerCompareRoute } from "./routes/player-compare";
import { matchesRoute } from "./routes/matches";
import { standingsRoute } from "./routes/standings";
import { statisticsRoute } from "./routes/statistics";
import { favoritesRoute } from "./routes/favorites";
import { devicesRoute } from "./routes/devices";
import { searchRoute } from "./routes/search";
import { adminRoute } from "./routes/admin";
import { stadiumsRoute } from "./routes/stadiums";
import { coachesRoute } from "./routes/coaches";
import { refereesRoute } from "./routes/referees";
import { seasonsRoute } from "./routes/seasons";
import { appConfigRoute } from "./routes/app-config";
import { notificationLogsRoute } from "./routes/notification-logs";
import { adminScraperRoute } from "./routes/admin-scraper";

export const app = new Hono();

app.use(logger());
// apps/web's Client Components (e.g. favorites, MatchFilters' season lookup) call apps/api
// directly from the browser via apiGetClient/apiMutateClient (lib/api-client.ts) — those are
// cross-origin requests (web runs on its own Next.js dev/prod port, api on PORT above), so
// without this the browser blocks them with a CORS error before our own auth/route logic
// even runs. `next dev` picks whatever port is free (3000/3001/3002...) when the default is
// taken, so the default list covers the common local range; override via CORS_ORIGIN
// (comma-separated) for other environments (e.g. a deployed apps/web origin).
const corsOrigins = (
  process.env.CORS_ORIGIN ?? "http://localhost:3000,http://localhost:3001,http://localhost:3002"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  "*",
  cors({
    origin: corsOrigins,
    // Auth is a manually-attached `Authorization: Bearer <idToken>` header (see
    // apiGetClient/apiMutateClient), not cookies, so no need for credentialed CORS.
    allowHeaders: ["Content-Type", "Authorization"],
  })
);
app.route("/", healthRoute);
app.route("/", competitionsRoute);
app.route("/", teamsRoute);
app.route("/", playersRoute);
app.route("/", playerCompareRoute);
app.route("/", matchesRoute);
app.route("/", standingsRoute);
app.route("/", statisticsRoute);
app.route("/", favoritesRoute);
app.route("/", devicesRoute);
app.route("/", searchRoute);
app.route("/", adminRoute);
app.route("/", stadiumsRoute);
app.route("/", coachesRoute);
app.route("/", refereesRoute);
app.route("/", seasonsRoute);
app.route("/", appConfigRoute);
app.route("/", notificationLogsRoute);
app.route("/", adminScraperRoute);

export type App = typeof app;
