create table public.website_services (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.client_websites (id) on delete cascade,
  service_type text not null,
  name text not null,
  provider text,
  status text not null default 'active',
  ownership text not null default 'n3xra_managed',
  account_identifier text,
  plan_name text,
  renewal_date date,
  monthly_cost_cents integer,
  currency text not null default 'USD',
  public_url text,
  client_summary text,
  admin_notes text,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 100,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_services_type_check check (service_type in ('domain', 'hosting', 'maintenance', 'email', 'analytics', 'source_code', 'ssl_cdn', 'database', 'storage', 'payments', 'other')),
  constraint website_services_status_check check (status in ('active', 'pending', 'paused', 'expired', 'cancelled', 'transferred')),
  constraint website_services_ownership_check check (ownership in ('client_owned', 'n3xra_managed', 'third_party')),
  constraint website_services_monthly_cost_check check (monthly_cost_cents is null or monthly_cost_cents >= 0),
  constraint website_services_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint website_services_metadata_check check (jsonb_typeof(metadata) = 'object')
);
create table public.website_domains (
  id uuid primary key default gen_random_uuid(), website_id uuid not null references public.client_websites (id) on delete cascade,
  domain_name text not null, registrar text, dns_provider text, status text not null default 'active', ownership text not null default 'n3xra_managed',
  registered_at date, expires_at date, auto_renew boolean, is_primary boolean not null default false, nameservers text[] not null default '{}', client_summary text, admin_notes text,
  metadata jsonb not null default '{}'::jsonb, created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint website_domains_name_check check (domain_name ~* '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  constraint website_domains_status_check check (status in ('active', 'pending', 'expired', 'transferring', 'transferred')),
  constraint website_domains_ownership_check check (ownership in ('client_owned', 'n3xra_managed', 'third_party')),
  constraint website_domains_metadata_check check (jsonb_typeof(metadata) = 'object'), constraint website_domains_unique unique (website_id, domain_name)
);
create unique index website_domains_one_primary_idx on public.website_domains (website_id) where is_primary;
create table public.website_repositories (
  id uuid primary key default gen_random_uuid(), website_id uuid not null references public.client_websites (id) on delete cascade, provider text not null default 'github', full_name text not null,
  html_url text, default_branch text not null default 'main', visibility text not null default 'private', ownership text not null default 'n3xra_managed', access_status text not null default 'available_on_request',
  archive_download_enabled boolean not null default false, transfer_available boolean not null default true, last_synced_at timestamptz, client_summary text, admin_notes text,
  metadata jsonb not null default '{}'::jsonb, created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint website_repositories_provider_check check (provider in ('github', 'gitlab', 'bitbucket', 'other')),
  constraint website_repositories_full_name_check check (full_name ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  constraint website_repositories_visibility_check check (visibility in ('public', 'private', 'internal')),
  constraint website_repositories_ownership_check check (ownership in ('client_owned', 'n3xra_managed', 'third_party')),
  constraint website_repositories_access_check check (access_status in ('available', 'available_on_request', 'restricted', 'transferred')),
  constraint website_repositories_metadata_check check (jsonb_typeof(metadata) = 'object'), constraint website_repositories_unique unique (website_id, provider, full_name)
);
create table public.website_service_access_requests (
  id uuid primary key default gen_random_uuid(), website_id uuid not null references public.client_websites (id) on delete cascade,
  service_id uuid references public.website_services (id) on delete set null, domain_id uuid references public.website_domains (id) on delete set null, repository_id uuid references public.website_repositories (id) on delete set null,
  requested_by_user_id uuid not null references auth.users (id) on delete cascade default auth.uid(), request_type text not null, status text not null default 'submitted', github_username text,
  client_message text, admin_notes text, handled_by_user_id uuid references auth.users (id) on delete set null, handled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint website_service_access_requests_type_check check (request_type in ('access', 'domain_transfer', 'dns_change', 'repository_access', 'repository_download', 'repository_transfer', 'service_transfer', 'cancellation', 'information', 'issue')),
  constraint website_service_access_requests_status_check check (status in ('submitted', 'reviewing', 'waiting_on_client', 'approved', 'completed', 'declined', 'cancelled')),
  constraint website_service_access_requests_github_username_check check (github_username is null or github_username ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$')
);
create index website_services_website_status_idx on public.website_services (website_id, status, sort_order, name);
create index website_domains_website_status_idx on public.website_domains (website_id, status, domain_name);
create index website_repositories_website_idx on public.website_repositories (website_id, provider, full_name);
create index website_service_requests_website_created_idx on public.website_service_access_requests (website_id, created_at desc);
create index website_service_requests_requester_idx on public.website_service_access_requests (requested_by_user_id, created_at desc);
create index website_service_requests_status_idx on public.website_service_access_requests (status, created_at desc);
create trigger website_services_set_updated_at before update on public.website_services for each row execute function public.set_updated_at();
create trigger website_domains_set_updated_at before update on public.website_domains for each row execute function public.set_updated_at();
create trigger website_repositories_set_updated_at before update on public.website_repositories for each row execute function public.set_updated_at();
create trigger website_service_access_requests_set_updated_at before update on public.website_service_access_requests for each row execute function public.set_updated_at();
alter table public.website_services enable row level security; alter table public.website_domains enable row level security; alter table public.website_repositories enable row level security; alter table public.website_service_access_requests enable row level security;
revoke all on public.website_services from anon; revoke all on public.website_domains from anon; revoke all on public.website_repositories from anon; revoke all on public.website_service_access_requests from anon;
grant select, insert, update, delete on public.website_services to authenticated; grant select, insert, update, delete on public.website_domains to authenticated; grant select, insert, update, delete on public.website_repositories to authenticated; grant select, insert, update on public.website_service_access_requests to authenticated;
grant all on public.website_services to service_role; grant all on public.website_domains to service_role; grant all on public.website_repositories to service_role; grant all on public.website_service_access_requests to service_role;
create policy "website_services_select" on public.website_services for select to authenticated using ((select public.can_view_client_website(website_id)));
create policy "website_services_admin_insert" on public.website_services for insert to authenticated with check ((select public.is_platform_admin()));
create policy "website_services_admin_update" on public.website_services for update to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy "website_services_admin_delete" on public.website_services for delete to authenticated using ((select public.is_platform_admin()));
create policy "website_domains_select" on public.website_domains for select to authenticated using ((select public.can_view_client_website(website_id)));
create policy "website_domains_admin_insert" on public.website_domains for insert to authenticated with check ((select public.is_platform_admin()));
create policy "website_domains_admin_update" on public.website_domains for update to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy "website_domains_admin_delete" on public.website_domains for delete to authenticated using ((select public.is_platform_admin()));
create policy "website_repositories_select" on public.website_repositories for select to authenticated using ((select public.can_view_client_website(website_id)));
create policy "website_repositories_admin_insert" on public.website_repositories for insert to authenticated with check ((select public.is_platform_admin()));
create policy "website_repositories_admin_update" on public.website_repositories for update to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy "website_repositories_admin_delete" on public.website_repositories for delete to authenticated using ((select public.is_platform_admin()));
create policy "website_service_access_requests_select" on public.website_service_access_requests for select to authenticated using ((requested_by_user_id = (select auth.uid()) and (select public.can_view_client_website(website_id))) or (select public.is_platform_admin()));
create policy "website_service_access_requests_client_insert" on public.website_service_access_requests for insert to authenticated with check (
  requested_by_user_id = (select auth.uid()) and (select public.can_view_client_website(website_id))
  and (service_id is null or exists (select 1 from public.website_services service where service.id = website_service_access_requests.service_id and service.website_id = website_service_access_requests.website_id))
  and (domain_id is null or exists (select 1 from public.website_domains domain_record where domain_record.id = website_service_access_requests.domain_id and domain_record.website_id = website_service_access_requests.website_id))
  and (repository_id is null or exists (select 1 from public.website_repositories repository where repository.id = website_service_access_requests.repository_id and repository.website_id = website_service_access_requests.website_id))
);
create policy "website_service_access_requests_admin_update" on public.website_service_access_requests for update to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));;
