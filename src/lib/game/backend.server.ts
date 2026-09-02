// Server-only helpers for the SwarmStrike game backend.
// Every coin/gem mutation goes through the database function
// public.apply_ledger_entry so balances and the ledger stay consistent.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ---------------------------------------------------------------- CORS / JSON

export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-max-age": "86400",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ------------------------------------------------------------- security utils
// Shared by admin login hardening, currency abuse checks, and the dashboard's
// security panel.

/** Best-effort client IP from standard proxy headers. Never trust this for
 *  anything beyond coarse abuse signals — it's trivially spoofable by a
 *  direct client, but reflects reality behind a normal reverse proxy/CDN. */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function logSecurityEvent(
  type: string,
  opts: { playerId?: string | null; ip?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    await supabaseAdmin.from("security_events").insert({
      type,
      player_id: opts.playerId ?? null,
      ip: opts.ip ?? null,
      detail: opts.detail ?? null,
    });
  } catch (err) {
    // Never let logging failures break the request it's attached to.
    console.error("[security-event]", err);
  }
}

/**
 * In-memory sliding-window rate limiter. Cheap and dependency-free, but only
 * effective within a single running server process — on a multi-instance or
 * serverless deployment each instance has its own counters, so treat this as
 * a first line of defense, not a hard guarantee. For a stronger guarantee,
 * back this with a shared store (Redis, or a Postgres table) instead.
 */
const rateLimitWindows = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateLimitWindows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    rateLimitWindows.set(key, hits);
    return false;
  }
  hits.push(now);
  rateLimitWindows.set(key, hits);
  return true;
}

/** Flags (without blocking) when many distinct accounts share a recent IP —
 *  a common signature of reward/referral farming with throwaway devices. */
export async function checkIpAbuse(ip: string, playerId: string): Promise<void> {
  if (!ip || ip === "unknown") return;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id")
    .or(`signup_ip.eq.${ip},last_ip.eq.${ip}`)
    .gte("created_at", since);
  if (error) return;
  const distinctCount = new Set((data ?? []).map((r) => r.id)).size;
  if (distinctCount >= 5) {
    await logSecurityEvent("many_accounts_same_ip", { playerId, ip, detail: { count: distinctCount } });
  }
}

// ------------------------------------------------------------------- admin auth
// Simple gate for the dashboard at "/" — not related to player auth above.
//
// The password is never stored as plaintext, not even in an env var: only a
// SHA-256 hash of it lives in ADMIN_PASSWORD_HASH. Login hashes whatever the
// person typed and compares hashes, so the real password isn't recoverable
// from this file, the deployment config, or a source/zip leak.
const ADMIN_USERNAME = process.env["ADMIN_USERNAME"] ?? "";
const ADMIN_PASSWORD_HASH = (process.env["ADMIN_PASSWORD_HASH"] ?? "").toLowerCase();

if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
  console.warn(
    "[admin] ADMIN_USERNAME/ADMIN_PASSWORD_HASH are not set — admin login will reject every " +
      "attempt until both are configured. See migrations/README for how to generate the hash.",
  );
}

export const ADMIN_SESSION_COOKIE = "ss_admin_session";

/** Admin login attempt gate: 5 failed attempts per IP per 15 minutes. */
export function checkAdminLoginRateLimit(ip: string): boolean {
  return checkRateLimit(`admin-login:${ip}`, 5, 15 * 60 * 1000);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish string comparison — avoids leaking match length via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkAdminCredentials(username: string, password: string): Promise<boolean> {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) return false;
  const hash = await sha256Hex(password);
  return safeEqual(username, ADMIN_USERNAME) && safeEqual(hash, ADMIN_PASSWORD_HASH);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function isAdminSession(request: Request): Promise<boolean> {
  const token = readCookie(request, ADMIN_SESSION_COOKIE);
  if (!token) return false;
  return (await verifyAdminToken(token)) !== null;
}

/** Wraps a handler so it only runs for an authenticated admin session. */
export async function withAdmin(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (!(await isAdminSession(request))) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    return await handler();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[admin]", message);
    return json({ error: message }, 500);
  }
}

/** Records an admin action (block/unblock/edit/delete) to the audit log. */
export async function logAdminAction(
  request: Request,
  action: string,
  targetPlayerId: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await logSecurityEvent(`admin_action:${action}`, {
    playerId: targetPlayerId,
    ip: getClientIp(request),
    detail,
  });
}

async function adminKey(): Promise<CryptoKey> {
  const secret = process.env["GAME_JWT_SECRET"] ?? "dev-admin-secret";
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function signAdminToken(): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ a: "admin", exp: Date.now() + ADMIN_SESSION_TTL_MS })),
  );
  const sig = await crypto.subtle.sign("HMAC", await adminKey(), new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

async function verifyAdminToken(token: string): Promise<true | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await adminKey(),
    fromB64url(sig).slice().buffer as ArrayBuffer,
    new TextEncoder().encode(payload),
  );
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      exp?: number;
    };
    if (!data.exp || data.exp < Date.now()) return null;
    return true;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------- token
// Anonymous device-id auth: a signed token (HMAC-SHA256, Web Crypto) that
// carries the player id and an expiry. No passwords, same contract as before.

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function key(): Promise<CryptoKey> {
  const secret = process.env["GAME_JWT_SECRET"];
  if (!secret) throw new Error("GAME_JWT_SECRET is not configured");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signToken(playerId: string): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ playerId, exp: Date.now() + TOKEN_TTL_MS })),
  );
  const sig = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

async function verifyToken(token: string): Promise<string | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await key(),
    fromB64url(sig).slice().buffer as ArrayBuffer,
    new TextEncoder().encode(payload),
  );
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      playerId?: string;
      exp?: number;
    };
    if (!data.playerId || !data.exp || data.exp < Date.now()) return null;
    return data.playerId;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------- player

export type Player = {
  id: string;
  device_id: string;
  display_name: string | null;
  coins: number;
  gems: number;
  banned?: boolean;
};

export function playerPublic(player: Player) {
  return {
    id: player.id,
    displayName: player.display_name,
    coins: Number(player.coins),
    gems: Number(player.gems),
  };
}

export async function loginWithDeviceId(deviceId: string, ip?: string) {
  const existing = await supabaseAdmin
    .from("players")
    .select("id, device_id, display_name, coins, gems, banned")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  let player = existing.data as Player | null;
  let isNewPlayer = false;
  if (!player) {
    isNewPlayer = true;
    const created = await supabaseAdmin
      .from("players")
      .insert({ device_id: deviceId, signup_ip: ip ?? null, last_ip: ip ?? null })
      .select("id, device_id, display_name, coins, gems, banned")
      .single();
    // A concurrent first login can win the unique index race; re-read then.
    if (created.error) {
      const retry = await supabaseAdmin
        .from("players")
        .select("id, device_id, display_name, coins, gems, banned")
        .eq("device_id", deviceId)
        .single();
      if (retry.error) throw new Error(retry.error.message);
      player = retry.data as Player;
    } else {
      player = created.data as Player;
    }
  }

  if (player.banned) throw new Error("ACCOUNT_BANNED");

  if (ip) {
    void supabaseAdmin.from("players").update({ last_ip: ip }).eq("id", player.id);
    void checkIpAbuse(ip, player.id);
  }
  if (isNewPlayer) {
    void logSecurityEvent("player_signup", { playerId: player.id, ip });
  }

  return { token: await signToken(player.id), player };
}

/** Resolves the caller from the Authorization header, or null when unauthenticated. */
export async function getPlayer(request: Request): Promise<Player | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const playerId = await verifyToken(token);
  if (!playerId) return null;
  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id, device_id, display_name, coins, gems, banned")
    .eq("id", playerId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Player;
}

/** Wraps a handler so it only runs for an authenticated, non-banned player. */
export async function withPlayer(
  request: Request,
  handler: (player: Player) => Promise<Response>,
): Promise<Response> {
  const player = await getPlayer(request);
  if (!player) return json({ error: "Missing or invalid bearer token" }, 401);
  if (player.banned) return json({ error: "Account suspended" }, 403);
  if (!checkRateLimit(`player:${player.id}`, 60, 60 * 1000)) {
    void logSecurityEvent("player_rate_limited", { playerId: player.id, ip: getClientIp(request) });
    return json({ error: "Too many requests — slow down" }, 429);
  }
  try {
    return await handler(player);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("INSUFFICIENT_FUNDS")) {
      return json({ error: "Not enough currency" }, 402);
    }
    console.error("[game-backend]", message);
    return json({ error: message }, 500);
  }
}

// ------------------------------------------------------------------- currency

export type LedgerResult = { coins: number; gems: number };

/**
 * Applies a coin/gem delta atomically and records why. `dedupeKey` makes the
 * grant idempotent (a unique index rejects a second identical grant), which is
 * what stops a replayed request farming the same bonus twice.
 */
export async function applyLedgerEntry(
  playerId: string,
  opts: {
    coinDelta?: number;
    gemDelta?: number;
    reason: string;
    dedupeKey?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<LedgerResult> {
  const { data, error } = await supabaseAdmin.rpc("apply_ledger_entry", {
    p_player_id: playerId,
    p_coin_delta: opts.coinDelta ?? 0,
    p_gem_delta: opts.gemDelta ?? 0,
    p_reason: opts.reason,
    p_dedupe_key: opts.dedupeKey ?? null,
    p_metadata: opts.metadata ?? null,
  } as never);
  if (error) {
    if (error.message.includes("duplicate key")) throw new Error("ALREADY_CLAIMED");
    throw new Error(error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as LedgerResult | undefined;
  return { coins: Number(row?.coins ?? 0), gems: Number(row?.gems ?? 0) };
}

export async function hasLedgerEntry(playerId: string, reason: string, dedupeKey?: string) {
  let query = supabaseAdmin
    .from("currency_ledger")
    .select("id")
    .eq("player_id", playerId)
    .eq("reason", reason)
    .limit(1);
  if (dedupeKey !== undefined) query = query.eq("dedupe_key", dedupeKey);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

// Reward tables mirrored from the client's currency.ts — the server keeps the
// authoritative copy so a tampered client can't declare its own payout.
const coinsForWave = (wave: number) => 20 + wave * 4;
const gemsForWave = (wave: number) => (wave % 5 === 0 ? 2 : 0);

export const MAX_WAVE_JUMP_PER_REQUEST = 5;

export function rewardsForWaveRange(from: number, to: number) {
  let coins = 0;
  let gems = 0;
  for (let w = from + 1; w <= to; w++) {
    coins += coinsForWave(w);
    gems += gemsForWave(w);
  }
  return { coins, gems };
}

export const CAMPAIGN_CLEAR_COIN_BONUS = 150;
export const CAMPAIGN_CLEAR_GEM_BONUS = 8;
export const WEEKLY_BONUS_COINS = 300;
export const WEEKLY_BONUS_GEMS = 20;

// ---------------------------------------------------------------- runs (anti-cheat)
// A "run" is opened server-side the moment a game session starts and is the
// anchor everything else gets checked against: wave-clear payouts and
// leaderboard submissions can't claim more progress than real elapsed wall-
// clock time makes possible. Clients that don't send a runId (older builds,
// or a request replayed without one) fall back to stricter flat limits.

export const MIN_MS_PER_WAVE = 2500; // conservative floor — real play is slower
export const MAX_RUN_AGE_MS = 12 * 60 * 60 * 1000; // runs older than this are refused

export async function startRun(playerId: string, board?: string | null) {
  const { data, error } = await supabaseAdmin
    .from("runs")
    .insert({ player_id: playerId, board: board ?? null })
    .select("id, started_at")
    .single();
  if (error) throw new Error(error.message);
  return { runId: data.id as string, startedAt: data.started_at as string };
}

type RunRow = {
  id: string;
  player_id: string;
  board: string | null;
  started_at: string;
  last_wave: number;
  submitted: boolean;
};

/** Loads a run and checks it belongs to this player and isn't stale. Returns
 *  null (rather than throwing) so callers can gracefully fall back. */
async function getOwnedRun(runId: string, playerId: string): Promise<RunRow | null> {
  const { data, error } = await supabaseAdmin
    .from("runs")
    .select("id, player_id, board, started_at, last_wave, submitted")
    .eq("id", runId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - new Date(data.started_at).getTime();
  if (age > MAX_RUN_AGE_MS || age < 0) return null;
  return data as RunRow;
}

/**
 * Validates + applies a wave-clear payout against a run. The run's own
 * `last_wave` (not whatever the client sends) is the source of truth for
 * "from", and the wave a run can legitimately reach is capped by how much
 * wall-clock time has actually passed since the run started — this is what
 * stops a tampered client from awarding itself wave 500 a second after
 * starting.
 */
export async function settleWaveRewardForRun(
  playerId: string,
  runId: string,
  requestedToWave: number,
): Promise<{ coins: number; gems: number; coinsAwarded: number; gemsAwarded: number } | null> {
  const run = await getOwnedRun(runId, playerId);
  if (!run) return null;

  const elapsedMs = Date.now() - new Date(run.started_at).getTime();
  const maxPlausibleWave = Math.floor(elapsedMs / MIN_MS_PER_WAVE);
  const clampedTo = Math.max(run.last_wave, Math.min(requestedToWave, maxPlausibleWave, run.last_wave + MAX_WAVE_JUMP_PER_REQUEST));

  if (requestedToWave > maxPlausibleWave + MAX_WAVE_JUMP_PER_REQUEST) {
    void logSecurityEvent("implausible_wave_reward", {
      playerId,
      detail: { runId, requestedToWave, maxPlausibleWave, elapsedMs },
    });
  }

  if (clampedTo <= run.last_wave) {
    return { coins: 0, gems: 0, coinsAwarded: 0, gemsAwarded: 0 };
  }

  const { coins, gems } = rewardsForWaveRange(run.last_wave, clampedTo);
  const result = await applyLedgerEntry(playerId, {
    coinDelta: coins,
    gemDelta: gems,
    reason: "wave_reward",
    metadata: { runId, fromWave: run.last_wave, toWave: clampedTo },
  });
  await supabaseAdmin.from("runs").update({ last_wave: clampedTo }).eq("id", runId);
  return { ...result, coinsAwarded: coins, gemsAwarded: gems };
}

/**
 * Validates a leaderboard score against its run before accepting it: the run
 * must belong to this player, not already have a submitted score, and — for
 * boards where the score IS elapsed survival time — the score can't exceed
 * how long the run has actually been open (plus a small tolerance for
 * network/tab-suspend slack).
 */
export async function settleLeaderboardSubmitForRun(
  playerId: string,
  runId: string,
  board: string,
  score: number,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const run = await getOwnedRun(runId, playerId);
  if (!run) return { ok: false, error: "Unknown or expired run", status: 400 };

  const elapsedSeconds = (Date.now() - new Date(run.started_at).getTime()) / 1000;
  const TOLERANCE_SECONDS = 15;
  if (board.includes("time") && score > elapsedSeconds + TOLERANCE_SECONDS) {
    void logSecurityEvent("implausible_score", {
      playerId,
      detail: { runId, board, score, elapsedSeconds },
    });
    return { ok: false, error: "Score is not plausible for this run's duration", status: 400 };
  }

  // Not a hard one-submission-per-run lock (a single run can legitimately
  // post to more than one board, e.g. the endless board and a weekly-
  // mutator board) — the elapsed-time check above is what actually stops
  // the score from being inflated.
  await supabaseAdmin.from("runs").update({ submitted: true, ended_at: new Date().toISOString() }).eq("id", runId);
  return { ok: true };
}

// A hard ceiling used only when a client submits without a runId at all
// (e.g. an older build) — generous, but stops an obviously-impossible score.
export const MAX_PLAUSIBLE_SCORE_NO_RUN = 24 * 60 * 60; // 24 hours of "survival time"

// ------------------------------------------------------------------ gear shop

export const GEAR_SHOP_PRICE: Record<string, { coins: number; gems: number }> = {
  common: { coins: 250, gems: 0 },
  rare: { coins: 600, gems: 0 },
  epic: { coins: 0, gems: 25 },
  legendary: { coins: 0, gems: 60 },
  godly: { coins: 0, gems: 140 },
};

export const GEAR_SHOP_ITEM_IDS = new Set(
  ["head", "accessory", "boots"].flatMap((slot) =>
    ["common", "rare", "epic", "legendary", "godly"].map((r) => `shop-${slot}-${r}`),
  ),
);

export function rarityFromShopItemId(itemId: string): string {
  const parts = itemId.split("-");
  return parts[parts.length - 1] ?? "";
}

// ------------------------------------------------------------------ save keys

export const ALL_SAVE_KEYS = [
  "swarmstrike-coins",
  "swarmstrike-gems",
  "swarmstrike-best",
  "swarmstrike-intro-seen",
  "swarmstrike-tutorial-seen",
  "swarmstrike-inventory",
  "swarmstrike-equipped",
  "swarmstrike-equipped-abilities",
  "swarmstrike-abilities-equipped-gun",
  "swarmstrike-abilities-equipped-sword",
  "swarmstrike-abilities-owned-gun",
  "swarmstrike-abilities-owned-sword",
  "swarmstrike-ability-tokens",
  "swarmstrike-talent-levels",
  "swarmstrike-pet",
  "swarmstrike-pet-state",
  "swarmstrike-skin",
  "swarmstrike-skin-equipped",
  "swarmstrike-owned-skins",
  "swarmstrike-skins-owned",
  "swarmstrike-achievements",
  "swarmstrike-achievements-claimed",
  "swarmstrike-battlepass",
  "swarmstrike-battlepass-claimed",
  "swarmstrike-battlepass-points",
  "swarmstrike-quests",
  "swarmstrike-quest-base",
  "swarmstrike-daily-reward",
  "swarmstrike-daily-last-claimed",
  "swarmstrike-daily-streak",
  "swarmstrike-campaign-clears",
  "swarmstrike-lifetime-stats",
  "swarmstrike-last-chest-opened-at",
  "swarmstrike-chest-last-opened",
  "swarmstrike-sound-enabled",
  "swarmstrike-volume",
  "swarmstrike-reduced-motion",
  "swarmstrike-near-miss-slowmo",
  "swarmstrike-nearmiss-slowmo",
  "swarmstrike-ui-theme",
  "swarmstrike-theme",
  "swarmstrike-custom-theme",
  "swarmstrike-theme-custom",
  "swarmstrike-last-seen",
  "swarmstrike-weekly-claimed",
  "swarmstrike-keybinds",
] as const;

// ------------------------------------------------------------------ admin: players

export type AdminPlayerRow = {
  id: string;
  device_id: string;
  display_name: string | null;
  coins: number;
  gems: number;
  banned: boolean;
  created_at: string | null;
};

export async function listPlayersForAdmin(opts: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AdminPlayerRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  let query = supabaseAdmin
    .from("players")
    .select("id, device_id, display_name, coins, gems, banned, created_at", { count: "exact" });

  const search = opts.search?.trim();
  if (search) {
    query = query.or(`device_id.ilike.%${search}%,display_name.ilike.%${search}%`);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      device_id: row.device_id,
      display_name: row.display_name,
      coins: Number(row.coins),
      gems: Number(row.gems),
      banned: Boolean(row.banned),
      created_at: row.created_at ?? null,
    })),
    total: count ?? 0,
  };
}

export async function getPlayerStatsForAdmin(playerId: string) {
  const [player, ledgerCount, saveRow, scores] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("id, device_id, display_name, coins, gems, banned, created_at")
      .eq("id", playerId)
      .maybeSingle(),
    supabaseAdmin
      .from("currency_ledger")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId),
    supabaseAdmin
      .from("saves")
      .select("payload, updated_at")
      .eq("player_id", playerId)
      .maybeSingle(),
    supabaseAdmin
      .from("leaderboard_scores")
      .select("board, score, updated_at")
      .eq("player_id", playerId),
  ]);

  if (player.error) throw new Error(player.error.message);
  if (!player.data) throw new Error("NOT_FOUND");

  return {
    player: {
      id: player.data.id,
      deviceId: player.data.device_id,
      displayName: player.data.display_name,
      coins: Number(player.data.coins),
      gems: Number(player.data.gems),
      banned: Boolean(player.data.banned),
      createdAt: player.data.created_at ?? null,
    },
    ledgerEntries: ledgerCount.count ?? 0,
    save: saveRow.data
      ? { updatedAt: saveRow.data.updated_at, payload: saveRow.data.payload as Record<string, string> }
      : null,
    scores: (scores.data ?? []).map((s) => ({
      board: s.board,
      score: Number(s.score),
      updatedAt: s.updated_at,
    })),
  };
}

export async function setPlayerBanned(playerId: string, banned: boolean) {
  const { error } = await supabaseAdmin.from("players").update({ banned }).eq("id", playerId);
  if (error) throw new Error(error.message);
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return "Usernames must be 3-20 characters: letters, numbers, and underscores only.";
  }
  return null;
}

/** Sets a player's display name if it's valid and not already taken (case-insensitive). */
export async function setPlayerUsername(
  playerId: string,
  username: string,
): Promise<{ ok: true; player: Player } | { ok: false; error: string; status: number }> {
  const invalid = validateUsername(username);
  if (invalid) return { ok: false, error: invalid, status: 400 };

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("players")
    .select("id")
    .ilike("display_name", username)
    .neq("id", playerId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing) return { ok: false, error: "That username is already taken.", status: 409 };

  const { data, error } = await supabaseAdmin
    .from("players")
    .update({ display_name: username })
    .eq("id", playerId)
    .select("id, device_id, display_name, coins, gems, banned")
    .single();

  if (error) {
    // Unique index race: someone else grabbed the same name between our check and update.
    if (error.message.toLowerCase().includes("duplicate")) {
      return { ok: false, error: "That username is already taken.", status: 409 };
    }
    throw new Error(error.message);
  }

  return { ok: true, player: data as Player };
}

/** Admin edit: username/coins/gems, with the same username validation and uniqueness check. */
export async function adminUpdatePlayer(
  playerId: string,
  updates: { displayName?: string; coins?: number; gems?: number },
): Promise<{ ok: true; player: Player } | { ok: false; error: string; status: number }> {
  const patch: Record<string, unknown> = {};

  if (updates.displayName !== undefined) {
    const invalid = validateUsername(updates.displayName);
    if (invalid) return { ok: false, error: invalid, status: 400 };
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("players")
      .select("id")
      .ilike("display_name", updates.displayName)
      .neq("id", playerId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (existing) return { ok: false, error: "That username is already taken.", status: 409 };
    patch["display_name"] = updates.displayName;
  }

  if (updates.coins !== undefined) {
    if (!Number.isFinite(updates.coins) || updates.coins < 0) {
      return { ok: false, error: "Coins must be a non-negative number.", status: 400 };
    }
    patch["coins"] = updates.coins;
  }

  if (updates.gems !== undefined) {
    if (!Number.isFinite(updates.gems) || updates.gems < 0) {
      return { ok: false, error: "Gems must be a non-negative number.", status: 400 };
    }
    patch["gems"] = updates.gems;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to update.", status: 400 };
  }

  const { data, error } = await supabaseAdmin
    .from("players")
    .update(patch)
    .eq("id", playerId)
    .select("id, device_id, display_name, coins, gems, banned")
    .single();

  if (error) {
    if (error.message.toLowerCase().includes("duplicate")) {
      return { ok: false, error: "That username is already taken.", status: 409 };
    }
    throw new Error(error.message);
  }

  return { ok: true, player: data as Player };
}

/** Admin edit of a player's cloud save (inventory/gear/equipped/etc), filtered to known keys. */
export async function adminUpdateSave(
  playerId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, string>> {
  const filtered: Record<string, string> = {};
  for (const key of ALL_SAVE_KEYS) {
    if (typeof payload[key] === "string") filtered[key] = payload[key];
  }
  const { error } = await supabaseAdmin
    .from("saves")
    .upsert({ player_id: playerId, payload: filtered, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return filtered;
}


export async function deletePlayer(playerId: string) {
  // Clean up dependent rows first in case there's no cascading FK configured.
  await supabaseAdmin.from("currency_ledger").delete().eq("player_id", playerId);
  await supabaseAdmin.from("saves").delete().eq("player_id", playerId);
  await supabaseAdmin.from("leaderboard_scores").delete().eq("player_id", playerId);
  await supabaseAdmin.from("runs").delete().eq("player_id", playerId);
  const { error } = await supabaseAdmin.from("players").delete().eq("id", playerId);
  if (error) throw new Error(error.message);
}

export type SecurityEventRow = {
  id: number;
  type: string;
  player_id: string | null;
  player_display_name: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export async function listSecurityEventsForAdmin(limit = 100): Promise<SecurityEventRow[]> {
  const { data, error } = await supabaseAdmin
    .from("security_events")
    .select("id, type, player_id, ip, detail, created_at, players(display_name)")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 300));
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    player_id: row.player_id,
    player_display_name: (row.players as unknown as { display_name: string | null } | null)?.display_name ?? null,
    ip: row.ip,
    detail: row.detail as Record<string, unknown> | null,
    created_at: row.created_at,
  }));
}

