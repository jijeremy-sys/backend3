import { createFileRoute } from "@tanstack/react-router";

import {
  adminUpdatePlayer,
  deletePlayer,
  getPlayerStatsForAdmin,
  json,
  logAdminAction,
  preflight,
  readJson,
  withAdmin,
} from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/admin/players/$playerId")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) =>
        withAdmin(request, async () => {
          try {
            const stats = await getPlayerStatsForAdmin(params.playerId);
            return json(stats);
          } catch (err) {
            if (err instanceof Error && err.message === "NOT_FOUND") {
              return json({ error: "Player not found" }, 404);
            }
            throw err;
          }
        }),
      PATCH: ({ request, params }) =>
        withAdmin(request, async () => {
          const body = await readJson(request);
          const updates: { displayName?: string; coins?: number; gems?: number } = {};
          if (typeof body["displayName"] === "string") updates.displayName = body["displayName"].trim();
          if (typeof body["coins"] === "number") updates.coins = body["coins"];
          if (typeof body["gems"] === "number") updates.gems = body["gems"];

          const result = await adminUpdatePlayer(params.playerId, updates);
          if (!result.ok) return json({ error: result.error }, result.status);
          void logAdminAction(request, "edit_profile", params.playerId, updates);
          return json({ player: result.player });
        }),
      DELETE: ({ request, params }) =>
        withAdmin(request, async () => {
          await deletePlayer(params.playerId);
          void logAdminAction(request, "delete", params.playerId);
          return json({ ok: true });
        }),
    },
  },
});
