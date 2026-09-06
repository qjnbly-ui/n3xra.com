-- Private Resource Availability application. No operational data is imported.
-- Mutation functions live outside the exposed schema and check the caller anew.
create schema resource_availability_private;
revoke all on schema resource_availability_private from public, anon;
grant usage on schema resource_availability_private to authenticated;

create unique index organization_private_products_id_org on public.organization_private_products(id, organization_id);
create table public.ra_workspaces (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  name text not null,
  foreign key (id, organization_id) references public.organization_private_products(id, organization_id)
);
create table public.ra_agencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ra_workspaces(id),
  name text not null check (length(trim(name)) between 1 and 150),
  county text not null check (length(trim(county)) between 1 and 80),
  active boolean not null default true,
  unique(workspace_id, name), unique(id, workspace_id)
);
create table public.ra_assignments (
  agency_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id),
  primary key (agency_id, user_id),
  foreign key (agency_id, workspace_id) references public.ra_agencies(id, workspace_id)
);
create index ra_assignments_user on public.ra_assignments(user_id, workspace_id);
create table public.ra_reviewers (
  workspace_id uuid not null references public.ra_workspaces(id),
  user_id uuid not null references auth.users(id),
  primary key(workspace_id, user_id)
);
create index ra_reviewers_user on public.ra_reviewers(user_id);
create table public.ra_cycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ra_workspaces(id),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  due_at timestamptz not null,
  duty_name text not null check(length(trim(duty_name)) between 1 and 150),
  roster jsonb not null check(jsonb_typeof(roster) = 'array' and jsonb_array_length(roster) > 0),
  revision integer not null default 0,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(workspace_id, start_date), unique(id,workspace_id)
);
create table public.ra_responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  agency_id uuid not null,
  payload jsonb not null,
  version integer not null default 1,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  unique(cycle_id, agency_id),
  foreign key(cycle_id, workspace_id) references public.ra_cycles(id, workspace_id),
  foreign key(agency_id, workspace_id) references public.ra_agencies(id, workspace_id)
);
create index ra_responses_agency on public.ra_responses(agency_id,workspace_id);
create index ra_responses_workspace on public.ra_responses(workspace_id);
create index ra_responses_user on public.ra_responses(updated_by);
create table public.ra_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  revision integer not null,
  payload jsonb not null,
  snapshot jsonb not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  foreign key(cycle_id,workspace_id) references public.ra_cycles(id,workspace_id),
  unique(cycle_id,revision)
);
create index ra_approvals_workspace on public.ra_approvals(workspace_id);
create index ra_approvals_user on public.ra_approvals(approved_by);
create table public.ra_deliveries (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references public.ra_approvals(id),
  workspace_id uuid not null references public.ra_workspaces(id),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  reference text not null check(length(trim(reference)) between 1 and 1000)
);
create index ra_deliveries_workspace on public.ra_deliveries(workspace_id);
create index ra_deliveries_user on public.ra_deliveries(recorded_by);
create table public.ra_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ra_workspaces(id),
  cycle_id uuid references public.ra_cycles(id),
  agency_id uuid references public.ra_agencies(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index ra_history_workspace on public.ra_history(workspace_id,created_at);
create index ra_history_cycle on public.ra_history(cycle_id);
create index ra_history_agency on public.ra_history(agency_id);
create index ra_history_actor on public.ra_history(actor_id);

create function resource_availability_private.access(w uuid, level text default 'member', agency uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.ra_workspaces rw
    join public.organization_private_products p on p.id=rw.id and p.organization_id=rw.organization_id
    join public.organizations o on o.id=rw.organization_id
    where rw.id=w and p.app_path='/resource-availability/'
      and (p.status='active' or (p.status='draft' and public.is_platform_admin()))
      and o.account_status in ('active','trialing','past_due')
      and (public.is_platform_admin() or o.owner_user_id=auth.uid() or exists (
        select 1 from public.organization_memberships m where m.organization_id=o.id and m.user_id=auth.uid()))
      and (level='member' or public.is_platform_admin() or o.owner_user_id=auth.uid() or exists (
        select 1 from public.organization_memberships m where m.organization_id=o.id and m.user_id=auth.uid() and m.role='account_admin')
        or (level='reviewer' and exists(select 1 from public.ra_reviewers r where r.workspace_id=w and r.user_id=auth.uid()))
        or (level='agency' and exists(select 1 from public.ra_assignments a where a.workspace_id=w and a.agency_id=agency and a.user_id=auth.uid()))
      )
  );
$$;

-- Direct API access is read-only; workflow RPCs are the only write path.
do $$ declare t text; begin
  foreach t in array array['ra_workspaces','ra_agencies','ra_assignments','ra_reviewers','ra_cycles','ra_responses','ra_approvals','ra_deliveries','ra_history'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create policy ra_workspaces_read on public.ra_workspaces for select to authenticated using(resource_availability_private.access(id));
create policy ra_agencies_read on public.ra_agencies for select to authenticated using(resource_availability_private.access(workspace_id));
create policy ra_assignments_read on public.ra_assignments for select to authenticated using(resource_availability_private.access(workspace_id,'admin') or (user_id=(select auth.uid()) and resource_availability_private.access(workspace_id)));
create policy ra_reviewers_read on public.ra_reviewers for select to authenticated using(resource_availability_private.access(workspace_id,'admin') or (user_id=(select auth.uid()) and resource_availability_private.access(workspace_id)));
create policy ra_cycles_read on public.ra_cycles for select to authenticated using(resource_availability_private.access(workspace_id));
create policy ra_responses_read on public.ra_responses for select to authenticated using(resource_availability_private.access(workspace_id,'reviewer') or resource_availability_private.access(workspace_id,'agency',agency_id));
create policy ra_approvals_read on public.ra_approvals for select to authenticated using(resource_availability_private.access(workspace_id,'reviewer'));
create policy ra_deliveries_read on public.ra_deliveries for select to authenticated using(resource_availability_private.access(workspace_id,'reviewer'));
create policy ra_history_read on public.ra_history for select to authenticated using(resource_availability_private.access(workspace_id,'reviewer') or resource_availability_private.access(workspace_id,'agency',agency_id));

create function resource_availability_private.validate_payload(p jsonb, review boolean default false, complete boolean default true)
returns void language plpgsql set search_path='' as $$
declare k text; n integer; total integer;
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>24000 then raise exception 'Invalid form'; end if;
  foreach k in array case when review then array['type1','type3','type6','tender','qualified','teams'] else array['type1','type3','type6','tender','qualified','trainees','extraCrew','simultaneous'] end loop
    if coalesce(jsonb_typeof(p->k),'null')<>'number' or (p->>k)!~'^[0-9]{1,3}$' then raise exception 'Enter a whole number from 0 to 999 for %',k; end if;
  end loop;
  foreach k in array array['prepo','conflag','outOfState'] loop
    if coalesce(jsonb_typeof(p->k),'null')<>'boolean' then raise exception 'Choose deployment availability'; end if;
  end loop;
  foreach k in array array['notes','leaderDetails','contactName','contactPhone','contactEmail','reason','crewDetails'] loop
    if p ? k and (jsonb_typeof(p->k)<>'string' or length(p->>k)>4000) then raise exception 'Invalid text field'; end if;
  end loop;
  if p ? 'overhead' then
    if jsonb_typeof(p->'overhead')<>'array' then raise exception 'Invalid overhead selection'; end if;
    if jsonb_array_length(p->'overhead')>12 or exists(select 1 from jsonb_array_elements_text(p->'overhead') o where o not in ('IC','Liaison','Safety','PIO','Operations','Logistics','Planning','Div/Group Supervisor','Resource Unit Leader','Situation Unit Leader','Communication Unit Leader','Task Force/Strike Team Leader')) then raise exception 'Invalid overhead selection'; end if;
  end if;
  if complete and (length(trim(coalesce(p->>'contactName','')))=0 or (review and (length(trim(coalesce(p->>'contactPhone','')))<7
    or coalesce(p->>'contactEmail','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))) then raise exception 'Complete the reporting contact'; end if;
  total := (p->>'type1')::int+(p->>'type3')::int+(p->>'type6')::int+(p->>'tender')::int;
  if not review then
    n := (p->>'simultaneous')::int;
    if n>total then raise exception 'Simultaneous resources cannot exceed equipment options'; end if;
    if complete and (p->>'qualified')::int+(p->>'trainees')::int>0 and length(trim(coalesce(p->>'leaderDetails','')))=0 then raise exception 'List leader names, qualifications, and contact information'; end if;
    if complete and n<total and length(trim(coalesce(p->>'notes','')))=0 then raise exception 'Explain the shared staffing or deployment limit'; end if;
  elsif (p->>'teams')::int>(p->>'qualified')::int then raise exception 'Each reported team needs a qualified leader'; end if;
end $$;

create function resource_availability_private.command(w uuid, action text, args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ra_cycles; r public.ra_responses; a public.ra_approvals; ag public.ra_agencies;
  p jsonb; snap jsonb; totals jsonb; result jsonb; roster jsonb; member_id uuid; v_agency_id uuid;
  k text; option_total integer; reported_total integer; missing integer;
begin
  if not resource_availability_private.access(w) then raise exception 'Resource Availability access denied' using errcode='42501'; end if;
  if action in ('agency','assign','reviewer') then
    if not resource_availability_private.access(w,'admin') then raise exception 'Organization administrator required' using errcode='42501'; end if;
    if action='agency' then
      if nullif(args->>'id','') is null then
        insert into public.ra_agencies(workspace_id,name,county) values(w,trim(args->>'name'),trim(args->>'county')) returning * into ag;
      else
        update public.ra_agencies set name=trim(args->>'name'),county=trim(args->>'county'),active=(args->>'active')::boolean
          where id=(args->>'id')::uuid and workspace_id=w returning * into ag;
        if not found then raise exception 'Agency not found'; end if;
      end if;
      result:=to_jsonb(ag);
    else
      member_id:=(args->>'userId')::uuid;
      if not exists(select 1 from public.ra_workspaces rw join public.organizations o on o.id=rw.organization_id where rw.id=w and
        (o.owner_user_id=member_id or exists(select 1 from public.organization_memberships m where m.organization_id=o.id and m.user_id=member_id))) then raise exception 'Choose an existing organization member'; end if;
      if action='reviewer' then
        if (args->>'enabled')::boolean then insert into public.ra_reviewers values(w,member_id) on conflict do nothing;
        else delete from public.ra_reviewers where workspace_id=w and user_id=member_id; end if;
      else
        v_agency_id:=(args->>'agencyId')::uuid;
        if not exists(select 1 from public.ra_agencies where id=v_agency_id and workspace_id=w) then raise exception 'Agency not found'; end if;
        if (args->>'enabled')::boolean then insert into public.ra_assignments values(v_agency_id,w,member_id) on conflict do nothing;
        else delete from public.ra_assignments where agency_id=v_agency_id and ra_assignments.agency_id=(args->>'agencyId')::uuid and workspace_id=w and user_id=member_id; end if;
      end if;
      result:='{}';
    end if;
  elsif action='cycle' then
    if not resource_availability_private.access(w,'reviewer') then raise exception 'Reviewer access required' using errcode='42501'; end if;
    select jsonb_agg(jsonb_build_object('id',id,'name',name,'county',county) order by county,name) into roster from public.ra_agencies where workspace_id=w and active;
    if roster is null then raise exception 'Add the expected agencies first'; end if;
    insert into public.ra_cycles(workspace_id,start_date,end_date,due_at,duty_name,roster)
      values(w,(args->>'startDate')::date,(args->>'endDate')::date,(args->>'dueAt')::timestamptz,trim(args->>'dutyName'),roster) returning * into c;
    result:=to_jsonb(c);
  elsif action in ('shared_save','save','approve','close','delivered','reopen_review') then
    -- Serialize all edits and approvals against one cycle; no stale approval race.
    select * into c from public.ra_cycles where id=(args->>'cycleId')::uuid and workspace_id=w for update;
    if not found then raise exception 'Reporting period not found'; end if;
    if action in ('save','shared_save') then
      v_agency_id:=(args->>'agencyId')::uuid;
      if c.closed then raise exception 'This period is closed'; end if;
      if action='save' and not resource_availability_private.access(w,'agency',v_agency_id) then raise exception 'This agency is not assigned to you' using errcode='42501'; end if;
      if not exists(select 1 from jsonb_array_elements(c.roster) x where x->>'id'=v_agency_id::text) then raise exception 'Agency is not on this period roster'; end if;
      select * into r from public.ra_responses where cycle_id=c.id and ra_responses.agency_id=(args->>'agencyId')::uuid;
      if action='save' and (coalesce(r.version,0) <> (args->>'version')::int or args->>'version' is null) then raise exception 'This report changed. Refresh before saving.' using errcode='40001'; end if;
      if action='shared_save' and ((now() at time zone 'America/Los_Angeles')::date not between c.start_date and c.end_date or (args->>'submit')::boolean is distinct from true) then raise exception 'Choose the current reporting week'; end if;
      p:=args->'payload';
      perform resource_availability_private.validate_payload(p,false,coalesce((args->>'submit')::boolean,false));
      insert into public.ra_responses(workspace_id,cycle_id,agency_id,payload,submitted_at,updated_by)
        values(w,c.id,v_agency_id,p,case when (args->>'submit')::boolean then now() else null end,auth.uid())
        on conflict(cycle_id,agency_id) do update set payload=excluded.payload,submitted_at=excluded.submitted_at,version=ra_responses.version+1,updated_at=now(),updated_by=auth.uid()
        returning * into r;
      update public.ra_cycles set revision=revision+1 where id=c.id;
      result:=to_jsonb(r);
    else
      if not resource_availability_private.access(w,'reviewer') then raise exception 'Reviewer access required' using errcode='42501'; end if;
      if c.revision <> (args->>'revision')::int or args->>'revision' is null then raise exception 'Agency reports changed. Refresh and review again.' using errcode='40001'; end if;
      if action='reopen_review' then
        update public.ra_cycles set revision=revision+1 where id=c.id;
        result:='{}';
      elsif action='close' then
        update public.ra_cycles set closed=(args->>'closed')::boolean where id=c.id;
        result:='{}';
      elsif action='approve' then
        p:=args->'payload'; perform resource_availability_private.validate_payload(p,true);
        select coalesce(jsonb_agg(to_jsonb(rr) order by rr.agency_id),'[]') into snap from public.ra_responses rr where rr.cycle_id=c.id and rr.submitted_at is not null and exists(select 1 from jsonb_array_elements(c.roster) z where z->>'id'=rr.agency_id::text and z->>'county'<>'Harney');
        select coalesce(jsonb_agg(x),'[]') into roster from jsonb_array_elements(c.roster) x where x->>'county'<>'Harney';
        missing:=jsonb_array_length(roster)-jsonb_array_length(snap);
        select jsonb_build_object('type1',coalesce(sum((x->'payload'->>'type1')::int),0),'type3',coalesce(sum((x->'payload'->>'type3')::int),0),
          'type6',coalesce(sum((x->'payload'->>'type6')::int),0),'tender',coalesce(sum((x->'payload'->>'tender')::int),0),
          'qualified',coalesce(sum((x->'payload'->>'qualified')::int),0),'simultaneous',coalesce(sum((x->'payload'->>'simultaneous')::int),0)) into totals from jsonb_array_elements(snap) x;
        foreach k in array array['type1','type3','type6','tender','qualified'] loop
          if (p->>k)::int>(totals->>k)::int then raise exception 'Reviewed % exceeds submitted availability',k; end if;
        end loop;
        reported_total:=(p->>'type1')::int+(p->>'type3')::int+(p->>'type6')::int+(p->>'tender')::int;
        option_total:=(totals->>'type1')::int+(totals->>'type3')::int+(totals->>'type6')::int+(totals->>'tender')::int;
        if reported_total>(totals->>'simultaneous')::int then raise exception 'Reviewed equipment exceeds simultaneous deployment capacity'; end if;
        if (missing>0 or option_total>(totals->>'simultaneous')::int) and length(trim(coalesce(p->>'reason','')))=0 then raise exception 'Explain missing reports and shared staffing decisions'; end if;
        if (p->>'confirmed')::boolean is distinct from true then raise exception 'Confirm staffing, leaders, and deployment restrictions'; end if;
        insert into public.ra_approvals(workspace_id,cycle_id,revision,payload,snapshot,approved_by)
          values(w,c.id,c.revision,p,jsonb_build_object('roster',roster,'responses',snap,'startDate',c.start_date,'endDate',c.end_date,'missing',missing),auth.uid()) returning * into a;
        result:=to_jsonb(a);
      else
        select * into a from public.ra_approvals where id=(args->>'approvalId')::uuid and cycle_id=c.id and workspace_id=w;
        if not found or a.revision<>c.revision then raise exception 'A current approval is required'; end if;
        insert into public.ra_deliveries(approval_id,workspace_id,recorded_by,reference) values(a.id,w,auth.uid(),trim(args->>'reference')) returning to_jsonb(ra_deliveries.*) into result;
      end if;
    end if;
  else raise exception 'Unknown action'; end if;
  insert into public.ra_history(workspace_id,cycle_id,agency_id,actor_id,action,payload) values(w,c.id,case when action in ('save','shared_save') then v_agency_id else null end,auth.uid(),action,jsonb_build_object('input',args,'result',result));
  return result;
end $$;

create function resource_availability_private.context(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare people jsonb:='[]';
begin
  if not resource_availability_private.access(w) then raise exception 'Resource Availability access denied' using errcode='42501'; end if;
  if resource_availability_private.access(w,'admin') then
    select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email) order by u.email),'[]') into people
    from auth.users u where exists(select 1 from public.ra_workspaces rw join public.organizations o on o.id=rw.organization_id where rw.id=w and
      (o.owner_user_id=u.id or exists(select 1 from public.organization_memberships m where m.organization_id=o.id and m.user_id=u.id)));
  end if;
  return jsonb_build_object('admin',resource_availability_private.access(w,'admin'),'reviewer',resource_availability_private.access(w,'reviewer'),'members',people);
end $$;
create function public.ra_command(workspace uuid, action text, args jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select resource_availability_private.command(workspace,action,args); $$;
create function public.ra_context(workspace uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select resource_availability_private.context(workspace); $$;
revoke all on all functions in schema resource_availability_private from public,anon,authenticated;
grant execute on function resource_availability_private.access(uuid,text,uuid),resource_availability_private.command(uuid,text,jsonb),resource_availability_private.context(uuid) to authenticated;
revoke all on function public.ra_command(uuid,text,jsonb),public.ra_context(uuid) from public,anon;
grant execute on function public.ra_command(uuid,text,jsonb),public.ra_context(uuid) to authenticated;

-- One statement snapshot keeps displayed reports and their revision consistent.
-- Aggregation also avoids silently truncating a growing report history at the
-- Data API's default row limit. All source queries remain subject to RLS.
create function public.ra_snapshot(workspace uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'workspace',(select to_jsonb(w) from public.ra_workspaces w where w.id=workspace),
    'context',resource_availability_private.context(workspace),
    'agencies',(select coalesce(jsonb_agg(to_jsonb(a) order by a.name),'[]') from public.ra_agencies a where a.workspace_id=workspace),
    'cycles',(select coalesce(jsonb_agg(to_jsonb(c) order by c.start_date desc),'[]') from public.ra_cycles c where c.workspace_id=workspace),
    'responses',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.ra_responses r where r.workspace_id=workspace),
    'approvals',(select coalesce(jsonb_agg(to_jsonb(a) order by a.approved_at desc),'[]') from public.ra_approvals a where a.workspace_id=workspace),
    'deliveries',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.ra_deliveries d where d.workspace_id=workspace),
    'assignments',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.ra_assignments a where a.workspace_id=workspace),
    'reviewers',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.ra_reviewers r where r.workspace_id=workspace),
    'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]') from (
      select id,cycle_id,agency_id,action,created_at from public.ra_history where workspace_id=workspace order by created_at desc limit 100
    ) h)
  );
$$;
revoke all on function public.ra_snapshot(uuid) from public,anon;
grant execute on function public.ra_snapshot(uuid) to authenticated;

-- Exact organization verified against N3XRA; keep Draft until release checks pass.
insert into public.organization_private_products(organization_id,name,description,app_path,status)
select id,'Resource Availability','Agency reporting and duty chief review for Klamath and Lake Counties.','/resource-availability/','draft'
from public.organizations where id='f30f90e6-c13b-4142-a258-9e93d2ba5f12' and name='Klamath County Fire Defense Board'
on conflict(organization_id,app_path) do nothing;
insert into public.ra_workspaces(id,organization_id,name)
select p.id,p.organization_id,'Klamath County Fire Defense Board' from public.organization_private_products p
where p.organization_id='f30f90e6-c13b-4142-a258-9e93d2ba5f12' and p.app_path='/resource-availability/' on conflict do nothing;

-- Reporting roster from the live weekly Smartsheet form, September 5, 2026.
insert into public.ra_agencies(id,workspace_id,name,county)
select a.id::uuid,w.id,a.name,a.county from public.ra_workspaces w cross join (values
('20260000-0000-4000-8000-000000000001','Bly RFPD','Klamath'),
('20260000-0000-4000-8000-000000000002','Bonanza RFPD','Klamath'),
('20260000-0000-4000-8000-000000000003','Central Cascades Fire & EMS','Klamath'),
('20260000-0000-4000-8000-000000000004','Chemult RFPD','Klamath'),
('20260000-0000-4000-8000-000000000005','Chiloquin-Agency Lk RFPD','Klamath'),
('20260000-0000-4000-8000-000000000006','Christmas Valley RFPD','Lake'),
('20260000-0000-4000-8000-000000000007','Crescent RFPD','Klamath'),
('20260000-0000-4000-8000-000000000008','Keno RFPD','Klamath'),
('20260000-0000-4000-8000-000000000009','Kingsley Field FD','Klamath'),
('20260000-0000-4000-8000-000000000010','Klamath County FD3','Klamath'),
('20260000-0000-4000-8000-000000000011','Klamath County FD4','Klamath'),
('20260000-0000-4000-8000-000000000012','Klamath County FD5','Klamath'),
('20260000-0000-4000-8000-000000000013','Klamath County FD1','Klamath'),
('20260000-0000-4000-8000-000000000014','Lakeview Fire','Lake'),
('20260000-0000-4000-8000-000000000015','Malin RFPD','Klamath'),
('20260000-0000-4000-8000-000000000016','Merrill RFPD','Klamath'),
('20260000-0000-4000-8000-000000000017','New Pine Creek RFPD','Lake'),
('20260000-0000-4000-8000-000000000018','Oregon Outback RFPD','Klamath'),
('20260000-0000-4000-8000-000000000019','Paisley F.D.','Lake'),
('20260000-0000-4000-8000-000000000020','Rocky Point Fire & EMS','Klamath'),
('20260000-0000-4000-8000-000000000021','Silver Lake RFPD','Lake'),
('20260000-0000-4000-8000-000000000022','Thomas Creek-Westside RFPD','Lake'),
('20260000-0000-4000-8000-000000000023','Walker Range Fire Patrol','Klamath'),
('20260000-0000-4000-8000-000000000024','Burns F.D.','Harney'),
('20260000-0000-4000-8000-000000000025','Hines F.D.','Harney')) a(id,name,county) where w.organization_id='f30f90e6-c13b-4142-a258-9e93d2ba5f12' on conflict do nothing;
-- Weekly reporting periods and duty names from the 2026 response guide.
-- These contain no availability reports. Future periods cannot accept shared submissions.
insert into public.ra_cycles(workspace_id,start_date,end_date,due_at,duty_name,roster)
select w.id,d.day::date,d.day::date+6,(d.day::date+time '10:00') at time zone 'America/Los_Angeles',rotation.name,
(select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'county',a.county) order by a.name) from public.ra_agencies a where a.workspace_id=w.id and a.active)
from public.ra_workspaces w cross join generate_series(date '2026-03-30',date '2026-11-09',interval '7 days') d(day)
join (values
('2026-03-30'::date,'2026-04-12'::date,'David Blair'),
('2026-04-13'::date,'2026-04-26'::date,'Nate Hussey'),
('2026-04-27'::date,'2026-05-10'::date,'Mark Belcastro'),
('2026-05-11'::date,'2026-05-17'::date,'Matt Hitchcock'),
('2026-05-18'::date,'2026-05-24'::date,'Brent Knutson'),
('2026-05-25'::date,'2026-06-07'::date,'Steven Stacey'),
('2026-06-08'::date,'2026-06-21'::date,'Matt Chavarria'),
('2026-06-22'::date,'2026-07-05'::date,'Nate Hussey'),
('2026-07-06'::date,'2026-07-19'::date,'David Blair'),
('2026-07-20'::date,'2026-08-02'::date,'Mark Belcastro'),
('2026-08-03'::date,'2026-08-09'::date,'Matt Hitchcock'),
('2026-08-10'::date,'2026-08-16'::date,'Brent Knutson'),
('2026-08-17'::date,'2026-08-30'::date,'Nate Hussey'),
('2026-08-31'::date,'2026-09-13'::date,'Matt Chavarria'),
('2026-09-14'::date,'2026-09-27'::date,'Nate Hussey'),
('2026-09-28'::date,'2026-10-11'::date,'David Blair'),
('2026-10-12'::date,'2026-10-25'::date,'Mark Belcastro'),
('2026-10-26'::date,'2026-11-01'::date,'Matt Hitchcock'),
('2026-11-02'::date,'2026-11-09'::date,'Brent Knutson'),
('2026-11-10'::date,'2026-12-31'::date,'David Blair')) rotation(start_date,end_date,name) on d.day::date between rotation.start_date and rotation.end_date
where w.organization_id='f30f90e6-c13b-4142-a258-9e93d2ba5f12' on conflict do nothing;
