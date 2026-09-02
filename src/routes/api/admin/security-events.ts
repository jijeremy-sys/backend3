import { createFileRoute } from "@tanstack/react-router";

import { json, listSecurityEventsForAdmin, preflight, withAdmin } from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/admin/security-events")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request }) =>
        withAdmin(request, async () => {
          const events = await listSecurityEventsForAdmin(100);
          return json({ events });
        }),
    },
  },
});
