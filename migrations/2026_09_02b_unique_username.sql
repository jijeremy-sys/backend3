-- Run this once in your Supabase project's SQL editor.
-- Enforces that usernames (display_name) are unique, case-insensitively.
-- Existing NULLs are unaffected — a unique index allows any number of NULLs.

create unique index if not exists players_display_name_unique_idx
  on public.players (lower(display_name))
  where display_name is not null;
