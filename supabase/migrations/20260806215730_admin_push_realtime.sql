drop policy if exists "admin_push_devices_select_own" on public.admin_push_devices;
create policy "admin_push_devices_select_own"
on public.admin_push_devices
for select to authenticated
using (user_id = auth.uid() and public.is_platform_admin());

do $$
begin
  alter publication supabase_realtime add table public.admin_notifications;
exception
  when duplicate_object then null;
end $$;;
