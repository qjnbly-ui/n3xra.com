drop function if exists public.get_public_embed_documents(uuid);

create or replace function public.get_public_embed_documents(input_organization_id uuid)
returns table (
  id uuid,
  title text,
  original_filename text,
  storage_path text,
  extracted_text text,
  year text,
  month text,
  created_at timestamptz,
  editable_document_id uuid,
  effective_title text,
  effective_original_filename text,
  effective_text text,
  has_editable_document boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_organization_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = input_organization_id
      and o.public_embed_enabled = true
  ) then
    return;
  end if;

  return query
  select
    d.id,
    d.title,
    d.original_filename,
    d.storage_path,
    d.extracted_text,
    d.year,
    d.month,
    d.created_at,
    ad.id as editable_document_id,
    coalesce(nullif(ad.title, ''), d.title) as effective_title,
    coalesce(
      case
        when ad.id is not null then nullif(trim(regexp_replace(coalesce(ad.title, ''), '\.[^.]+$', '')), '') || '.pdf'
        else null
      end,
      d.original_filename
    ) as effective_original_filename,
    coalesce(nullif(btrim(ad.plain_text), ''), d.extracted_text) as effective_text,
    ad.id is not null as has_editable_document
  from public.documents d
  left join lateral (
    select linked.id, linked.title, linked.plain_text, linked.status, linked.updated_at, linked.created_at
    from public.app_documents linked
    where linked.organization_id = d.organization_id
      and linked.source_document_id = d.id
      and linked.document_kind = 'document'
    order by
      (linked.status = 'final') desc,
      linked.updated_at desc nulls last,
      linked.created_at desc nulls last
    limit 1
  ) ad on true
  where d.organization_id = input_organization_id
    and d.is_public = true
  order by d.created_at desc;
end;
$$;

grant execute on function public.get_public_embed_documents(uuid) to anon, authenticated;
