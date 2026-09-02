import { createFileRoute } from "@tanstack/react-router";

import {
  MAX_WAVE_JUMP_PER_REQUEST,
  applyLedgerEntry,
  json,
  logSecurityEvent,
  preflight,
  readJson,
  rewardsForWaveRange,
  settleWaveRewardForRun,
  withPlayer,
} from "@/lib/game/backend.server";

// The client sends *what happened* (it reached a new wave); the server
// decides what that is worth. When a runId is present (current clients),
// the run's own last-known wave and its real elapsed time are what's
// actually trusted — see settleWaveRewardForRun. Without one (older
// clients), fall back to the previous flat per-request cap.
export const Route = createFileRoute("/api/public/currency/wave-reward")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: ({ request }) =>
        withPlayer(request, async (player) => {
          const body = await readJson(request);
          const runId = typeof body["runId"] === "string" ? body["runId"] : null;
          const toWave = Number(body["toWave"]);
          if (!Number.isInteger(toWave) || toWave < 0) {
            return json({ error: "Invalid wave range" }, 400);
          }

          if (runId) {
            const result = await settleWaveRewardForRun(player.id, runId, toWave);
            if (!result) return json({ error: "Unknown or expired run" }, 400);
            return json(result);
          }

          // Legacy fallback (no runId): same behavior as before, still
          // capped per-request, but with no cross-request pacing check.
          const fromWave = Number(body["fromWave"]);
          if (!Number.isInteger(fromWave) || fromWave < 0 || toWave <= fromWave) {
            return json({ error: "Invalid wave range" }, 400);
          }
          void logSecurityEvent("wave_reward_without_run", { playerId: player.id, detail: { fromWave, toWave } });
          const clampedTo = Math.min(toWave, fromWave + MAX_WAVE_JUMP_PER_REQUEST);
          const { coins, gems } = rewardsForWaveRange(fromWave, clampedTo);
          const result = await applyLedgerEntry(player.id, {
            coinDelta: coins,
            gemDelta: gems,
            reason: "wave_reward",
            metadata: { fromWave, toWave: clampedTo },
          });
          return json({ ...result, coinsAwarded: coins, gemsAwarded: gems });
        }),
    },
  },
});
