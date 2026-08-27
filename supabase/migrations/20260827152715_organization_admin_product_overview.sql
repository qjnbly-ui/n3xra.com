create or replace function public.client_portal_organization_access_snapshot(input_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare organization_record public.organizations%rowtype;
begin
  if auth.uid() is null or not public.can_view_organization(input_organization_id) then raise exception 'You do not have access to this organization.'; end if;
  select * into organization_record from public.organizations where id = input_organization_id;
  if organization_record.id is null then raise exception 'Organization not found.'; end if;
  return jsonb_build_object(
    'organization', jsonb_build_object('id', organization_record.id, 'name', organization_record.name),
    'products', coalesce((select jsonb_agg(product order by sort_order, name) from (
      select jsonb_build_object('access_key', e.product_key, 'product_key', e.product_key, 'name', p.name, 'status', e.status, 'workspace_name', organization_record.name, 'manage_path', p.portal_path) product, p.sort_order, p.name
      from public.organization_product_entitlements e join public.n3xra_product_catalog p on p.product_key=e.product_key
      where e.organization_id=input_organization_id and e.portal_enabled and e.status in ('trialing','active','past_due') and p.status='active'
      union all
      select jsonb_build_object('access_key','website:'||w.id::text,'product_key','website','name','Website Management','status',w.status,'workspace_name',w.name,'manage_path','/client-portal/'),10,w.name
      from public.client_websites w where w.organization_id=input_organization_id
    ) products), '[]'::jsonb),
    'member_access', coalesce((select jsonb_object_agg(m.user_id::text,coalesce(a.roles,'{}'::jsonb))
      from public.organization_memberships m left join lateral (
        select jsonb_object_agg(x.access_key,x.role) roles from (
          select e.product_key access_key,m.role from public.organization_product_entitlements e where e.organization_id=m.organization_id and e.portal_enabled and e.status in ('trialing','active','past_due')
          union all
          select 'website:'||w.id::text,case wm.role when 'owner' then 'account_admin' else wm.role end from public.client_websites w join public.website_members wm on wm.website_id=w.id where w.organization_id=m.organization_id and wm.user_id=m.user_id and wm.status='active'
        ) x
      ) a on true where m.organization_id=input_organization_id), '{}'::jsonb)
  );
end; $$;
revoke all on function public.client_portal_organization_access_snapshot(uuid) from public, anon;
grant execute on function public.client_portal_organization_access_snapshot(uuid) to authenticated;
