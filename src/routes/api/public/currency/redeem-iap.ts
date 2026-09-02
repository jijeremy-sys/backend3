import { createFileRoute } from "@tanstack/react-router";

import { applyLedgerEntry, json, preflight, readJson, withPlayer } from "@/lib/game/backend.server";

// Credits currency once per unique receipt. This does NOT yet verify the
// receipt with Apple/Google/Stripe — do that before shipping real purchases.
export const Route = createFileRoute("/api/public/currency/redeem-iap")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const receiptId = typeof body["receiptId"] === "string" ? body["receiptId"] : "";
          const coins = Math.floor(Number(body["coins"] ?? 0));
          const gems = Math.floor(Number(body["gems"] ?? 0));
          if (receiptId.length < 4 || coins < 0 || gems < 0) {
            return json({ error: "Invalid receipt payload" }, 400);
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const claim = await supabaseAdmin
            .from("redeemed_receipts")
            .insert({ receipt_id: receiptId, player_id: player.id });
          if (claim.error) {
            if (claim.error.message.includes("duplicate key")) {
              return json({ error: "Receipt already redeemed" }, 409);
            }
            throw new Error(claim.error.message);
          }

          const result = await applyLedgerEntry(player.id, {
            coinDelta: coins,
            gemDelta: gems,
            reason: "iap_purchase",
            dedupeKey: receiptId,
            metadata: { receiptId },
          });
          return json(result);
        }),
    },
  },
});
