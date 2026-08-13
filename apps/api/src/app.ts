import { Hono } from "hono";
import { logger } from "hono/logger";
import { healthRoute } from "./routes/health";
import { competitionsRoute } from "./routes/competitions";
import { teamsRoute } from "./routes/teams";
import { playersRoute } from "./routes/players";
import { matchesRoute } from "./routes/matches";
import { standingsRoute } from "./routes/standings";
import { statisticsRoute } from "./routes/statistics";

export const app = new Hono();

app.use(logger());
app.route("/", healthRoute);
app.route("/", competitionsRoute);
app.route("/", teamsRoute);
app.route("/", playersRoute);
app.route("/", matchesRoute);
app.route("/", standingsRoute);
app.route("/", statisticsRoute);

export type App = typeof app;
