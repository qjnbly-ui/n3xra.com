create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  product text not null default 'platform',
  priority text not null default 'activity'
    check (priority in ('important', 'activity', 'system')),
  title text not null,
  summary text not null default '',
  message_text text,
  message_html text,
  actor_name text,
  actor_email text,
  source_table text,
  source_id text,
  action_url text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_notifications_inbox_idx
  on public.admin_notifications (created_at desc) where deleted_at is null;
create index if not exists admin_notifications_unread_idx
  on public.admin_notifications (created_at desc)
  where read_at is null and archived_at is null and deleted_at is null;
create index if not exists admin_notifications_product_idx
  on public.admin_notifications (product, created_at desc);

alter table public.admin_notifications enable row level security;

create policy "admin_notifications_select_admin"
on public.admin_notifications for select to authenticated
using ((select public.is_platform_admin()));
create policy "admin_notifications_update_admin"
on public.admin_notifications for update to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));
create policy "admin_notifications_delete_admin"
on public.admin_notifications for delete to authenticated
using ((select public.is_platform_admin()));

revoke all on table public.admin_notifications from anon;
grant select, update, delete on table public.admin_notifications to authenticated;
grant all on table public.admin_notifications to service_role;

create or replace function private.capture_admin_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  record_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  before_data jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  product_name text;
  priority_name text := 'activity';
  action_path text;
  event_suffix text;
  display_table text := initcap(replace(tg_table_name, '_', ' '));
  current_state text := coalesce(
    record_data ->> 'status',
    record_data ->> 'account_status',
    record_data ->> 'transcript_status',
    record_data ->> 'ai_review_status',
    ''
  );
  previous_state text := coalesce(
    before_data ->> 'status',
    before_data ->> 'account_status',
    before_data ->> 'transcript_status',
    before_data ->> 'ai_review_status',
    ''
  );
  summary_text text;
begin
  product_name := case
    when tg_table_name like 'website_%' or tg_table_name = 'client_websites' then 'websites'
    when tg_table_name like 'partner_%' or tg_table_name = 'founding_partner_applications' then 'partners'
    when tg_table_name like 'virals_%' then 'virals'
    when tg_table_name like 'utility_%' then 'utilities'
    when tg_table_name like 'music_%' then 'music'
    when tg_table_name in ('documents', 'meeting_recordings', 'organization_invites', 'organization_memberships', 'organizations') then 'records'
    when tg_table_name = 'platform_support_requests' then 'support'
    else 'accounts'
  end;

  action_path := case product_name
    when 'websites' then case
      when tg_table_name like 'website_proposal%' then '/n3xra-admin/proposals/'
      when tg_table_name like 'website_onboarding%' then '/n3xra-admin/onboarding/'
      when tg_table_name like 'website_asset%' then '/n3xra-admin/assets/'
      when tg_table_name = 'website_projects' then '/n3xra-admin/projects/'
      when tg_table_name = 'website_service_access_requests' then '/n3xra-admin/services/'
      else '/n3xra-admin/requests/' end
    when 'partners' then '/n3xra-admin/partners/'
    when 'virals' then '/n3xra-virals/admin/'
    when 'utilities' then '/n3xra-admin/utilities/'
    when 'records' then '/n3xra-admin/records/'
    when 'music' then '/account/admin/billing/'
    when 'support' then '/account/admin/support/'
    else '/account/admin/accounts/'
  end;

  if tg_op = 'UPDATE' then
    if current_state is distinct from previous_state then
      event_suffix := nullif(current_state, '');
    elsif coalesce(record_data ->> 'referral_code', '') <> ''
      and coalesce(before_data ->> 'referral_code', '') = '' then
      event_suffix := 'referral_code_created';
    elsif coalesce(record_data ->> 'cancel_at_period_end', 'false') = 'true'
      and coalesce(before_data ->> 'cancel_at_period_end', 'false') = 'false' then
      event_suffix := 'cancellation_scheduled';
    else
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    event_suffix := case
      when current_state <> '' then current_state
      else 'created'
    end;
  else
    event_suffix := 'deleted';
    priority_name := 'important';
  end if;

  if event_suffix in ('failed', 'error', 'past_due', 'disputed', 'reversed') then
    priority_name := 'system';
  elsif tg_table_name in (
    'website_service_requests', 'website_proposal_decisions',
    'website_onboarding_responses', 'website_service_access_requests',
    'founding_partner_applications', 'virals_creator_applications',
    'platform_support_requests', 'utility_onboarding_sessions'
  ) and tg_op = 'INSERT' then
    priority_name := 'important';
  elsif event_suffix in ('submitted', 'needs_info', 'changes_requested', 'declined', 'rejected') then
    priority_name := 'important';
  end if;

  summary_text := concat_ws(' · ',
    nullif(coalesce(record_data ->> 'business_name', record_data ->> 'name', record_data ->> 'title', record_data ->> 'subject', record_data ->> 'full_name', record_data ->> 'provider_name', record_data ->> 'description'), ''),
    nullif(coalesce(record_data ->> 'contact_email', record_data ->> 'requester_email', record_data ->> 'email'), ''),
    nullif(coalesce(record_data ->> 'message', record_data ->> 'client_message', record_data ->> 'processing_error', record_data ->> 'error_message'), '')
  );

  insert into public.admin_notifications (
    event_type, product, priority, title, summary, actor_name, actor_email,
    source_table, source_id, action_url, metadata
  ) values (
    product_name || '.' || tg_table_name || '.' || event_suffix,
    product_name,
    priority_name,
    display_table || ' ' || replace(event_suffix, '_', ' '),
    left(coalesce(summary_text, ''), 2000),
    nullif(coalesce(record_data ->> 'contact_name', record_data ->> 'requester_name', record_data ->> 'full_name'), ''),
    nullif(coalesce(record_data ->> 'contact_email', record_data ->> 'requester_email', record_data ->> 'email'), ''),
    tg_table_name,
    nullif(coalesce(record_data ->> 'id', record_data ->> 'user_id'), ''),
    action_path,
    jsonb_build_object('operation', tg_op, 'record', record_data)
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.capture_admin_notification() from public, anon, authenticated;

do $$
declare
  table_name text;
  watched_tables text[] := array[
    'profiles', 'platform_admins', 'platform_admin_invites',
    'platform_support_requests', 'organizations', 'organization_invites',
    'organization_memberships', 'documents', 'meeting_recordings',
    'music_profiles', 'music_generations', 'website_service_requests',
    'website_proposal_decisions', 'website_proposal_versions',
    'website_onboarding_responses', 'website_service_access_requests',
    'website_asset_versions', 'website_projects', 'founding_partner_applications',
    'partner_referrals', 'partner_commission_entries',
    'virals_creator_applications', 'virals_referrals', 'virals_commission_ledger',
    'utility_onboarding_sessions', 'utility_organizations',
    'utility_organization_invites', 'utility_organization_members',
    'utility_billing_runs', 'utility_billing_run_items',
    'utility_billing_exports', 'utility_meter_reading_imports'
  ];
begin
  foreach table_name in array watched_tables loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists capture_admin_notification on public.%I', table_name);
      execute format(
        'create trigger capture_admin_notification after insert or update or delete on public.%I for each row execute function private.capture_admin_notification()',
        table_name
      );
    end if;
  end loop;
end;
$$;
