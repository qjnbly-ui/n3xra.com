create index organization_product_member_access_granted_by_idx
  on public.organization_product_member_access (granted_by)
  where granted_by is not null;
;
