insert into storage.buckets (id, name, public, file_size_limit)
values ('project-card-resources', 'project-card-resources', true, 52428800)
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit;

drop policy if exists "project_card_resource_upload_select" on storage.objects;
create policy "project_card_resource_upload_select" on storage.objects for select to authenticated using (
  bucket_id='project-card-resources' and exists (
    select 1 from public.project_card_projects project
    where project.organization_id::text=(storage.foldername(name))[1]
      and project.id::text=(storage.foldername(name))[2]
      and public.can_view_project_cards(project.organization_id)
  )
);

drop policy if exists "project_card_resource_upload_insert" on storage.objects;
create policy "project_card_resource_upload_insert" on storage.objects for insert to authenticated with check (
  bucket_id='project-card-resources' and owner_id=(select auth.uid())::text and exists (
    select 1 from public.project_card_projects project
    where project.organization_id::text=(storage.foldername(name))[1]
      and project.id::text=(storage.foldername(name))[2]
      and public.can_manage_project_cards(project.organization_id)
  )
);

drop policy if exists "project_card_resource_upload_update" on storage.objects;
create policy "project_card_resource_upload_update" on storage.objects for update to authenticated using (
  bucket_id='project-card-resources' and exists (
    select 1 from public.project_card_projects project
    where project.organization_id::text=(storage.foldername(name))[1]
      and project.id::text=(storage.foldername(name))[2]
      and public.can_manage_project_cards(project.organization_id)
  )
) with check (
  bucket_id='project-card-resources' and exists (
    select 1 from public.project_card_projects project
    where project.organization_id::text=(storage.foldername(name))[1]
      and project.id::text=(storage.foldername(name))[2]
      and public.can_manage_project_cards(project.organization_id)
  )
);

drop policy if exists "project_card_resource_upload_delete" on storage.objects;
create policy "project_card_resource_upload_delete" on storage.objects for delete to authenticated using (
  bucket_id='project-card-resources' and exists (
    select 1 from public.project_card_projects project
    where project.organization_id::text=(storage.foldername(name))[1]
      and project.id::text=(storage.foldername(name))[2]
      and public.can_manage_project_cards(project.organization_id)
  )
);

create or replace function public.get_project_card_page(input_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when input_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(input_slug) not between 3 and 80 then null else (
    select jsonb_build_object(
      'slug',project.slug,'name',project.name,'description',project.description,'location_text',project.location_text,'updated_at',project.updated_at,
      'resources',coalesce((select jsonb_agg(jsonb_build_object(
        'id',resource.id,'resource_type',resource.resource_type,'title',resource.title,'detail',resource.detail,'content',resource.content,
        'external_url',resource.external_url,'storage_path',resource.storage_path,'sort_order',resource.sort_order
      ) order by resource.sort_order,resource.created_at) from public.project_card_resources resource where resource.project_id=project.id and resource.is_visible),'[]'::jsonb)
    ) from public.project_card_projects project where project.slug=input_slug and project.status='live' and project.access_level='public' limit 1
  ) end;
$$;

revoke all on function public.get_project_card_page(text) from public;
grant execute on function public.get_project_card_page(text) to anon, authenticated;
