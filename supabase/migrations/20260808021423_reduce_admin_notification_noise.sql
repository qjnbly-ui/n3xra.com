-- Keep the admin inbox focused on decisions, exceptions, and account-level
-- changes. Remove old routine activity while preserving explicit API-created
-- notifications and website assets that are waiting for admin review.
delete from public.admin_notifications
where priority = 'activity'
  and event_type <> 'websites.website_asset_versions.pending_review';

delete from public.admin_notifications
where source_table in (
  'documents', 'meeting_recordings', 'profiles',
  'music_profiles', 'music_generations',
  'organization_invites', 'organization_memberships',
  'website_proposal_versions',
  'partner_referrals', 'partner_commission_entries',
  'virals_referrals', 'virals_commission_ledger',
  'utility_organizations', 'utility_organization_invites',
  'utility_organization_members', 'utility_billing_run_items',
  'utility_billing_exports', 'utility_meter_reading_imports'
)
and event_type not like 'system.%'
and priority <> 'system';

delete from public.admin_notifications
where source_table = 'founding_partner_applications'
  and event_type <> 'partners.founding_partner_applications.submitted'
  and event_type not like 'system.%'
  and priority <> 'system';

update public.admin_notifications
set priority = 'important'
where event_type = 'websites.website_asset_versions.pending_review'
  and priority <> 'important';

create or replace function private.capture_admin_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  record_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  before_data jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  current_state text := coalesce(record_data->>'status', record_data->>'account_status', record_data->>'transcript_status', record_data->>'ai_review_status', '');
  previous_state text := coalesce(before_data->>'status', before_data->>'account_status', before_data->>'transcript_status', before_data->>'ai_review_status', '');
  product_name text;
  priority_name text := 'activity';
  event_suffix text;
  action_path text;
  safe_summary text := '';
  title_text text;
  should_notify boolean := false;
begin
  product_name := case
    when tg_table_name like 'website_%' or tg_table_name = 'client_websites' then 'websites'
    when tg_table_name like 'partner_%' or tg_table_name = 'founding_partner_applications' then 'partners'
    when tg_table_name like 'virals_%' then 'virals'
    when tg_table_name like 'utility_%' then 'utilities'
    when tg_table_name like 'music_%' then 'music'
    when tg_table_name in ('organization_invites', 'organization_memberships', 'organizations') then 'records'
    when tg_table_name = 'platform_support_requests' then 'support'
    else 'accounts'
  end;

  if tg_op = 'UPDATE' then
    if current_state is distinct from previous_state then
      event_suffix := nullif(current_state, '');
    elsif coalesce(record_data->>'cancel_at_period_end', 'false') = 'true'
      and coalesce(before_data->>'cancel_at_period_end', 'false') = 'false' then
      event_suffix := 'cancellation_scheduled';
    else
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    event_suffix := coalesce(nullif(current_state, ''), 'created');
  else
    event_suffix := 'deleted';
  end if;

  if event_suffix is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Actionable allowlist. Everything not explicitly selected here stays out
  -- of the platform-admin inbox.
  if event_suffix in ('failed', 'error', 'past_due', 'disputed', 'reversed') then
    priority_name := 'system';
    should_notify := true;
  elsif event_suffix = 'cancellation_scheduled' then
    priority_name := 'important';
    should_notify := true;
  elsif tg_table_name = 'platform_admins' and tg_op in ('INSERT', 'DELETE') then
    priority_name := 'important';
    should_notify := true;
  elsif tg_table_name = 'platform_admin_invites'
    and (tg_op = 'INSERT' or event_suffix in ('accepted', 'revoked', 'expired')) then
    priority_name := 'important';
    should_notify := true;
  elsif tg_table_name = 'platform_support_requests' and tg_op = 'INSERT' then
    priority_name := 'important';
    should_notify := true;
  elsif tg_table_name = 'organizations' and tg_op = 'DELETE' then
    priority_name := 'important';
    should_notify := true;
  elsif tg_table_name in (
    'website_service_requests', 'website_proposal_decisions',
    'website_service_access_requests', 'founding_partner_applications',
    'virals_creator_applications', 'utility_onboarding_sessions'
  ) and tg_op = 'INSERT' then
    priority_name := 'important';
    should_notify := true;
  elsif tg_table_name = 'website_onboarding_responses'
    and event_suffix in ('submitted', 'needs_info', 'changes_requested') then
    priority_name := 'important';
    should_notify := true;
  elsif tg_table_name = 'website_asset_versions' and event_suffix = 'pending_review' then
    priority_name := 'important';
    should_notify := true;
  end if;

  if not should_notify then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  safe_summary := left(concat_ws(' · ',
    nullif(coalesce(record_data->>'business_name', record_data->>'name', record_data->>'title', record_data->>'subject', record_data->>'full_name', record_data->>'provider_name', record_data->>'description'), ''),
    nullif(coalesce(record_data->>'contact_email', record_data->>'requester_email', record_data->>'email'), ''),
    nullif(coalesce(record_data->>'message', record_data->>'client_message', record_data->>'processing_error', record_data->>'error_message'), '')
  ), 2000);

  action_path := case product_name
    when 'websites' then case
      when tg_table_name = 'website_proposal_decisions' then '/n3xra-admin/proposals/'
      when tg_table_name = 'website_onboarding_responses' then '/n3xra-admin/onboarding/'
      when tg_table_name = 'website_asset_versions' then '/n3xra-admin/assets/'
      when tg_table_name = 'website_service_access_requests' then '/n3xra-admin/services/'
      else '/n3xra-admin/requests/'
    end
    when 'partners' then '/n3xra-admin/partners/'
    when 'virals' then '/n3xra-virals/admin/'
    when 'utilities' then '/n3xra-admin/utilities/'
    when 'records' then '/n3xra-admin/records/'
    when 'music' then '/account/admin/billing/'
    when 'support' then '/account/admin/support/'
    else '/account/admin/accounts/'
  end;

  title_text := case
    when priority_name = 'system' then initcap(replace(product_name, '_', ' ')) || ' needs attention'
    when tg_table_name = 'platform_admins' and tg_op = 'INSERT' then 'Platform administrator added'
    when tg_table_name = 'platform_admins' and tg_op = 'DELETE' then 'Platform administrator removed'
    when tg_table_name = 'platform_admin_invites' and tg_op = 'INSERT' then 'Platform administrator invited'
    when tg_table_name = 'platform_support_requests' then 'New support request'
    when tg_table_name = 'organizations' and tg_op = 'DELETE' then 'Records organization deleted'
    when tg_table_name = 'website_service_requests' then 'New website request'
    when tg_table_name = 'website_proposal_decisions' then 'Website proposal response received'
    when tg_table_name = 'website_onboarding_responses' then 'Website onboarding needs review'
    when tg_table_name = 'website_service_access_requests' then 'Website access request received'
    when tg_table_name = 'website_asset_versions' then 'Website assets pending review'
    when tg_table_name = 'founding_partner_applications' then 'New partner application'
    when tg_table_name = 'virals_creator_applications' then 'New Virals creator application'
    when tg_table_name = 'utility_onboarding_sessions' then 'Utilities onboarding submitted'
    when event_suffix = 'cancellation_scheduled' then 'Account cancellation scheduled'
    else initcap(replace(tg_table_name, '_', ' ')) || ' ' || replace(event_suffix, '_', ' ')
  end;

  insert into public.admin_notifications (
    event_type, product, priority, title, summary, actor_name, actor_email,
    source_table, source_id, action_url, metadata
  ) values (
    product_name || '.' || tg_table_name || '.' || event_suffix,
    product_name,
    priority_name,
    title_text,
    safe_summary,
    nullif(coalesce(record_data->>'contact_name', record_data->>'requester_name', record_data->>'full_name'), ''),
    nullif(coalesce(record_data->>'contact_email', record_data->>'requester_email', record_data->>'email'), ''),
    tg_table_name,
    nullif(coalesce(record_data->>'id', record_data->>'user_id'), ''),
    action_path,
    jsonb_build_object('operation', tg_op)
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.capture_admin_notification() from public, anon, authenticated;
;
