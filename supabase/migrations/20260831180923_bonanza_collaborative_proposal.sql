-- Shared, access-code protected planning pages used before a formal proposal.
-- Browser clients never receive direct table access; trusted server-side API
-- code validates the shared code and uses service_role for narrow data access.
create table public.collaborative_proposals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 160),
  access_code_hash text not null check (access_code_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collaborative_proposal_responses (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.collaborative_proposals(id) on delete cascade,
  participant_id uuid not null,
  participant_name text not null check (char_length(participant_name) between 2 and 80),
  section_key text not null check (section_key ~ '^[a-z0-9_]{2,80}$'),
  choice text not null check (char_length(choice) between 2 and 40),
  note text not null default '' check (char_length(note) <= 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proposal_id, participant_id, section_key)
);

create index collaborative_proposal_responses_proposal_updated_idx
on public.collaborative_proposal_responses (proposal_id, updated_at desc);

create trigger collaborative_proposals_set_updated_at
before update on public.collaborative_proposals
for each row execute function public.set_updated_at();

create trigger collaborative_proposal_responses_set_updated_at
before update on public.collaborative_proposal_responses
for each row execute function public.set_updated_at();

alter table public.collaborative_proposals enable row level security;
alter table public.collaborative_proposal_responses enable row level security;

revoke all on table public.collaborative_proposals from public, anon, authenticated;
revoke all on table public.collaborative_proposal_responses from public, anon, authenticated;
grant select, insert, update, delete on table public.collaborative_proposals to service_role;
grant select, insert, update, delete on table public.collaborative_proposal_responses to service_role;

comment on table public.collaborative_proposals is
'Access-code protected, non-contractual planning pages served only through trusted N3XRA API code.';
comment on table public.collaborative_proposal_responses is
'Shared participant selections and notes for a collaborative planning page; these are not agreement acceptances.';

insert into public.collaborative_proposals (id, slug, title, access_code_hash)
values (
  'b01a72a0-0dce-4dbd-b014-bdb7700d2026',
  'town-of-bonanza',
  'Town of Bonanza Municipal Website',
  '6515a1aae3844eff2d5457de29c32f1f200c538cec2d81137d8b18197b684742'
)
on conflict (slug) do update
set title = excluded.title,
    access_code_hash = excluded.access_code_hash,
    status = 'open',
    updated_at = now();
