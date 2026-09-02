import { createFileRoute } from "@tanstack/react-router";

import {
  GEAR_SHOP_ITEM_IDS,
  GEAR_SHOP_PRICE,
  applyLedgerEntry,
  json,
  preflight,
  rarityFromShopItemId,
  readJson,
  withPlayer,
} from "@/lib/game/backend.server";

// Price is looked up server-side by rarity — never taken from the request.
export const Route = createFileRoute("/api/public/currency/buy-gear")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const itemId = typeof body["itemId"] === "string" ? body["itemId"] : "";
          if (!GEAR_SHOP_ITEM_IDS.has(itemId)) return json({ error: "Unknown gear item" }, 400);

          const price = GEAR_SHOP_PRICE[rarityFromShopItemId(itemId)];
          if (!price) return json({ error: "Unknown rarity for item" }, 400);

          try {
            const result = await applyLedgerEntry(player.id, {
              coinDelta: -price.coins,
              gemDelta: -price.gems,
              reason: "gear_shop_buy",
              dedupeKey: itemId,
              metadata: { itemId },
            });
            return json({ ...result, itemId });
          } catch (err) {
            if (err instanceof Error && err.message === "ALREADY_CLAIMED") {
              return json({ error: "Already owned" }, 409);
            }
            throw err;
          }
        }),
    },
  },
});
