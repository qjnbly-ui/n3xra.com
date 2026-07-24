create index website_billing_schedules_client_idx
  on public.website_billing_schedules (client_user_id);
create index website_billing_schedules_approved_by_idx
  on public.website_billing_schedules (approved_by_user_id)
  where approved_by_user_id is not null;
create index website_billing_schedules_created_by_idx
  on public.website_billing_schedules (created_by_user_id);

create index website_billing_charges_snapshot_idx
  on public.website_billing_charges (snapshot_id)
  where snapshot_id is not null;
create index website_billing_charges_client_idx
  on public.website_billing_charges (client_user_id);
create index website_billing_charges_approved_by_idx
  on public.website_billing_charges (approved_by_user_id)
  where approved_by_user_id is not null;
create index website_billing_charges_created_by_idx
  on public.website_billing_charges (created_by_user_id);
create index website_billing_charges_local_invoice_idx
  on public.website_billing_charges (local_invoice_id)
  where local_invoice_id is not null;

create index website_billing_communications_client_idx
  on public.website_billing_communications (client_user_id);
create index website_billing_communications_invoice_idx
  on public.website_billing_communications (invoice_id)
  where invoice_id is not null;
create index website_billing_communications_charge_idx
  on public.website_billing_communications (charge_id)
  where charge_id is not null;
create index website_billing_communications_sender_idx
  on public.website_billing_communications (sent_by_user_id)
  where sent_by_user_id is not null;
