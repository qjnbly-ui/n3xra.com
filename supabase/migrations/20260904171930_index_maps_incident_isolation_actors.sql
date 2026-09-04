drop index if exists public.map_incident_isolation_plans_incident_idx;

create index if not exists map_incident_valve_actions_created_by_idx
  on public.map_incident_valve_actions (created_by_user_id);

create index if not exists map_incident_isolation_plans_calculated_by_idx
  on public.map_incident_isolation_plans (calculated_by_user_id);
