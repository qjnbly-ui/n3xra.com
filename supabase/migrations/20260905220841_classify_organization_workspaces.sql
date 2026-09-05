-- Workspace classification affects directory presentation, never authorization.
alter table public.organizations add column workspace_kind text not null default 'organization'
  check (workspace_kind in ('organization','personal','product'));
comment on column public.organizations.workspace_kind is
  'Directory classification. Personal and product-only workspaces remain available to their accounts but are excluded from the business organization directory.';
update public.organizations set workspace_kind = 'personal'
  where slug in ('personal','lindsey-mauldin');
update public.organizations set workspace_kind = 'product' where slug = 'project-cards';
