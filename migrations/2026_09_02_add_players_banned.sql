-- Run this once in your Supabase project's SQL editor.
-- Adds the "banned" flag the admin dashboard uses to block players.

alter table public.players
  add column if not exists banned boolean not null default false;

create index if not exists players_banned_idx on public.players (banned);
