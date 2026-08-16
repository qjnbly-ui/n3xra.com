alter table public.platform_support_requests
  add column if not exists website_id uuid references public.client_websites (id) on delete set null,
  add column if not exists organization_id uuid references public.organizations (id) on delete set null,
  add column if not exists client_visible boolean not null default false,
  add column if not exists origin text not null default 'client',
  add column if not exists estimated_start_at timestamptz,
  add column if not exists estimated_completion_at timestamptz;

alter table public.platform_support_requests
  drop constraint if exists platform_support_requests_origin_check;
alter table public.platform_support_requests
  add constraint platform_support_requests_origin_check
  check (origin in ('client', 'n3xra', 'public'));

alter table public.platform_support_requests
  drop constraint if exists platform_support_requests_estimate_order_check;
alter table public.platform_support_requests
  add constraint platform_support_requests_estimate_order_check
  check (
    estimated_start_at is null
    or estimated_completion_at is null
    or estimated_completion_at >= estimated_start_at
  );

update public.platform_support_requests
set origin = 'public'
where source = 'website' and origin = 'client' and client_visible = false;

create index if not exists platform_support_requests_website_status_idx
on public.platform_support_requests (website_id, status, updated_at desc)
where client_visible = true;

create table if not exists public.platform_support_request_updates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.platform_support_requests (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  author_type text not null default 'n3xra',
  message text not null,
  visible_to_client boolean not null default true,
  created_at timestamptz not null default now(),
  constraint platform_support_request_updates_author_check
    check (author_type in ('client', 'n3xra')),
  constraint platform_support_request_updates_message_check
    check (char_length(btrim(message)) between 1 and 8000)
);

create index if not exists platform_support_request_updates_request_created_idx
on public.platform_support_request_updates (request_id, created_at);

alter table public.platform_support_requests enable row level security;
alter table public.platform_support_request_updates enable row level security;

drop policy if exists platform_support_requests_client_select on public.platform_support_requests;
create policy platform_support_requests_client_select
on public.platform_support_requests
for select
to authenticated
using (
  client_visible = true
  and (
    requester_user_id = (select auth.uid())
    or (website_id is not null and public.can_view_client_website(website_id))
  )
);

drop policy if exists platform_support_requests_client_insert on public.platform_support_requests;
create policy platform_support_requests_client_insert
on public.platform_support_requests
for insert
to authenticated
with check (
  requester_user_id = (select auth.uid())
  and website_id is not null
  and client_visible = true
  and source = 'client_portal'
  and origin = 'client'
  and public.can_view_client_website(website_id)
  and exists (
    select 1
    from public.client_websites cw
    where cw.id = website_id
      and cw.organization_id is not distinct from organization_id
  )
);

drop policy if exists platform_support_request_updates_client_select on public.platform_support_request_updates;
create policy platform_support_request_updates_client_select
on public.platform_support_request_updates
for select
to authenticated
using (
  visible_to_client = true
  and exists (
    select 1
    from public.platform_support_requests request
    where request.id = request_id
      and request.client_visible = true
      and (
        request.requester_user_id = (select auth.uid())
        or (request.website_id is not null and public.can_view_client_website(request.website_id))
      )
  )
);

revoke all on public.platform_support_requests from anon, authenticated;
grant select (
  id,
  website_id,
  organization_id,
  topic,
  subject,
  message,
  status,
  origin,
  client_visible,
  estimated_start_at,
  estimated_completion_at,
  created_at,
  updated_at,
  resolved_at
) on public.platform_support_requests to authenticated;
grant insert (
  requester_user_id,
  requester_name,
  requester_email,
  organization_name,
  topic,
  subject,
  message,
  source,
  website_id,
  organization_id,
  client_visible,
  origin
) on public.platform_support_requests to authenticated;

revoke all on public.platform_support_request_updates from anon, authenticated;
grant select on public.platform_support_request_updates to authenticated;
grant all on public.platform_support_requests to service_role;
grant all on public.platform_support_request_updates to service_role;

comment on column public.platform_support_requests.internal_notes is
'Private N3XRA handling notes. Never display this field in a client portal.';
comment on table public.platform_support_request_updates is
'Timeline notes for support and client-visible work. Only rows marked visible_to_client are exposed through client RLS.';
