import { createFileRoute } from "@tanstack/react-router";

import { json, listPlayersForAdmin, preflight, withAdmin } from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/admin/players")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request }) =>
        withAdmin(request, async () => {
          const url = new URL(request.url);
          const search = url.searchParams.get("q") ?? undefined;
          const limit = Number(url.searchParams.get("limit") ?? 50);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const { rows, total } = await listPlayersForAdmin({ search, limit, offset });
          return json({ players: rows, total });
        }),
    },
  },
});
