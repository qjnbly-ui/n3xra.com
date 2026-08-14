create table if not exists public.records_support_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  granted_by_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null default 'Customer-requested support',
  can_view_documents boolean not null default false,
  can_view_recordings boolean not null default false,
  can_download_files boolean not null default false,
  can_change_content boolean not null default false,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint records_support_grants_scope_check check (
    can_view_documents or can_view_recordings or can_download_files or can_change_content
  ),
  constraint records_support_grants_expiry_check check (expires_at > created_at)
);

create index if not exists records_support_grants_active_idx
on public.records_support_grants (organization_id, expires_at desc)
where revoked_at is null;

create table if not exists public.records_support_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  grant_id uuid references public.records_support_grants(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  event_type text not null check (event_type in (
    'grant_created', 'grant_revoked', 'grant_expired', 'session_started', 'session_ended',
    'content_viewed', 'file_downloaded', 'content_changed', 'signed_link_created',
    'emergency_access_started', 'emergency_access_ended'
  )),
  resource_type text,
  resource_id text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint records_support_audit_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists records_support_audit_org_created_idx
on public.records_support_audit_log (organization_id, created_at desc);

create table if not exists public.records_emergency_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 20),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  ended_at timestamptz,
  customer_notified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint records_emergency_access_expiry_check check (expires_at > created_at)
);

alter table public.records_support_grants enable row level security;
alter table public.records_support_audit_log enable row level security;
alter table public.records_emergency_access enable row level security;

create or replace function public.is_records_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_organization_id and o.owner_user_id = (select auth.uid())
  ) or exists (
    select 1 from public.organization_memberships om
    where om.organization_id = target_organization_id and om.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_manage_records_support(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_organization_id and o.owner_user_id = (select auth.uid())
  ) or exists (
    select 1 from public.organization_memberships om
    where om.organization_id = target_organization_id
      and om.user_id = (select auth.uid()) and om.role in ('account_owner', 'account_admin')
  );
$$;

create or replace function public.active_records_support_grant(target_organization_id uuid)
returns public.records_support_grants
language sql stable security definer set search_path = public as $$
  select g from public.records_support_grants g
  where g.organization_id = target_organization_id
    and g.revoked_at is null and g.expires_at > now()
    and (select public.is_platform_admin())
  order by g.created_at desc limit 1;
$$;

create or replace function public.has_records_support_scope(target_organization_id uuid, requested_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.is_platform_admin()) and (
    exists (
      select 1 from public.records_support_grants g
      where g.organization_id = target_organization_id and g.revoked_at is null and g.expires_at > now()
        and case requested_scope
          when 'view_documents' then g.can_view_documents
          when 'view_recordings' then g.can_view_recordings
          when 'download_files' then g.can_download_files
          when 'change_content' then g.can_change_content
          else false end
    ) or exists (
      select 1 from public.records_emergency_access e
      where e.organization_id = target_organization_id
        and e.admin_user_id = (select auth.uid()) and e.ended_at is null and e.expires_at > now()
    )
  );
$$;

create or replace function public.can_view_records_documents(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_records_organization_member(target_organization_id)
    or public.has_records_support_scope(target_organization_id, 'view_documents');
$$;

create or replace function public.can_view_records_recordings(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_records_organization_member(target_organization_id)
    or public.has_records_support_scope(target_organization_id, 'view_recordings');
$$;

create or replace function public.can_change_records_content(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    public.is_records_organization_member(target_organization_id)
    and public.organization_role(target_organization_id) in ('account_admin', 'editor')
  ) or public.has_records_support_scope(target_organization_id, 'change_content');
$$;

create or replace function public.can_change_records_templates(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    public.is_records_organization_member(target_organization_id)
    and public.organization_role(target_organization_id) = 'account_admin'
  ) or public.has_records_support_scope(target_organization_id, 'change_content');
$$;

create or replace function public.can_change_records_recordings(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    public.is_records_organization_member(target_organization_id)
    and public.organization_role(target_organization_id) in ('account_admin', 'editor')
    and exists (select 1 from public.organizations o where o.id=target_organization_id and o.subscription_tier='organization')
  ) or public.has_records_support_scope(target_organization_id, 'change_content');
$$;

revoke all on function public.is_records_organization_member(uuid) from public;
revoke all on function public.can_manage_records_support(uuid) from public;
revoke all on function public.active_records_support_grant(uuid) from public;
revoke all on function public.has_records_support_scope(uuid, text) from public;
revoke all on function public.can_view_records_documents(uuid) from public;
revoke all on function public.can_view_records_recordings(uuid) from public;
revoke all on function public.can_change_records_content(uuid) from public;
revoke all on function public.can_change_records_templates(uuid) from public;
revoke all on function public.can_change_records_recordings(uuid) from public;
grant execute on function public.is_records_organization_member(uuid) to authenticated;
grant execute on function public.can_manage_records_support(uuid) to authenticated;
grant execute on function public.active_records_support_grant(uuid) to authenticated;
grant execute on function public.has_records_support_scope(uuid, text) to authenticated;
grant execute on function public.can_view_records_documents(uuid) to authenticated;
grant execute on function public.can_view_records_recordings(uuid) to authenticated;
grant execute on function public.can_change_records_content(uuid) to authenticated;
grant execute on function public.can_change_records_templates(uuid) to authenticated;
grant execute on function public.can_change_records_recordings(uuid) to authenticated;

create policy "records_support_grants_select"
on public.records_support_grants for select to authenticated
using (public.can_manage_records_support(organization_id) or public.is_platform_admin());
create policy "records_support_grants_insert"
on public.records_support_grants for insert to authenticated
with check (public.can_manage_records_support(organization_id) and granted_by_user_id = (select auth.uid()));
create policy "records_support_grants_revoke"
on public.records_support_grants for update to authenticated
using (public.can_manage_records_support(organization_id))
with check (
  public.can_manage_records_support(organization_id)
  and revoked_at is not null and revoked_by_user_id = (select auth.uid())
);

create policy "records_support_audit_select"
on public.records_support_audit_log for select to authenticated
using (public.can_manage_records_support(organization_id) or public.is_platform_admin());

create policy "records_emergency_access_select"
on public.records_emergency_access for select to authenticated
using (public.can_manage_records_support(organization_id) or public.is_platform_owner());

revoke all on public.records_support_grants, public.records_support_audit_log, public.records_emergency_access from anon;
grant select, insert, update on public.records_support_grants to authenticated;
grant select on public.records_support_audit_log, public.records_emergency_access to authenticated;
grant all on public.records_support_grants, public.records_support_audit_log, public.records_emergency_access to service_role;

create or replace function public.record_records_support_event(
  input_organization_id uuid,
  input_event_type text,
  input_resource_type text default null,
  input_resource_id text default null,
  input_reason text default null,
  input_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  new_id uuid;
  active_grant_id uuid;
begin
  if input_event_type not in ('session_started','session_ended','content_viewed','file_downloaded','content_changed','signed_link_created') then
    raise exception 'Unsupported support audit event.';
  end if;
  if not public.is_platform_admin() then raise exception 'Platform admin access required.'; end if;
  select g.id into active_grant_id from public.records_support_grants g
  where g.organization_id = input_organization_id and g.revoked_at is null and g.expires_at > now()
  order by g.created_at desc limit 1;
  if active_grant_id is null and not exists (
    select 1 from public.records_emergency_access e where e.organization_id = input_organization_id
      and e.admin_user_id = auth.uid() and e.ended_at is null and e.expires_at > now()
  ) then raise exception 'Customer support access is not active.'; end if;
  insert into public.records_support_audit_log (
    organization_id, grant_id, actor_user_id, actor_email, event_type,
    resource_type, resource_id, reason, metadata
  ) values (
    input_organization_id, active_grant_id, auth.uid(), lower(coalesce(auth.jwt()->>'email','')),
    input_event_type, nullif(input_resource_type,''), nullif(input_resource_id,''),
    nullif(input_reason,''), coalesce(input_metadata, '{}'::jsonb)
  ) returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.record_records_support_event(uuid,text,text,text,text,jsonb) from public;
grant execute on function public.record_records_support_event(uuid,text,text,text,text,jsonb) to authenticated;

create or replace function public.reconcile_records_support_expirations(input_organization_id uuid)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare inserted_count integer;
begin
  if not (public.can_manage_records_support(input_organization_id) or public.is_platform_admin()) then
    raise exception 'Records support access required.';
  end if;
  insert into public.records_support_audit_log (
    organization_id, grant_id, actor_user_id, actor_email, event_type, reason, metadata, created_at
  )
  select g.organization_id, g.id, null, null, 'grant_expired', g.reason,
    jsonb_build_object('expired_at', g.expires_at), g.expires_at
  from public.records_support_grants g
  where g.organization_id=input_organization_id and g.expires_at <= now()
    and not exists (select 1 from public.records_support_audit_log a where a.grant_id=g.id and a.event_type='grant_expired');
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function public.reconcile_records_support_expirations(uuid) from public;
grant execute on function public.reconcile_records_support_expirations(uuid) to authenticated;

create or replace function private.capture_records_support_grant_audit()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.records_support_audit_log (organization_id, grant_id, actor_user_id, actor_email, event_type, reason, metadata)
    values (new.organization_id, new.id, new.granted_by_user_id, lower(coalesce(auth.jwt()->>'email','')),
      'grant_created', new.reason, jsonb_build_object('expires_at', new.expires_at, 'scopes', jsonb_build_object(
        'view_documents',new.can_view_documents,'view_recordings',new.can_view_recordings,
        'download_files',new.can_download_files,'change_content',new.can_change_content)));
  elsif new.revoked_at is not null and old.revoked_at is null then
    insert into public.records_support_audit_log (organization_id, grant_id, actor_user_id, actor_email, event_type, reason)
    values (new.organization_id, new.id, new.revoked_by_user_id, lower(coalesce(auth.jwt()->>'email','')), 'grant_revoked', new.reason);
  end if;
  return new;
end;
$$;
revoke all on function private.capture_records_support_grant_audit() from public, anon, authenticated;
drop trigger if exists capture_records_support_grant_audit on public.records_support_grants;
create trigger capture_records_support_grant_audit
after insert or update on public.records_support_grants
for each row execute function private.capture_records_support_grant_audit();

create or replace function private.capture_records_support_content_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id uuid := nullif(row_data->>'organization_id','')::uuid;
  active_grant_id uuid;
begin
  if not public.is_platform_admin() or org_id is null then return case when tg_op='DELETE' then old else new end; end if;
  select g.id into active_grant_id from public.records_support_grants g
  where g.organization_id=org_id and g.revoked_at is null and g.expires_at > now() and g.can_change_content
  order by g.created_at desc limit 1;
  if active_grant_id is not null or exists (
    select 1 from public.records_emergency_access e where e.organization_id=org_id
      and e.admin_user_id=auth.uid() and e.ended_at is null and e.expires_at > now()
  ) then
    insert into public.records_support_audit_log (
      organization_id, grant_id, actor_user_id, actor_email, event_type, resource_type, resource_id, metadata
    ) values (
      org_id, active_grant_id, auth.uid(), lower(coalesce(auth.jwt()->>'email','')), 'content_changed',
      tg_table_name, row_data->>'id', jsonb_build_object('operation',tg_op)
    );
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.capture_records_support_content_change() from public, anon, authenticated;
drop trigger if exists capture_records_support_document_change on public.documents;
create trigger capture_records_support_document_change after insert or update or delete on public.documents
for each row execute function private.capture_records_support_content_change();
drop trigger if exists capture_records_support_app_document_change on public.app_documents;
create trigger capture_records_support_app_document_change after insert or update or delete on public.app_documents
for each row execute function private.capture_records_support_content_change();
drop trigger if exists capture_records_support_recording_change on public.meeting_recordings;
create trigger capture_records_support_recording_change after insert or update or delete on public.meeting_recordings
for each row execute function private.capture_records_support_content_change();

create or replace function public.begin_records_emergency_access(input_organization_id uuid, input_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare new_id uuid;
begin
  if not public.is_platform_owner() then raise exception 'Platform owner access required.'; end if;
  if length(trim(coalesce(input_reason,''))) < 20 then raise exception 'A detailed emergency reason is required.'; end if;
  insert into public.records_emergency_access (organization_id,admin_user_id,reason)
  values (input_organization_id,auth.uid(),trim(input_reason)) returning id into new_id;
  insert into public.records_support_audit_log (
    organization_id,actor_user_id,actor_email,event_type,reason,metadata
  ) values (
    input_organization_id,auth.uid(),lower(coalesce(auth.jwt()->>'email','')),'emergency_access_started',trim(input_reason),
    jsonb_build_object('emergency_access_id',new_id,'expires_at',now()+interval '1 hour','customer_notice','Pending immediate email delivery')
  );
  return new_id;
end;
$$;
revoke all on function public.begin_records_emergency_access(uuid,text) from public;
grant execute on function public.begin_records_emergency_access(uuid,text) to authenticated;

create or replace function public.end_records_emergency_access(input_emergency_access_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare row_data public.records_emergency_access;
begin
  if not public.is_platform_owner() then raise exception 'Platform owner access required.'; end if;
  update public.records_emergency_access set ended_at=now()
  where id=input_emergency_access_id and admin_user_id=auth.uid() and ended_at is null returning * into row_data;
  if row_data.id is null then return false; end if;
  insert into public.records_support_audit_log (organization_id,actor_user_id,actor_email,event_type,reason,metadata)
  values (row_data.organization_id,auth.uid(),lower(coalesce(auth.jwt()->>'email','')),'emergency_access_ended',row_data.reason,jsonb_build_object('emergency_access_id',row_data.id));
  return true;
end;
$$;
revoke all on function public.end_records_emergency_access(uuid) from public;
grant execute on function public.end_records_emergency_access(uuid) to authenticated;

-- Customer content policies: platform status alone no longer grants content access.
drop policy if exists "documents_select_policy" on public.documents;
create policy "documents_select_policy" on public.documents for select using (
  public.can_view_records_documents(organization_id)
  or (is_public = true and exists (select 1 from public.organizations o where o.id = organization_id and o.public_embed_enabled = true))
);
drop policy if exists "documents_insert_policy" on public.documents;
create policy "documents_insert_policy" on public.documents for insert with check (
  public.can_change_records_content(organization_id) and uploaded_by_user_id = auth.uid()
);
drop policy if exists "documents_update_policy" on public.documents;
create policy "documents_update_policy" on public.documents for update using (public.can_change_records_content(organization_id)) with check (public.can_change_records_content(organization_id));
drop policy if exists "documents_delete_policy" on public.documents;
create policy "documents_delete_policy" on public.documents for delete using (public.can_change_records_content(organization_id));

drop policy if exists "app_documents_select_policy" on public.app_documents;
create policy "app_documents_select_policy" on public.app_documents for select using (public.can_view_records_documents(organization_id));
drop policy if exists "app_documents_insert_policy" on public.app_documents;
create policy "app_documents_insert_policy" on public.app_documents for insert with check (
  created_by_user_id = auth.uid() and (
    (document_kind='document' and public.can_change_records_content(organization_id))
    or (document_kind='template' and public.can_change_records_templates(organization_id))
  )
);
drop policy if exists "app_documents_update_policy" on public.app_documents;
create policy "app_documents_update_policy" on public.app_documents for update using (
  (document_kind='document' and public.can_change_records_content(organization_id))
  or (document_kind='template' and public.can_change_records_templates(organization_id))
) with check (
  (document_kind='document' and public.can_change_records_content(organization_id))
  or (document_kind='template' and public.can_change_records_templates(organization_id))
);
drop policy if exists "app_documents_delete_policy" on public.app_documents;
create policy "app_documents_delete_policy" on public.app_documents for delete using (
  (document_kind='document' and public.can_change_records_content(organization_id))
  or (document_kind='template' and public.can_change_records_templates(organization_id))
);
drop policy if exists "meeting_recordings_select_policy" on public.meeting_recordings;
create policy "meeting_recordings_select_policy" on public.meeting_recordings for select using (public.can_view_records_recordings(organization_id));
drop policy if exists "meeting_recordings_insert_policy" on public.meeting_recordings;
create policy "meeting_recordings_insert_policy" on public.meeting_recordings for insert with check (
  public.can_change_records_recordings(organization_id) and created_by_user_id = auth.uid()
);
drop policy if exists "meeting_recordings_update_policy" on public.meeting_recordings;
create policy "meeting_recordings_update_policy" on public.meeting_recordings for update using (public.can_change_records_recordings(organization_id)) with check (public.can_change_records_recordings(organization_id));
drop policy if exists "meeting_recordings_delete_policy" on public.meeting_recordings;
create policy "meeting_recordings_delete_policy" on public.meeting_recordings for delete using (public.can_change_records_recordings(organization_id));

drop policy if exists "meeting_recording_references_select_policy" on public.meeting_recording_references;
create policy "meeting_recording_references_select_policy" on public.meeting_recording_references for select to authenticated using (
  exists (select 1 from public.meeting_recordings mr where mr.id=meeting_recording_id and public.can_view_records_recordings(mr.organization_id))
  and exists (select 1 from public.app_documents ad where ad.id=app_document_id and public.can_view_records_documents(ad.organization_id))
);
drop policy if exists "meeting_recording_references_insert_policy" on public.meeting_recording_references;
create policy "meeting_recording_references_insert_policy" on public.meeting_recording_references for insert to authenticated with check (
  exists (select 1 from public.meeting_recordings mr join public.app_documents ad on ad.id=app_document_id
    where mr.id=meeting_recording_id and ad.organization_id=mr.organization_id and ad.document_kind='document'
      and public.can_change_records_recordings(mr.organization_id) and public.can_change_records_content(mr.organization_id))
);
drop policy if exists "meeting_recording_references_update_policy" on public.meeting_recording_references;
create policy "meeting_recording_references_update_policy" on public.meeting_recording_references for update to authenticated
using (exists (select 1 from public.meeting_recordings mr where mr.id=meeting_recording_id and public.can_change_records_recordings(mr.organization_id)))
with check (exists (select 1 from public.meeting_recordings mr join public.app_documents ad on ad.id=app_document_id
  where mr.id=meeting_recording_id and ad.organization_id=mr.organization_id and ad.document_kind='document'
    and public.can_change_records_recordings(mr.organization_id) and public.can_change_records_content(mr.organization_id)));
drop policy if exists "meeting_recording_references_delete_policy" on public.meeting_recording_references;
create policy "meeting_recording_references_delete_policy" on public.meeting_recording_references for delete to authenticated using (
  exists (select 1 from public.meeting_recordings mr where mr.id=meeting_recording_id and public.can_change_records_recordings(mr.organization_id))
);

-- Routine customer activity and AI usage remain customer-visible, not platform-admin-readable.
drop policy if exists "records_activity_log_select_policy" on public.records_activity_log;
create policy "records_activity_log_select_policy" on public.records_activity_log for select to authenticated using (
  public.can_manage_records_support(organization_id)
);

drop policy if exists "records_ai_usage_events_select_policy" on public.records_ai_usage_events;
create policy "records_ai_usage_events_select_policy" on public.records_ai_usage_events for select to authenticated using (
  public.is_records_organization_member(organization_id)
);

drop policy if exists "organization_contacts_select_policy" on public.organization_contacts;
create policy "organization_contacts_select_policy" on public.organization_contacts for select using (
  public.is_records_organization_member(organization_id)
  and (public.can_manage_members(organization_id) or public.can_manage_documents(organization_id))
);

drop policy if exists "storage_select_documents_policy" on storage.objects;
create policy "storage_select_documents_policy" on storage.objects for select using (
  bucket_id = 'documents' and (
    public.can_view_records_documents(public.storage_object_org_id(name))
    or exists (select 1 from public.documents d join public.organizations o on o.id=d.organization_id
      where d.storage_path=name and d.is_public=true and o.public_embed_enabled=true)
  )
);
drop policy if exists "storage_insert_documents_policy" on storage.objects;
create policy "storage_insert_documents_policy" on storage.objects for insert with check (
  bucket_id='documents' and public.can_change_records_content(public.storage_object_org_id(name))
);
drop policy if exists "storage_update_documents_policy" on storage.objects;
create policy "storage_update_documents_policy" on storage.objects for update using (
  bucket_id='documents' and public.can_change_records_content(public.storage_object_org_id(name))
) with check (bucket_id='documents' and public.can_change_records_content(public.storage_object_org_id(name)));
drop policy if exists "storage_delete_documents_policy" on storage.objects;
create policy "storage_delete_documents_policy" on storage.objects for delete using (
  bucket_id='documents' and public.can_change_records_content(public.storage_object_org_id(name))
);
drop policy if exists "storage_select_meeting_recordings_policy" on storage.objects;
create policy "storage_select_meeting_recordings_policy" on storage.objects for select using (
  bucket_id='meeting-recordings' and public.can_view_records_recordings(public.storage_object_org_id(name))
);
drop policy if exists "storage_insert_meeting_recordings_policy" on storage.objects;
create policy "storage_insert_meeting_recordings_policy" on storage.objects for insert with check (
  bucket_id='meeting-recordings' and public.can_change_records_recordings(public.storage_object_org_id(name))
);
drop policy if exists "storage_update_meeting_recordings_policy" on storage.objects;
create policy "storage_update_meeting_recordings_policy" on storage.objects for update using (
  bucket_id='meeting-recordings' and public.can_change_records_recordings(public.storage_object_org_id(name))
) with check (bucket_id='meeting-recordings' and public.can_change_records_recordings(public.storage_object_org_id(name)));
drop policy if exists "storage_delete_meeting_recordings_policy" on storage.objects;
create policy "storage_delete_meeting_recordings_policy" on storage.objects for delete using (
  bucket_id='meeting-recordings' and public.can_change_records_recordings(public.storage_object_org_id(name))
);

-- Remove routine Records events and confidential row snapshots from the admin inbox.
delete from public.admin_notifications
where product = 'records' and priority = 'activity';
update public.admin_notifications set
  summary = case when priority='system' then 'A Records operation failed or requires administrative attention.'
    when priority='important' then 'A Records account requires administrative attention.' else '' end,
  message_text = null,
  message_html = null,
  actor_name = null,
  actor_email = null,
  metadata = jsonb_build_object('operation', metadata->>'operation')
where product = 'records';

create or replace function private.capture_admin_notification()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  record_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  before_data jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  current_state text := coalesce(record_data->>'status',record_data->>'account_status',record_data->>'transcript_status',record_data->>'ai_review_status','');
  previous_state text := coalesce(before_data->>'status',before_data->>'account_status',before_data->>'transcript_status',before_data->>'ai_review_status','');
  product_name text; priority_name text := 'activity'; event_suffix text; action_path text; safe_summary text := '';
begin
  product_name := case when tg_table_name like 'website_%' or tg_table_name='client_websites' then 'websites'
    when tg_table_name like 'partner_%' or tg_table_name='founding_partner_applications' then 'partners'
    when tg_table_name like 'virals_%' then 'virals' when tg_table_name like 'utility_%' then 'utilities'
    when tg_table_name like 'music_%' then 'music'
    when tg_table_name in ('documents','meeting_recordings','organization_invites','organization_memberships','organizations') then 'records'
    when tg_table_name='platform_support_requests' then 'support' else 'accounts' end;
  if tg_op='UPDATE' then
    if current_state is distinct from previous_state then event_suffix := nullif(current_state,''); else return new; end if;
  elsif tg_op='INSERT' then event_suffix := coalesce(nullif(current_state,''),'created');
  else event_suffix := 'deleted'; priority_name := 'important'; end if;
  if event_suffix in ('failed','error','past_due','disputed','reversed') then priority_name := 'system';
  elsif tg_table_name in ('website_service_requests','website_proposal_decisions','website_onboarding_responses','website_service_access_requests','founding_partner_applications','virals_creator_applications','platform_support_requests','utility_onboarding_sessions') and tg_op='INSERT' then priority_name := 'important';
  elsif event_suffix in ('submitted','needs_info','changes_requested','declined','rejected') then priority_name := 'important'; end if;
  if product_name='records' and priority_name='activity' then return case when tg_op='DELETE' then old else new end; end if;
  if product_name='records' then
    safe_summary := case when priority_name='system' then 'A Records operation failed or requires administrative attention.'
      else 'A Records account requires administrative attention.' end;
  else
    safe_summary := left(concat_ws(' · ',nullif(coalesce(record_data->>'business_name',record_data->>'name',record_data->>'title',record_data->>'subject',record_data->>'full_name',record_data->>'provider_name',record_data->>'description'),''),nullif(coalesce(record_data->>'contact_email',record_data->>'requester_email',record_data->>'email'),''),nullif(coalesce(record_data->>'message',record_data->>'client_message',record_data->>'processing_error',record_data->>'error_message'),'')),2000);
  end if;
  action_path := case product_name when 'records' then '/n3xra-admin/records/' when 'websites' then '/n3xra-admin/requests/' when 'partners' then '/n3xra-admin/partners/' when 'support' then '/account/admin/support/' else '/account/admin/accounts/' end;
  insert into public.admin_notifications(event_type,product,priority,title,summary,actor_name,actor_email,source_table,source_id,action_url,metadata)
  values(product_name||'.'||tg_table_name||'.'||event_suffix,product_name,priority_name,initcap(replace(tg_table_name,'_',' '))||' '||replace(event_suffix,'_',' '),safe_summary,
    case when product_name='records' then null else nullif(coalesce(record_data->>'contact_name',record_data->>'requester_name',record_data->>'full_name'),'') end,
    case when product_name='records' then null else nullif(coalesce(record_data->>'contact_email',record_data->>'requester_email',record_data->>'email'),'') end,
    tg_table_name,nullif(coalesce(record_data->>'id',record_data->>'user_id'),''),action_path,jsonb_build_object('operation',tg_op));
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.capture_admin_notification() from public, anon, authenticated;
