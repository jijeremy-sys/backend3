import { createFileRoute } from "@tanstack/react-router";

import { ADMIN_SESSION_COOKIE, preflight } from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/admin/logout")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: async () => {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
          },
        });
      },
    },
  },
});
