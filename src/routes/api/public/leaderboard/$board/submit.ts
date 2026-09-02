import { createFileRoute } from "@tanstack/react-router";

import {
  MAX_PLAUSIBLE_SCORE_NO_RUN,
  checkRateLimit,
  json,
  logSecurityEvent,
  preflight,
  readJson,
  settleLeaderboardSubmitForRun,
  withPlayer,
} from "@/lib/game/backend.server";

export const Route = createFileRoute("/api/public/leaderboard/$board/submit")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request, params }) =>
        withPlayer(request, async (player) => {
          const board = params.board;
          if (!board || board.length > 64) return json({ error: "Invalid board" }, 400);

          if (!checkRateLimit(`submit:${player.id}`, 10, 60 * 1000)) {
            return json({ error: "Too many submissions — slow down" }, 429);
          }

          const body = await readJson(request);
          const score = Math.floor(Number(body["score"]));
          const runId = typeof body["runId"] === "string" ? body["runId"] : null;
          if (!Number.isFinite(score) || score < 0) return json({ error: "Invalid score" }, 400);

          if (runId) {
            const check = await settleLeaderboardSubmitForRun(player.id, runId, board, score);
            if (!check.ok) return json({ error: check.error }, check.status);
          } else {
            if (score > MAX_PLAUSIBLE_SCORE_NO_RUN) {
              void logSecurityEvent("implausible_score", { playerId: player.id, detail: { board, score } });
              return json({ error: "Score rejected" }, 400);
            }
            void logSecurityEvent("score_submit_without_run", { playerId: player.id, detail: { board, score } });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin
            .from("leaderboard_scores")
            .insert({ player_id: player.id, board, score });
          if (error) throw new Error(error.message);

          const best = await supabaseAdmin
            .from("leaderboard_scores")
            .select("score")
            .eq("player_id", player.id)
            .eq("board", board)
            .order("score", { ascending: false })
            .limit(1)
            .maybeSingle();
          return json({ ok: true, board, score, best: Number(best.data?.score ?? score) });
        }),
    },
  },
});
