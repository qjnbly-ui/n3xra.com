create table if not exists public.document_share_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.app_documents (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  token_hash text not null unique,
  label text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists document_share_links_document_id_idx
on public.document_share_links (document_id);

create index if not exists document_share_links_organization_id_idx
on public.document_share_links (organization_id);

alter table public.document_share_links enable row level security;
