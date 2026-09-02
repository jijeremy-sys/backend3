import { createFileRoute } from "@tanstack/react-router";

import {
  CAMPAIGN_CLEAR_COIN_BONUS,
  CAMPAIGN_CLEAR_GEM_BONUS,
  applyLedgerEntry,
  json,
  preflight,
  readJson,
  withPlayer,
} from "@/lib/game/backend.server";

// Fixed bonus, deduped per level+difficulty so replaying a level can't farm it.
export const Route = createFileRoute("/api/public/currency/campaign-clear")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const levelId = typeof body["levelId"] === "string" ? body["levelId"] : "";
          const difficulty = typeof body["difficulty"] === "string" ? body["difficulty"] : "";
          if (!levelId || !difficulty) return json({ error: "Invalid level/difficulty" }, 400);

          try {
            const result = await applyLedgerEntry(player.id, {
              coinDelta: CAMPAIGN_CLEAR_COIN_BONUS,
              gemDelta: CAMPAIGN_CLEAR_GEM_BONUS,
              reason: "campaign_clear",
              dedupeKey: `${levelId}:${difficulty}`,
              metadata: { levelId, difficulty },
            });
            return json({
              ...result,
              coinsAwarded: CAMPAIGN_CLEAR_COIN_BONUS,
              gemsAwarded: CAMPAIGN_CLEAR_GEM_BONUS,
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
