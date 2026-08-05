import { Hono } from "hono";
import { logger } from "hono/logger";
import { healthRoute } from "./routes/health";

export const app = new Hono();

app.use(logger());
app.route("/", healthRoute);

export type App = typeof app;
