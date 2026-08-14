create or replace function private.sync_website_partner_referral_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral_status text;
begin
  if new.status is not distinct from old.status or new.partner_application_id is null then
    return new;
  end if;

  referral_status := case
    when new.status in ('qualified', 'proposal_drafting', 'proposal_sent', 'approved') then 'qualified'
    when new.status in ('converted', 'active') then 'converted'
    when new.status in ('declined') then 'not_qualified'
    else null
  end;

  if referral_status is not null then
    update public.partner_referrals
       set status = referral_status,
           updated_at = now()
     where website_request_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_website_partner_referral_status() from public, anon, authenticated;

drop trigger if exists sync_website_partner_referral_status on public.website_service_requests;
create trigger sync_website_partner_referral_status
after update of status on public.website_service_requests
for each row execute function private.sync_website_partner_referral_status();
