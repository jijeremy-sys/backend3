import { createFileRoute } from "@tanstack/react-router";

import { json, preflight, withPlayer } from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/public/leaderboard/$board/me")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) =>
        withPlayer(request, async (player) => {
          const board = params.board;
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("leaderboard_scores")
            .select("score, created_at")
            .eq("board", board)
            .eq("player_id", player.id)
            .order("score", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return json({
            board,
            best: data ? Number(data.score) : null,
            createdAt: data?.created_at ?? null,
          });
        }),
    },
  },
});
