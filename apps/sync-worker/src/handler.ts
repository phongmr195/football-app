import type { Handler } from "aws-lambda";
import { syncLiveMatches } from "./sync-live-matches";

export const handler: Handler = async () => {
  const result = await syncLiveMatches();
  return { statusCode: 200, body: JSON.stringify(result) };
};
