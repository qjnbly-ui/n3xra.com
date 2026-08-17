-- Career applications must be submitted through the server-side endpoint,
-- where Cloudflare Turnstile is verified before any database or storage write.
drop policy if exists "careers_public_application_submit" on public.careers_applications;
drop policy if exists "careers_signed_in_application_submit" on public.careers_applications;
revoke insert on public.careers_applications from anon, authenticated;

drop policy if exists "careers_files_submit" on storage.objects;
revoke insert on storage.objects from anon, authenticated;
