import { createFileRoute } from "@tanstack/react-router";

import { json, preflight, readJson, startRun, withPlayer } from "@/lib/game/backend.server";

// Called once when a game session begins. Everything that pays out currency
// or accepts a leaderboard score for this session should reference the
// returned runId — that's what lets the server check claims against real
// elapsed time instead of trusting the client.
export const Route = createFileRoute("/api/public/run/start")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const board = typeof body["board"] === "string" ? body["board"].slice(0, 64) : undefined;
          const { runId, startedAt } = await startRun(player.id, board);
          return json({ runId, startedAt });
        }),
    },
  },
});
