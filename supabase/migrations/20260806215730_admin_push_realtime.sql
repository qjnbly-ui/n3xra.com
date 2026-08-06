-- Allow the signed-in admin app to receive notification inserts while it is open.
do $$
begin
  alter publication supabase_realtime add table public.admin_notifications;
exception
  when duplicate_object then null;
end $$;
