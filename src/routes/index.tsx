import { useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import { getBackendStats } from "@/lib/game/stats.functions";
import { isAdminSession } from "@/lib/game/backend.server";

const checkAdminAuth = createServerFn({ method: "GET" }).handler(async () => {
  const request = getWebRequest();
  return { authed: request ? await isAdminSession(request) : false };
});

const statsQuery = queryOptions({
  queryKey: ["backend-stats"],
  queryFn: () => getBackendStats(),
});

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { authed } = await checkAdminAuth();
    if (!authed) {
      throw redirect({ to: "/login" });
    }
  },
  head: () => ({
    meta: [
      { title: "SwarmStrike Backend — Live API & Data" },
      {
        name: "description",
        content:
          "Status dashboard for the SwarmStrike game backend: accounts, server-authoritative currency, cloud saves and leaderboards.",
      },
      { property: "og:title", content: "SwarmStrike Backend — Live API & Data" },
      {
        property: "og:description",
        content:
          "Status dashboard for the SwarmStrike game backend: accounts, currency, cloud saves and leaderboards.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(statsQuery),
  component: Dashboard,
});

const ENDPOINTS: { method: string; path: string; auth: boolean; purpose: string }[] = [
  { method: "POST", path: "/api/public/auth/login", auth: false, purpose: "{ deviceId } → { token, player }" },
  { method: "POST", path: "/api/public/auth/set-username", auth: true, purpose: "{ username } → { player }" },
  { method: "GET", path: "/api/public/me", auth: true, purpose: "Current player + balances" },
  { method: "POST", path: "/api/public/run/start", auth: true, purpose: "{ board? } → { runId, startedAt }" },
  { method: "POST", path: "/api/public/currency/wave-reward", auth: true, purpose: "{ runId, toWave }" },
  { method: "POST", path: "/api/public/currency/campaign-clear", auth: true, purpose: "{ levelId, difficulty }" },
  { method: "POST", path: "/api/public/currency/weekly-bonus", auth: true, purpose: "{ weekId }" },
  { method: "POST", path: "/api/public/currency/buy-gear", auth: true, purpose: "{ itemId }" },
  { method: "POST", path: "/api/public/currency/migrate-seed", auth: true, purpose: "{ coins, gems }" },
  { method: "POST", path: "/api/public/currency/redeem-iap", auth: true, purpose: "{ receiptId, coins, gems }" },
  { method: "GET", path: "/api/public/save", auth: true, purpose: "Cloud save blob" },
  { method: "PUT", path: "/api/public/save", auth: true, purpose: "{ payload } → filtered save" },
  { method: "POST", path: "/api/public/leaderboard/:board/submit", auth: true, purpose: "{ score, runId? }" },
  { method: "GET", path: "/api/public/leaderboard/:board/top", auth: false, purpose: "?limit=20" },
  { method: "GET", path: "/api/public/leaderboard/:board/me", auth: true, purpose: "Personal best" },
];

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-card-foreground tabular-nums">{value}</p>
    </div>
  );
}

function Dashboard() {
  const { data } = useSuspenseQuery(statsQuery);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Live backend
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground">
            SwarmStrike API
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Anonymous device login, server-authoritative currency, cloud saves and leaderboards —
            running on a managed Postgres database. Data below is live.
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </header>

      <section className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Players" value={data.players} />
        <Stat label="Ledger rows" value={data.ledgerEntries} />
        <Stat label="Cloud saves" value={data.saves} />
        <Stat label="Scores" value={data.scores} />
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-foreground">Endpoints</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={`${e.method} ${e.path}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{e.method}</td>
                  <td className="px-4 py-2 font-mono text-xs text-foreground">{e.path}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {e.auth ? "bearer" : "public"} · {e.purpose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-foreground">Recent currency activity</h2>
        {data.recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No currency events recorded yet — they appear here as soon as the game calls the API.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {data.recent.map((row, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">{row.reason}</span>
                <span className="tabular-nums text-card-foreground">
                  {row.coinDelta >= 0 ? "+" : ""}
                  {row.coinDelta} coins · {row.gemDelta >= 0 ? "+" : ""}
                  {row.gemDelta} gems
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PlayersPanel />
      <SecurityPanel />
    </main>
  );
}

// --------------------------------------------------------------- players panel

type AdminPlayer = {
  id: string;
  device_id: string;
  display_name: string | null;
  coins: number;
  gems: number;
  banned: boolean;
  created_at: string | null;
};

type PlayerDetail = {
  player: {
    id: string;
    deviceId: string;
    displayName: string | null;
    coins: number;
    gems: number;
    banned: boolean;
    createdAt: string | null;
  };
  ledgerEntries: number;
  save: { updatedAt: string; payload: Record<string, string> } | null;
  scores: { board: string; score: number; updatedAt: string }[];
};

function PlayersPanel() {
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit form state for the expanded player.
  const [editName, setEditName] = useState("");
  const [editCoins, setEditCoins] = useState("");
  const [editGems, setEditGems] = useState("");
  const [editSaveJson, setEditSaveJson] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingGear, setSavingGear] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [gearError, setGearError] = useState<string | null>(null);

  async function loadPlayers(q: string) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/admin/players", window.location.origin);
      if (q) url.searchParams.set("q", q);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load players");
      const json = (await res.json()) as { players: AdminPlayer[]; total: number };
      setPlayers(json.players);
      setTotal(json.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load players");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlayers("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleExpand(player: AdminPlayer) {
    if (expandedId === player.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(player.id);
    setDetail(null);
    setEditError(null);
    setGearError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/players/${player.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load player");
      const data = (await res.json()) as PlayerDetail;
      setDetail(data);
      setEditName(data.player.displayName ?? "");
      setEditCoins(String(data.player.coins));
      setEditGems(String(data.player.gems));
      setEditSaveJson(data.save ? JSON.stringify(data.save.payload, null, 2) : "{}");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load player");
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveProfile(player: AdminPlayer) {
    setEditError(null);
    setSavingProfile(true);
    try {
      const patch: Record<string, unknown> = {};
      if (editName.trim() !== (player.display_name ?? "")) patch.displayName = editName.trim();
      const coinsNum = Number(editCoins);
      if (Number.isFinite(coinsNum) && coinsNum !== player.coins) patch.coins = coinsNum;
      const gemsNum = Number(editGems);
      if (Number.isFinite(gemsNum) && gemsNum !== player.gems) patch.gems = gemsNum;

      if (Object.keys(patch).length === 0) {
        setSavingProfile(false);
        return;
      }

      const res = await fetch(`/api/admin/players/${player.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) {
        setEditError(body?.error ?? "Failed to save changes");
        return;
      }
      const updated = body.player as { display_name: string | null; coins: number; gems: number };
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === player.id
            ? { ...p, display_name: updated.display_name, coins: updated.coins, gems: updated.gems }
            : p,
        ),
      );
      setDetail((d) =>
        d
          ? {
              ...d,
              player: {
                ...d.player,
                displayName: updated.display_name,
                coins: updated.coins,
                gems: updated.gems,
              },
            }
          : d,
      );
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveGear(player: AdminPlayer) {
    setGearError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editSaveJson);
    } catch {
      setGearError("That's not valid JSON.");
      return;
    }
    setSavingGear(true);
    try {
      const res = await fetch(`/api/admin/players/${player.id}/save`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: parsed }),
      });
      const body = await res.json();
      if (!res.ok) {
        setGearError(body?.error ?? "Failed to save gear");
        return;
      }
      setEditSaveJson(JSON.stringify(body.payload, null, 2));
      setDetail((d) => (d ? { ...d, save: { updatedAt: new Date().toISOString(), payload: body.payload } } : d));
    } catch (err) {
      setGearError(err instanceof Error ? err.message : "Failed to save gear");
    } finally {
      setSavingGear(false);
    }
  }

  async function toggleBan(player: AdminPlayer) {
    const nextBanned = !player.banned;
    if (nextBanned && !window.confirm(`Block ${player.display_name ?? player.device_id}?`)) return;
    try {
      const res = await fetch(`/api/admin/players/${player.id}/block`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ banned: nextBanned }),
      });
      if (!res.ok) throw new Error("Failed to update player");
      setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, banned: nextBanned } : p)));
      if (detail && detail.player.id === player.id) {
        setDetail({ ...detail, player: { ...detail.player, banned: nextBanned } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update player");
    }
  }

  async function removePlayer(player: AdminPlayer) {
    if (
      !window.confirm(
        `Permanently delete ${player.display_name ?? player.device_id}? This removes their saves, ledger and scores too.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/admin/players/${player.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete player");
      setPlayers((prev) => prev.filter((p) => p.id !== player.id));
      setTotal((t) => t - 1);
      if (expandedId === player.id) {
        setExpandedId(null);
        setDetail(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete player");
    }
  }

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Players ({total})</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadPlayers(query);
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by device id or name"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Search
          </button>
        </form>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {loading && <p className="mt-3 text-sm text-muted-foreground">Loading players…</p>}

      {!loading && players.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No players found.</p>
      )}

      <div className="mt-4 space-y-2">
        {players.map((player) => (
          <div key={player.id} className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <button
                onClick={() => toggleExpand(player)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-card-foreground">
                  {player.display_name ?? "Unnamed player"}{" "}
                  {player.banned && (
                    <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                      Blocked
                    </span>
                  )}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">{player.device_id}</p>
              </button>
              <div className="flex shrink-0 items-center gap-4 text-xs tabular-nums text-muted-foreground">
                <span>{player.coins} coins</span>
                <span>{player.gems} gems</span>
                <button
                  onClick={() => toggleBan(player)}
                  className="rounded-lg border border-border px-2.5 py-1 font-medium text-muted-foreground hover:text-foreground"
                >
                  {player.banned ? "Unblock" : "Block"}
                </button>
                <button
                  onClick={() => removePlayer(player)}
                  className="rounded-lg border border-destructive/40 px-2.5 py-1 font-medium text-destructive hover:bg-destructive/10"
                >
                  Remove
                </button>
              </div>
            </div>

            {expandedId === player.id && (
              <div className="border-t border-border px-4 py-4 text-xs text-muted-foreground">
                {detailLoading && <p>Loading stats…</p>}
                {!detailLoading && detail && (
                  <div className="space-y-5">
                    <div className="space-y-1">
                      <p>Joined: {detail.player.createdAt ?? "unknown"}</p>
                      <p>Ledger entries: {detail.ledgerEntries}</p>
                      <p>Cloud save: {detail.save ? `last updated ${detail.save.updatedAt}` : "none"}</p>
                      {detail.scores.length > 0 ? (
                        <div>
                          <p className="mt-1">Leaderboard scores:</p>
                          <ul className="ml-4 list-disc">
                            {detail.scores.map((s) => (
                              <li key={s.board}>
                                {s.board}: {s.score} (updated {s.updatedAt})
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p>No leaderboard scores.</p>
                      )}
                    </div>

                    <div className="rounded-lg border border-border bg-background p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                        Edit profile
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide">Username</span>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide">Coins</span>
                          <input
                            type="number"
                            min={0}
                            value={editCoins}
                            onChange={(e) => setEditCoins(e.target.value)}
                            className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide">Gems</span>
                          <input
                            type="number"
                            min={0}
                            value={editGems}
                            onChange={(e) => setEditGems(e.target.value)}
                            className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                          />
                        </label>
                      </div>
                      {editError && <p className="mt-2 text-destructive">{editError}</p>}
                      <button
                        onClick={() => saveProfile(player)}
                        disabled={savingProfile}
                        className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
                      >
                        {savingProfile ? "Saving…" : "Save profile"}
                      </button>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                        Edit gear / save data
                      </p>
                      <p className="mt-1 text-[11px]">
                        Raw cloud-save JSON — inventory, equipped items/abilities, talents, skins, etc.
                        Only recognized keys are kept.
                      </p>
                      <textarea
                        value={editSaveJson}
                        onChange={(e) => setEditSaveJson(e.target.value)}
                        spellCheck={false}
                        rows={10}
                        className="mt-2 w-full rounded border border-border bg-card p-2 font-mono text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary"
                      />
                      {gearError && <p className="mt-2 text-destructive">{gearError}</p>}
                      <button
                        onClick={() => saveGear(player)}
                        disabled={savingGear}
                        className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
                      >
                        {savingGear ? "Saving…" : "Save gear"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// --------------------------------------------------------------- security panel

type SecurityEvent = {
  id: number;
  type: string;
  player_id: string | null;
  player_display_name: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

const EVENT_BADGE_STYLE: Record<string, string> = {
  admin_login_fail: "bg-destructive/15 text-destructive",
  admin_login_rate_limited: "bg-destructive/15 text-destructive",
  admin_login_success: "bg-emerald-500/15 text-emerald-600",
  implausible_wave_reward: "bg-amber-500/15 text-amber-600",
  implausible_score: "bg-amber-500/15 text-amber-600",
  many_accounts_same_ip: "bg-amber-500/15 text-amber-600",
  player_rate_limited: "bg-amber-500/15 text-amber-600",
};

function SecurityPanel() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/security-events", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load security events");
      const data = (await res.json()) as { events: SecurityEvent[] };
      setEvents(data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load security events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Security &amp; audit log</h2>
        <button
          onClick={load}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Failed admin logins, rate-limited requests, implausible scores/rewards, IP-sharing
        signals, and every admin action taken from this dashboard.
      </p>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {loading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {!loading && events.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No security events recorded yet.</p>
      )}

      <div className="mt-4 space-y-1.5">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  EVENT_BADGE_STYLE[event.type] ?? "bg-muted text-muted-foreground"
                }`}
              >
                {event.type}
              </span>
              {event.player_display_name && (
                <span className="text-card-foreground">{event.player_display_name}</span>
              )}
              {event.ip && <span className="font-mono text-muted-foreground">{event.ip}</span>}
              {event.detail && (
                <span className="truncate font-mono text-muted-foreground">
                  {JSON.stringify(event.detail)}
                </span>
              )}
            </div>
            <span className="shrink-0 text-muted-foreground">{event.created_at}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
