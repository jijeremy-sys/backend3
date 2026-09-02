import { createFileRoute } from "@tanstack/react-router";

import { json, preflight } from "@/lib/game/backend.server";

// Public read: top scores on a named board (e.g. "endless_best_time").
export const Route = createFileRoute("/api/public/leaderboard/$board/top")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request, params }) => {
        const board = params.board;
        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("leaderboard_scores")
          .select("score, created_at, players(id, display_name)")
          .eq("board", board)
          .order("score", { ascending: false })
          .limit(limit);
        if (error) {
          console.error("[leaderboard/top]", error.message);
          return json({ error: "Could not load leaderboard" }, 500);
        }

        const entries = (data ?? []).map((row, index) => {
          const player = row.players as unknown as { id: string; display_name: string | null } | null;
          return {
            rank: index + 1,
            score: Number(row.score),
            createdAt: row.created_at,
            playerId: player?.id ?? null,
            displayName: player?.display_name ?? null,
          };
        });
        return json({ board, entries });
      },
    },
  },
});
