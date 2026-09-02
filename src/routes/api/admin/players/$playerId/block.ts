import { createFileRoute } from "@tanstack/react-router";

import { json, logAdminAction, preflight, readJson, setPlayerBanned, withAdmin } from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/admin/players/$playerId/block")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) =>
        withAdmin(request, async () => {
          const body = await readJson(request);
          const banned = body["banned"] !== false; // default true (block); pass { banned: false } to unblock
          await setPlayerBanned(params.playerId, banned);
          void logAdminAction(request, banned ? "block" : "unblock", params.playerId);
          return json({ ok: true, banned });
        }),
    },
  },
});
