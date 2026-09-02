import { createFileRoute } from "@tanstack/react-router";

import { json, playerPublic, preflight, withPlayer } from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/public/me")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request }) => withPlayer(request, async (player) => json({ player: playerPublic(player) })),
    },
  },
});
