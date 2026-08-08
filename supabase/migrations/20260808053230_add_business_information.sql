create table if not exists public.n3xra_business_information (
  id smallint primary key default 1 check (id = 1),
  legal_name text,
  doing_business_as text,
  entity_type text,
  business_status text,
  formation_jurisdiction text,
  formation_date date,
  ein text,
  duns_number text,
  unique_entity_id text,
  cage_code text,
  state_registration_number text,
  naics_codes text,
  website_url text,
  business_email text,
  business_phone text,
  principal_address text,
  mailing_address text,
  registered_agent text,
  fiscal_year_end text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.n3xra_business_file_links (
  id uuid primary key default gen_random_uuid(),
  business_information_id smallint not null default 1
    references public.n3xra_business_information (id) on delete cascade,
  file_id uuid not null references public.n3xra_files (id) on delete cascade,
  document_type text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_information_id, file_id)
);

insert into public.n3xra_business_information (id)
values (1)
on conflict (id) do nothing;

create index if not exists n3xra_business_file_links_file_idx
  on public.n3xra_business_file_links (file_id);

drop trigger if exists n3xra_business_information_set_updated_at on public.n3xra_business_information;
create trigger n3xra_business_information_set_updated_at
before update on public.n3xra_business_information
for each row execute function public.set_updated_at();

alter table public.n3xra_business_information enable row level security;
alter table public.n3xra_business_file_links enable row level security;

revoke all on table public.n3xra_business_information from anon, authenticated;
revoke all on table public.n3xra_business_file_links from anon, authenticated;
grant select, insert, update, delete on table public.n3xra_business_information to service_role;
grant select, insert, update, delete on table public.n3xra_business_file_links to service_role;

comment on table public.n3xra_business_information is
  'Single private N3XRA company profile available only through the platform-admin service.';
comment on table public.n3xra_business_file_links is
  'Links the private company profile to supporting records stored in N3XRA Files.';
