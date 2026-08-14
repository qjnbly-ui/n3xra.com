alter table public.website_asset_versions
add column if not exists upload_batch_id uuid;

create index if not exists website_asset_versions_upload_batch_idx
on public.website_asset_versions (upload_batch_id)
where upload_batch_id is not null;

create or replace function private.group_website_asset_batch_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  batch_count integer;
  notification_to_keep uuid;
  batch_summary text;
begin
  if new.upload_batch_id is null
    or new.status <> 'pending_review' then
    return new;
  end if;

  select
    count(*)::integer,
    string_agg(version.original_filename, ', ' order by version.created_at, version.id)
  into batch_count, batch_summary
  from public.website_asset_versions version
  where version.upload_batch_id = new.upload_batch_id
    and version.status = 'pending_review';

  select notification.id
  into notification_to_keep
  from public.admin_notifications notification
  where notification.event_type = 'websites.website_asset_versions.pending_review'
    and (
      notification.metadata ->> 'upload_batch_id' = new.upload_batch_id::text
      or exists (
        select 1
        from public.website_asset_versions version
        where version.id::text = notification.source_id
          and version.upload_batch_id = new.upload_batch_id
      )
    )
  order by notification.created_at desc, notification.id desc
  limit 1;

  if notification_to_keep is null then
    return new;
  end if;

  update public.admin_notifications
  set
    title = case
      when batch_count = 1 then 'Website asset version pending review'
      else batch_count || ' website asset versions pending review'
    end,
    summary = left(coalesce(batch_summary, ''), 2000),
    source_id = new.upload_batch_id::text,
    metadata = metadata || jsonb_build_object(
      'upload_batch_id', new.upload_batch_id,
      'asset_count', batch_count
    )
  where id = notification_to_keep;

  delete from public.admin_notifications notification
  where notification.id <> notification_to_keep
    and notification.event_type = 'websites.website_asset_versions.pending_review'
    and (
      notification.metadata ->> 'upload_batch_id' = new.upload_batch_id::text
      or exists (
        select 1
        from public.website_asset_versions version
        where version.id::text = notification.source_id
          and version.upload_batch_id = new.upload_batch_id
      )
    );

  return new;
end;
$$;

revoke all on function private.group_website_asset_batch_notification()
from public, anon, authenticated;

drop trigger if exists group_website_asset_batch_notification
on public.website_asset_versions;

create trigger group_website_asset_batch_notification
after insert on public.website_asset_versions
for each row
execute function private.group_website_asset_batch_notification();
