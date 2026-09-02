import { createFileRoute } from "@tanstack/react-router";

import { ALL_SAVE_KEYS, json, preflight, readJson, withPlayer } from "@/lib/game/backend.server";

// Cloud save: one JSON blob per player, filtered to known keys so a save
// request can never smuggle arbitrary data into a player's record.
export const Route = createFileRoute("/api/public/save")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request }) =>
        withPlayer(request, async (player) => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("saves")
            .select("payload, updated_at")
            .eq("player_id", player.id)
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (!data) return json({ payload: null, updatedAt: null });
          return json({ payload: data.payload, updatedAt: data.updated_at });
        }),
      PUT: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const payload = body["payload"];
          if (!payload || typeof payload !== "object") {
            return json({ error: "Invalid save payload" }, 400);
          }
          const source = payload as Record<string, unknown>;
          const filtered: Record<string, string> = {};
          for (const key of ALL_SAVE_KEYS) {
            if (typeof source[key] === "string") filtered[key] = source[key];
          }

          const updatedAt = new Date().toISOString();
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin
            .from("saves")
            .upsert({ player_id: player.id, payload: filtered, updated_at: updatedAt });
          if (error) throw new Error(error.message);
          return json({ ok: true, updatedAt, keysStored: Object.keys(filtered).length });
        }),
    },
  },
});
