import { createFileRoute } from "@tanstack/react-router";

import {
  applyLedgerEntry,
  hasLedgerEntry,
  json,
  preflight,
  readJson,
  withPlayer,
} from "@/lib/game/backend.server";

// One-time seed of a pre-existing local save. Rejected once the player's
// ledger has any entry at all, so it can never be replayed.
export const Route = createFileRoute("/api/public/currency/migrate-seed")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const coins = Math.floor(Number(body["coins"] ?? 0));
          const gems = Math.floor(Number(body["gems"] ?? 0));
          if (
            !Number.isFinite(coins) ||
            !Number.isFinite(gems) ||
            coins < 0 ||
            gems < 0 ||
            coins > 10_000_000 ||
            gems > 1_000_000
          ) {
            return json({ error: "Invalid amount" }, 400);
          }
          if (await hasLedgerEntry(player.id, "client_migration_seed")) {
            return json({ error: "Already migrated" }, 409);
          }
          try {
            const result = await applyLedgerEntry(player.id, {
              coinDelta: coins,
              gemDelta: gems,
              reason: "client_migration_seed",
              dedupeKey: "once",
            });
            return json(result);
          } catch (err) {
            if (err instanceof Error && err.message === "ALREADY_CLAIMED") {
              return json({ error: "Already migrated" }, 409);
            }
            throw err;
          }
        }),
    },
  },
});
