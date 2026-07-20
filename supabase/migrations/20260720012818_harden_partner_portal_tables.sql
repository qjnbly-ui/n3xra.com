create index if not exists partner_commission_entries_referral_idx
on public.partner_commission_entries (referral_id)
where referral_id is not null;

drop policy if exists "partner_referrals_service_role_policy" on public.partner_referrals;
create policy "partner_referrals_service_role_policy"
on public.partner_referrals
for all
to service_role
using (true)
with check (true);

drop policy if exists "partner_commission_entries_service_role_policy" on public.partner_commission_entries;
create policy "partner_commission_entries_service_role_policy"
on public.partner_commission_entries
for all
to service_role
using (true)
with check (true);
