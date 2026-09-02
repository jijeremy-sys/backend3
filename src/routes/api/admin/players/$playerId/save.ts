import { createFileRoute } from "@tanstack/react-router";

import { adminUpdateSave, json, logAdminAction, preflight, readJson, withAdmin } from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/admin/players/$playerId/save")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      PUT: ({ request, params }) =>
        withAdmin(request, async () => {
          const body = await readJson(request);
          const payload = body["payload"];
          if (!payload || typeof payload !== "object") {
            return json({ error: "Invalid save payload" }, 400);
          }
          const filtered = await adminUpdateSave(params.playerId, payload as Record<string, unknown>);
          void logAdminAction(request, "edit_save", params.playerId);
          return json({ ok: true, payload: filtered });
        }),
    },
  },
});
