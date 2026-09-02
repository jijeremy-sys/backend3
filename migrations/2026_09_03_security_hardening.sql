-- Run this once in your Supabase project's SQL editor.
-- Adds: server-authoritative run tracking, a security/audit event log,
-- and IP columns on players for abuse detection.

-- 1. Track who signed up / last connected from where.
alter table public.players
  add column if not exists signup_ip text,
  add column if not exists last_ip text;

create index if not exists players_signup_ip_idx on public.players (signup_ip);
create index if not exists players_last_ip_idx on public.players (last_ip);

-- 2. Server-authoritative "runs": a run is opened when a game session starts
--    and closed when it's cashed in (wave reward / leaderboard submit), so
--    payouts and scores can be checked against real elapsed wall-clock time
--    instead of trusting whatever the client claims happened.
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  board text,
  started_at timestamptz not null default now(),
  last_wave integer not null default 0,
  submitted boolean not null default false,
  ended_at timestamptz
);

create index if not exists runs_player_id_idx on public.runs (player_id);
create index if not exists runs_started_at_idx on public.runs (started_at);

-- 3. A general-purpose audit / security log: admin actions, failed admin
--    logins, rejected or flagged currency and leaderboard activity, etc.
create table if not exists public.security_events (
  id bigserial primary key,
  type text not null,
  player_id uuid references public.players (id) on delete set null,
  ip text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_events_type_idx on public.security_events (type);
create index if not exists security_events_created_at_idx on public.security_events (created_at desc);
create index if not exists security_events_player_id_idx on public.security_events (player_id);
