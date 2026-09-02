import { createFileRoute } from "@tanstack/react-router";

import { json, playerPublic, preflight, readJson, setPlayerUsername, withPlayer } from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/public/auth/set-username")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const username = typeof body["username"] === "string" ? body["username"].trim() : "";
          const result = await setPlayerUsername(player.id, username);
          if (!result.ok) {
            return json({ error: result.error }, result.status);
          }
          return json({ player: playerPublic(result.player) });
        }),
    },
  },
});
