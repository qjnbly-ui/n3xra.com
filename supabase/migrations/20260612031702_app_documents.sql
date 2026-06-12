create table if not exists public.app_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_document_id uuid references public.documents (id) on delete set null,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  content_json jsonb not null default '{"type":"records_document","version":1,"blocks":[]}'::jsonb,
  plain_text text,
  document_kind text not null default 'document',
  status text not null default 'draft',
  last_sent_at timestamptz,
  search_tsv tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(plain_text, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_documents_content_json_object_check check (jsonb_typeof(content_json) = 'object'),
  constraint app_documents_document_kind_check check (document_kind in ('document', 'template')),
  constraint app_documents_status_check check (status in ('draft', 'final', 'archived'))
);

create index if not exists app_documents_organization_id_idx on public.app_documents (organization_id);
create index if not exists app_documents_source_document_id_idx on public.app_documents (source_document_id);
create index if not exists app_documents_updated_at_idx on public.app_documents (updated_at desc);
create index if not exists app_documents_search_tsv_idx on public.app_documents using gin (search_tsv);

drop trigger if exists app_documents_set_updated_at on public.app_documents;
create trigger app_documents_set_updated_at
before update on public.app_documents
for each row execute procedure public.set_updated_at();

alter table public.app_documents enable row level security;

drop policy if exists "app_documents_select_policy" on public.app_documents;
create policy "app_documents_select_policy"
on public.app_documents
for select
using (public.can_view_organization(organization_id));

drop policy if exists "app_documents_insert_policy" on public.app_documents;
create policy "app_documents_insert_policy"
on public.app_documents
for insert
with check (
  public.can_manage_documents(organization_id)
  and created_by_user_id = auth.uid()
);

drop policy if exists "app_documents_update_policy" on public.app_documents;
create policy "app_documents_update_policy"
on public.app_documents
for update
using (public.can_manage_documents(organization_id))
with check (public.can_manage_documents(organization_id));

drop policy if exists "app_documents_delete_policy" on public.app_documents;
create policy "app_documents_delete_policy"
on public.app_documents
for delete
using (public.can_manage_documents(organization_id));
