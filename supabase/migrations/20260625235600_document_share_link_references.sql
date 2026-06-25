alter table public.document_share_links
add column if not exists reference_document_ids uuid[] not null default '{}';
