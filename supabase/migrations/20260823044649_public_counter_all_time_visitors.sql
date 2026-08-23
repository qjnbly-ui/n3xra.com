alter table public.website_public_traffic_counters
  drop constraint website_public_traffic_counters_metric_check;

alter table public.website_public_traffic_counters
  add constraint website_public_traffic_counters_metric_check
  check (metric in ('all_time_pageviews', 'all_time_visitors', 'daily_visitors'));
