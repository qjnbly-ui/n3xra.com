create or replace function private.capture_admin_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  record_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  before_data jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  product_name text;
  priority_name text := 'activity';
  action_path text;
  event_suffix text;
  display_table text := initcap(replace(tg_table_name,'_',' '));
  current_state text := coalesce(record_data->>'status',record_data->>'account_status',record_data->>'transcript_status',record_data->>'ai_review_status','');
  previous_state text := coalesce(before_data->>'status',before_data->>'account_status',before_data->>'transcript_status',before_data->>'ai_review_status','');
  summary_text text;
begin
  product_name := case
    when tg_table_name like 'website_%' or tg_table_name='client_websites' then 'websites'
    when tg_table_name like 'partner_%' or tg_table_name='founding_partner_applications' then 'partners'
    when tg_table_name like 'virals_%' then 'virals'
    when tg_table_name like 'utility_%' then 'utilities'
    when tg_table_name like 'music_%' then 'music'
    when tg_table_name in ('documents','meeting_recordings','organization_invites','organization_memberships','organizations') then 'records'
    when tg_table_name='platform_support_requests' then 'support'
    else 'accounts' end;

  action_path := case product_name
    when 'websites' then case
      when tg_table_name like 'website_proposal%' then '/n3xra-admin/proposals/'
      when tg_table_name like 'website_onboarding%' then '/n3xra-admin/onboarding/'
      when tg_table_name like 'website_asset%' then '/n3xra-admin/assets/'
      when tg_table_name='website_projects' then '/n3xra-admin/projects/'
      when tg_table_name='website_service_access_requests' then '/n3xra-admin/services/'
      else '/n3xra-admin/requests/' end
    when 'partners' then '/n3xra-admin/partners/'
    when 'virals' then '/n3xra-virals/admin/'
    when 'utilities' then '/n3xra-admin/utilities/'
    when 'records' then '/n3xra-admin/records/'
    when 'music' then '/account/admin/billing/'
    when 'support' then '/account/admin/support/'
    else '/account/admin/accounts/' end;

  if tg_op='UPDATE' then
    if current_state is distinct from previous_state then event_suffix := nullif(current_state,'');
    elsif coalesce(record_data->>'referral_code','') <> '' and coalesce(before_data->>'referral_code','')='' then event_suffix := 'referral_code_created';
    elsif coalesce(record_data->>'cancel_at_period_end','false')='true' and coalesce(before_data->>'cancel_at_period_end','false')='false' then event_suffix := 'cancellation_scheduled';
    else return new; end if;
  elsif tg_op='INSERT' then event_suffix := case when current_state<>'' then current_state else 'created' end;
  else event_suffix := 'deleted'; priority_name := 'important'; end if;

  if event_suffix in ('failed','error','past_due','disputed','reversed') then priority_name := 'system';
  elsif tg_table_name in ('website_service_requests','website_proposal_decisions','website_onboarding_responses','website_service_access_requests','founding_partner_applications','virals_creator_applications','platform_support_requests','utility_onboarding_sessions') and tg_op='INSERT' then priority_name := 'important';
  elsif event_suffix in ('submitted','needs_info','changes_requested','declined','rejected') then priority_name := 'important'; end if;

  if product_name='records' and priority_name='activity' then return case when tg_op='DELETE' then old else new end; end if;

  if product_name='records' then
    summary_text := case when priority_name='system' then 'A Records operation failed or requires administrative attention.'
      else 'A Records account requires administrative attention.' end;
  else
    summary_text := concat_ws(' · ',
      nullif(coalesce(record_data->>'business_name',record_data->>'name',record_data->>'title',record_data->>'subject',record_data->>'full_name',record_data->>'provider_name',record_data->>'description'),''),
      nullif(coalesce(record_data->>'contact_email',record_data->>'requester_email',record_data->>'email'),''),
      nullif(coalesce(record_data->>'message',record_data->>'client_message',record_data->>'processing_error',record_data->>'error_message'),'')
    );
  end if;

  insert into public.admin_notifications(event_type,product,priority,title,summary,actor_name,actor_email,source_table,source_id,action_url,metadata)
  values (
    product_name||'.'||tg_table_name||'.'||event_suffix, product_name, priority_name,
    display_table||' '||replace(event_suffix,'_',' '), left(coalesce(summary_text,''),2000),
    case when product_name='records' then null else nullif(coalesce(record_data->>'contact_name',record_data->>'requester_name',record_data->>'full_name'),'') end,
    case when product_name='records' then null else nullif(coalesce(record_data->>'contact_email',record_data->>'requester_email',record_data->>'email'),'') end,
    tg_table_name, nullif(coalesce(record_data->>'id',record_data->>'user_id'),''), action_path,
    jsonb_build_object('operation',tg_op)
  );
  return case when tg_op='DELETE' then old else new end;
end;
$$;

revoke all on function private.capture_admin_notification() from public, anon, authenticated;
