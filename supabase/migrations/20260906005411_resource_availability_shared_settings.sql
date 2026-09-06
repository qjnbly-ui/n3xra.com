-- All current organization members have equal app permissions. Duty assignments
-- describe responsibility only and never grant or remove access.
create or replace function resource_availability_private.access(w uuid, level text default 'member', agency uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(
  select 1 from public.ra_workspaces rw
  join public.organization_private_products p on p.id=rw.id and p.organization_id=rw.organization_id
  join public.organizations o on o.id=rw.organization_id
  where rw.id=w and p.app_path='/resource-availability/'
  and (p.status='active' or (p.status='draft' and public.is_platform_admin()))
  and o.account_status in ('active','trialing','past_due')
  and (public.is_platform_admin() or o.owner_user_id=auth.uid() or exists(
    select 1 from public.organization_memberships m where m.organization_id=o.id and m.user_id=auth.uid()))
);
$$;
alter table public.ra_agencies add column version integer not null default 1;
create table public.ra_contacts(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.ra_workspaces(id),
 name text not null check(length(trim(name)) between 1 and 150),
 phone text not null default '' check(length(phone)<=80),
 email text not null default '' check(length(email)<=254 and (email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 user_id uuid references auth.users(id),
 source text not null default '' check(length(source)<=500), active boolean not null default true,
 version integer not null default 1, unique(workspace_id,name),unique(id,workspace_id)
);
create index ra_contacts_user on public.ra_contacts(user_id);
create table public.ra_duty_rotation(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.ra_workspaces(id),
 start_date date not null,end_date date check(end_date>=start_date),
 contact_id uuid not null,backup_contact_id uuid,
 active boolean not null default true,version integer not null default 1,
 foreign key(contact_id,workspace_id) references public.ra_contacts(id,workspace_id),
 foreign key(backup_contact_id,workspace_id) references public.ra_contacts(id,workspace_id),
 unique(workspace_id,start_date)
);
create index ra_rotation_contact on public.ra_duty_rotation(contact_id,workspace_id);
create index ra_rotation_backup on public.ra_duty_rotation(backup_contact_id,workspace_id);
alter table public.ra_contacts enable row level security;
alter table public.ra_duty_rotation enable row level security;
revoke all on public.ra_contacts,public.ra_duty_rotation from public,anon,authenticated;
grant select on public.ra_contacts,public.ra_duty_rotation to authenticated;
grant all on public.ra_contacts,public.ra_duty_rotation to service_role;
create policy ra_contacts_read on public.ra_contacts for select to authenticated using(resource_availability_private.access(workspace_id));
create policy ra_rotation_read on public.ra_duty_rotation for select to authenticated using(resource_availability_private.access(workspace_id));

-- Existing workflow keeps validation, revisions, approvals, and full audit payloads.
alter function resource_availability_private.command(uuid,text,jsonb) rename to command_v1;
revoke all on function resource_availability_private.command_v1(uuid,text,jsonb) from public,anon,authenticated;
create function resource_availability_private.command(w uuid,action text,args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ra_cycles; contact public.ra_contacts; rotation public.ra_duty_rotation; agency public.ra_agencies;
 result jsonb; before_row jsonb; new_roster jsonb; v_id uuid; v_start date; v_end date; v_name text; cid uuid; bid uuid;
begin
 if not resource_availability_private.access(w) then raise exception 'Resource Availability access denied' using errcode='42501'; end if;
 if args is null or jsonb_typeof(args)<>'object' or octet_length(args::text)>32000 then raise exception 'Invalid request'; end if;
 if action not in ('contact','rotation','period','agency','cycle') then
   -- Obsolete role-assignment controls are intentionally not exposed.
   if action in ('assign','reviewer') then raise exception 'All Board members already have equal access'; end if;
   return resource_availability_private.command_v1(w,action,args);
 end if;
 -- Configuration writers share one lock. Per-row versions detect stale forms.
 perform 1 from public.ra_workspaces where id=w for update;
 v_id:=nullif(args->>'id','')::uuid;
 if action='contact' then
   cid:=nullif(args->>'userId','')::uuid;
   if cid is not null and not exists(select 1 from public.ra_workspaces rw join public.organizations o on o.id=rw.organization_id where rw.id=w and (o.owner_user_id=cid or exists(select 1 from public.organization_memberships m where m.organization_id=o.id and m.user_id=cid))) then raise exception 'Choose a Board member account'; end if;
   if v_id is not null then
     select * into contact from public.ra_contacts where id=v_id and workspace_id=w for update;
     if not found then raise exception 'Contact not found'; end if;
     if contact.version is distinct from (args->>'version')::int then raise exception 'Contact changed. Refresh and try again.' using errcode='40001'; end if;
     before_row:=to_jsonb(contact);
     update public.ra_contacts set name=trim(args->>'name'),phone=trim(coalesce(args->>'phone','')),email=trim(coalesce(args->>'email','')),user_id=cid,active=coalesce((args->>'active')::boolean,true),version=version+1 where id=v_id returning * into contact;
   else
     insert into public.ra_contacts(workspace_id,name,phone,email,user_id) values(w,trim(args->>'name'),trim(coalesce(args->>'phone','')),trim(coalesce(args->>'email','')),cid) returning * into contact;
   end if;
   result:=to_jsonb(contact);
 elsif action='rotation' then
   if v_id is not null then
     select * into rotation from public.ra_duty_rotation where id=v_id and workspace_id=w for update;
     if not found then raise exception 'Assignment not found'; end if;
     if rotation.version is distinct from (args->>'version')::int then raise exception 'Assignment changed. Refresh and try again.' using errcode='40001'; end if;
     before_row:=to_jsonb(rotation);
   end if;
   v_start:=(args->>'startDate')::date;v_end:=nullif(args->>'endDate','')::date;cid:=(args->>'contactId')::uuid;bid:=nullif(args->>'backupContactId','')::uuid;
   if v_start is null or v_end<v_start then raise exception 'Check the assignment dates'; end if;
   if not exists(select 1 from public.ra_contacts where id=cid and workspace_id=w) or (bid is not null and not exists(select 1 from public.ra_contacts where id=bid and workspace_id=w)) then raise exception 'Choose a Board contact'; end if;
   if coalesce((args->>'active')::boolean,true) and exists(select 1 from public.ra_duty_rotation d where d.workspace_id=w and d.active and d.id is distinct from v_id and daterange(d.start_date,d.end_date,'[]') && daterange(v_start,v_end,'[]')) then raise exception 'These assignment dates overlap another duty chief'; end if;
   if v_id is null then
     insert into public.ra_duty_rotation(workspace_id,start_date,end_date,contact_id,backup_contact_id) values(w,v_start,v_end,cid,bid) returning * into rotation;
   else
     update public.ra_duty_rotation set start_date=v_start,end_date=v_end,contact_id=cid,backup_contact_id=bid,active=coalesce((args->>'active')::boolean,true),version=version+1 where id=v_id returning * into rotation;
   end if;
   result:=to_jsonb(rotation);
 elsif action='agency' then
   if v_id is not null then
     select * into agency from public.ra_agencies where id=v_id and workspace_id=w for update;
     if not found then raise exception 'Agency not found'; end if;
     if agency.version is distinct from (args->>'version')::int then raise exception 'Agency changed. Refresh and try again.' using errcode='40001'; end if;
     before_row:=to_jsonb(agency);
     update public.ra_agencies set name=trim(args->>'name'),county=trim(args->>'county'),active=coalesce((args->>'active')::boolean,true),version=version+1 where id=v_id returning * into agency;
   else
     insert into public.ra_agencies(workspace_id,name,county) values(w,trim(args->>'name'),trim(args->>'county')) returning * into agency;
   end if;
   result:=to_jsonb(agency);
 elsif action in ('period','cycle') then
   v_start:=(args->>'startDate')::date;v_end:=(args->>'endDate')::date;
   if v_start is null or v_end is null or v_end<v_start or v_end-v_start>31 then raise exception 'Check the reporting dates (maximum 32 days)'; end if;
   if exists(select 1 from public.ra_cycles x where x.workspace_id=w and x.id is distinct from v_id and daterange(x.start_date,x.end_date,'[]') && daterange(v_start,v_end,'[]')) then raise exception 'This period overlaps another reporting period'; end if;
   select co.name into v_name from public.ra_duty_rotation d join public.ra_contacts co on co.id=d.contact_id where d.workspace_id=w and d.active and v_start>=d.start_date and (d.end_date is null or v_start<=d.end_date);
   v_name:=coalesce(v_name,'Unassigned');
   if action='cycle' then
     return resource_availability_private.command_v1(w,'cycle',args||jsonb_build_object('dutyName',v_name));
   end if;
   select * into c from public.ra_cycles where id=v_id and workspace_id=w for update;
   if not found then raise exception 'Reporting period not found'; end if;
   if c.revision is distinct from (args->>'revision')::int then raise exception 'Period changed. Refresh and try again.' using errcode='40001'; end if;
   before_row:=to_jsonb(c);
   if args ? 'agencyIds' then
     if jsonb_typeof(args->'agencyIds')<>'array' then raise exception 'Choose the expected agencies'; end if;
     select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'county',a.county) order by a.name) into new_roster from public.ra_agencies a where a.workspace_id=w and (args->'agencyIds') ? a.id::text;
     if new_roster is null or jsonb_array_length(new_roster)<>jsonb_array_length(args->'agencyIds') then raise exception 'Choose valid, unique agencies'; end if;
     if exists(select 1 from public.ra_responses rr where rr.cycle_id=c.id and not (args->'agencyIds') ? rr.agency_id::text) then raise exception 'An agency with a saved report must stay on this period roster'; end if;
   else new_roster:=c.roster; end if;
   update public.ra_cycles set start_date=v_start,end_date=v_end,due_at=(args->>'dueAt')::timestamptz,duty_name=v_name,roster=new_roster,revision=revision+1 where id=c.id returning * into c;
   result:=to_jsonb(c);
 end if;
 if action in ('contact','rotation') then
   -- Closed periods retain their historical duty name. Any open-period change
   -- invalidates approvals; their previously approved snapshot remains intact.
   for c in select * from public.ra_cycles where workspace_id=w and not closed order by id for update loop
     select co.name into v_name from public.ra_duty_rotation d join public.ra_contacts co on co.id=d.contact_id where d.workspace_id=w and d.active and c.start_date>=d.start_date and (d.end_date is null or c.start_date<=d.end_date);
     v_name:=coalesce(v_name,'Unassigned');
     if c.duty_name is distinct from v_name then
       update public.ra_cycles set duty_name=v_name,revision=revision+1 where id=c.id;
       insert into public.ra_history(workspace_id,cycle_id,actor_id,action,payload) values(w,c.id,auth.uid(),'duty_updated',jsonb_build_object('before',c.duty_name,'after',v_name));
     end if;
   end loop;
 end if;
 insert into public.ra_history(workspace_id,cycle_id,agency_id,actor_id,action,payload) values(w,case when action='period' then c.id else null end,case when action='agency' then agency.id else null end,auth.uid(),action,jsonb_build_object('before',before_row,'result',result));
 return result;
end $$;
revoke all on function resource_availability_private.command(uuid,text,jsonb) from public,anon;
grant execute on function resource_availability_private.command(uuid,text,jsonb) to authenticated;
-- Rebind the wrapper after renaming its prior target.
create or replace function public.ra_command(workspace uuid,action text,args jsonb)
returns jsonb language sql security invoker set search_path='' as $$select resource_availability_private.command(workspace,action,args);$$;
create or replace function public.ra_snapshot(workspace uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'workspace',(select to_jsonb(w) from public.ra_workspaces w where w.id=workspace),
    'context',resource_availability_private.context(workspace),
    'contacts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]') from public.ra_contacts c where c.workspace_id=workspace),
    'rotation',(select coalesce(jsonb_agg(to_jsonb(d) order by d.start_date),'[]') from public.ra_duty_rotation d where d.workspace_id=workspace),
    'agencies',(select coalesce(jsonb_agg(to_jsonb(a) order by a.name),'[]') from public.ra_agencies a where a.workspace_id=workspace),
    'cycles',(select coalesce(jsonb_agg(to_jsonb(c) order by c.start_date desc),'[]') from public.ra_cycles c where c.workspace_id=workspace),
    'responses',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.ra_responses r where r.workspace_id=workspace),
    'approvals',(select coalesce(jsonb_agg(to_jsonb(a) order by a.approved_at desc),'[]') from public.ra_approvals a where a.workspace_id=workspace),
    'deliveries',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.ra_deliveries d where d.workspace_id=workspace),
    'assignments',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.ra_assignments a where a.workspace_id=workspace),
    'reviewers',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.ra_reviewers r where r.workspace_id=workspace),
    'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]') from (
      select id,cycle_id,agency_id,actor_id,action,payload,created_at from public.ra_history where workspace_id=workspace order by created_at desc limit 100
    ) h)
  );
$$;
revoke all on function public.ra_snapshot(uuid) from public,anon;
grant execute on function public.ra_snapshot(uuid) to authenticated;


-- Business contacts supplied in the 2026 response guide; no account memberships are created.
insert into public.ra_contacts(workspace_id,name,phone,email,source) select w.id,c.name,c.phone,c.email,'Klamath/Lake Response Guide 2026' from public.ra_workspaces w cross join (values
('David Blair','(541) 581-1423','chiefblair@kenofire.com'),
('Nate Hussey','(541) 274-0426','kcfd3firechief@gmail.com'),
('Mark Belcastro','(925) 864-9663','mbelcastro@chiloquinfire.gov'),
('Matt Hitchcock','(541) 891-5705','mhitchcock@kcfd1.com'),
('Brent Knutson','(541) 891-3101','bknutson@kcfd1.com'),
('Steven Stacey','(541) 891-2203','firechief@chiloquinfire.gov'),
('Matt Chavarria','(541) 331-8196','Matthew.chavarria@us.af.mil')) c(name,phone,email) where w.organization_id='f30f90e6-c13b-4142-a258-9e93d2ba5f12' on conflict do nothing;
insert into public.ra_duty_rotation(workspace_id,start_date,end_date,contact_id) select c.workspace_id,d.start_date,d.end_date,c.id from public.ra_contacts c join public.ra_workspaces w on w.id=c.workspace_id join (values
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
('2026-11-10'::date,null::date,'David Blair')) d(start_date,end_date,name) on d.name=c.name where w.organization_id='f30f90e6-c13b-4142-a258-9e93d2ba5f12' on conflict do nothing;
