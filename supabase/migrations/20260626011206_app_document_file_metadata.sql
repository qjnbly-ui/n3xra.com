alter table public.app_documents
add column if not exists year text,
add column if not exists month text,
add column if not exists is_public boolean not null default false,
add column if not exists records_ai_note text;

create index if not exists app_documents_is_public_idx
on public.app_documents (organization_id, is_public)
where document_kind = 'document';
