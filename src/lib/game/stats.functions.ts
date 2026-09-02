import { createServerFn } from "@tanstack/react-start";

export type BackendStats = {
  players: number;
  ledgerEntries: number;
  saves: number;
  scores: number;
  recent: { reason: string; coinDelta: number; gemDelta: number; createdAt: string }[];
};

export const getBackendStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<BackendStats> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const count = async (table: "players" | "currency_ledger" | "saves" | "leaderboard_scores") => {
      const { count: c } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true });
      return c ?? 0;
    };

    const [players, ledgerEntries, saves, scores] = await Promise.all([
      count("players"),
      count("currency_ledger"),
      count("saves"),
      count("leaderboard_scores"),
    ]);

    const { data } = await supabaseAdmin
      .from("currency_ledger")
      .select("reason, coin_delta, gem_delta, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    return {
      players,
      ledgerEntries,
      saves,
      scores,
      recent: (data ?? []).map((row) => ({
        reason: row.reason,
        coinDelta: Number(row.coin_delta),
        gemDelta: Number(row.gem_delta),
        createdAt: row.created_at,
      })),
    };
  },
);
