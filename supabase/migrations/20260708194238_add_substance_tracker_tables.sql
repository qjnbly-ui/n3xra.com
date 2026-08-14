-- Substance tracker module schema for the private dashboard.
-- Run this in the Supabase SQL editor after website_foundation_schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.substance_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  type text not null,
  amount text,
  context text,
  feeling_before text,
  feeling_after text,
  notes text,
  logged_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.substance_cravings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  type text not null,
  intensity integer not null default 3 check (intensity between 1 and 5),
  context text,
  action text,
  logged_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.substance_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  goal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, category)
);

create unique index if not exists substance_entries_owner_client_id_idx on public.substance_entries(owner_id, client_id);
create unique index if not exists substance_cravings_owner_client_id_idx on public.substance_cravings(owner_id, client_id);

create index if not exists substance_entries_owner_logged_at_idx on public.substance_entries(owner_id, logged_at desc);
create index if not exists substance_cravings_owner_logged_at_idx on public.substance_cravings(owner_id, logged_at desc);
create index if not exists substance_goals_owner_category_idx on public.substance_goals(owner_id, category);

drop trigger if exists set_substance_entries_updated_at on public.substance_entries;
create trigger set_substance_entries_updated_at
before update on public.substance_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_substance_cravings_updated_at on public.substance_cravings;
create trigger set_substance_cravings_updated_at
before update on public.substance_cravings
for each row execute function public.set_updated_at();

drop trigger if exists set_substance_goals_updated_at on public.substance_goals;
create trigger set_substance_goals_updated_at
before update on public.substance_goals
for each row execute function public.set_updated_at();

alter table public.substance_entries enable row level security;
alter table public.substance_cravings enable row level security;
alter table public.substance_goals enable row level security;

grant select, insert, update, delete on public.substance_entries to authenticated;
grant select, insert, update, delete on public.substance_cravings to authenticated;
grant select, insert, update, delete on public.substance_goals to authenticated;

drop policy if exists "Substance entries are owner managed" on public.substance_entries;
create policy "Substance entries are owner managed"
on public.substance_entries for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "Substance cravings are owner managed" on public.substance_cravings;
create policy "Substance cravings are owner managed"
on public.substance_cravings for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "Substance goals are owner managed" on public.substance_goals;
create policy "Substance goals are owner managed"
on public.substance_goals for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());;
