create index website_billing_snapshot_items_proposal_line_item_idx
  on public.website_billing_snapshot_items (proposal_line_item_id)
  where proposal_line_item_id is not null;
create index website_billing_snapshots_partner_application_idx
  on public.website_billing_snapshots (partner_application_id)
  where partner_application_id is not null;
create index website_billing_snapshots_prepared_by_idx
  on public.website_billing_snapshots (prepared_by_user_id);
create index website_billing_snapshots_proposal_idx
  on public.website_billing_snapshots (proposal_id);
create index website_subscriptions_billing_customer_idx
  on public.website_subscriptions (website_billing_customer_id);
;
