create index if not exists n3xra_business_information_updated_by_idx
  on public.n3xra_business_information (updated_by)
  where updated_by is not null;

create index if not exists n3xra_business_file_links_created_by_idx
  on public.n3xra_business_file_links (created_by);

drop policy if exists "n3xra_business_information_service_access" on public.n3xra_business_information;
create policy "n3xra_business_information_service_access"
on public.n3xra_business_information
for all
to service_role
using (true)
with check (true);

drop policy if exists "n3xra_business_file_links_service_access" on public.n3xra_business_file_links;
create policy "n3xra_business_file_links_service_access"
on public.n3xra_business_file_links
for all
to service_role
using (true)
with check (true);
