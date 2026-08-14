revoke all on function public.is_records_organization_member(uuid) from anon;
revoke all on function public.can_manage_records_support(uuid) from anon;
revoke all on function public.active_records_support_grant(uuid) from anon;
revoke all on function public.has_records_support_scope(uuid, text) from anon;
revoke all on function public.can_view_records_documents(uuid) from anon;
revoke all on function public.can_view_records_recordings(uuid) from anon;
revoke all on function public.can_change_records_content(uuid) from anon;
revoke all on function public.can_change_records_templates(uuid) from anon;
revoke all on function public.can_change_records_recordings(uuid) from anon;
revoke all on function public.record_records_support_event(uuid,text,text,text,text,jsonb) from anon;
revoke all on function public.reconcile_records_support_expirations(uuid) from anon;
revoke all on function public.begin_records_emergency_access(uuid,text) from anon;
revoke all on function public.end_records_emergency_access(uuid) from anon;

create index if not exists records_support_grants_granted_by_idx
on public.records_support_grants (granted_by_user_id);

create index if not exists records_support_grants_revoked_by_idx
on public.records_support_grants (revoked_by_user_id)
where revoked_by_user_id is not null;

create index if not exists records_support_audit_actor_idx
on public.records_support_audit_log (actor_user_id, created_at desc)
where actor_user_id is not null;

create index if not exists records_emergency_access_admin_idx
on public.records_emergency_access (admin_user_id, expires_at desc);
