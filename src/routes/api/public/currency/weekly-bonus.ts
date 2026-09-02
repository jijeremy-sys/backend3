import { createFileRoute } from "@tanstack/react-router";

import {
  WEEKLY_BONUS_COINS,
  WEEKLY_BONUS_GEMS,
  applyLedgerEntry,
  json,
  preflight,
  readJson,
  withPlayer,
} from "@/lib/game/backend.server";

// One-time weekly challenge bonus, deduped by weekId.
export const Route = createFileRoute("/api/public/currency/weekly-bonus")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const weekId = typeof body["weekId"] === "string" ? body["weekId"] : "";
          if (!weekId) return json({ error: "Invalid weekId" }, 400);
          try {
            const result = await applyLedgerEntry(player.id, {
              coinDelta: WEEKLY_BONUS_COINS,
              gemDelta: WEEKLY_BONUS_GEMS,
              reason: "weekly_bonus",
              dedupeKey: weekId,
              metadata: { weekId },
            });
            return json({
              ...result,
              coinsAwarded: WEEKLY_BONUS_COINS,
              gemsAwarded: WEEKLY_BONUS_GEMS,
            });
          } catch (err) {
            if (err instanceof Error && err.message === "ALREADY_CLAIMED") {
              return json({ error: "Already claimed" }, 409);
            }
            throw err;
          }
        }),
    },
  },
});
