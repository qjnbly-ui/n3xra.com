-- Run in a transaction after the migration; all fixture rows are rolled back.
insert into auth.users(id,email) values ('10000000-0000-4000-8000-000000000001','phone-review-fixture@example.invalid');
insert into public.platform_admins(user_id,email,role,status,access_scope) values
 ('10000000-0000-4000-8000-000000000001','phone-review-fixture@example.invalid','owner','active','full');
insert into public.ai_phone_conversations(id,user_id,website_id,call_id,configured_model,rules_version)
 select '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',id,'CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','fixture','fixture'
 from public.client_websites limit 1;
insert into public.ai_phone_events(id,conversation_id,sequence,kind,text,created_at) values
 ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',1,'caller','Fixture only',now());
do $$ declare r text; t text; privilege text; result jsonb; v uuid;
begin
 foreach r in array array['anon','authenticated'] loop
  foreach t in array array['ai_phone_conversations','ai_phone_events','ai_phone_instructions'] loop
   foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if has_table_privilege(r,'public.'||t,privilege) then raise exception 'Unexpected % grant to % on %',privilege,r,t; end if;
   end loop;
   if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing'; end if;
  end loop;
  if has_function_privilege(r,'public.apply_ai_phone_instruction(uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'RPC exposed'; end if;
 end loop;
 result:=public.apply_ai_phone_instruction('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',null,'Preserve intent','Avoid invented URLs');
 if result->>'instruction'<>'Preserve intent' then raise exception 'Instruction not applied'; end if;
 v:=(result->>'version')::uuid;
 result:=public.apply_ai_phone_instruction('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',null,'Stale overwrite','Must fail');
 if result is not null then raise exception 'Concurrent update was not rejected'; end if;
 result:=public.apply_ai_phone_instruction('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',v,'','Return to defaults');
 if result->>'instruction'<>'' then raise exception 'Could not clear instructions'; end if;
 if not exists(select 1 from public.ai_phone_conversations where id='10000000-0000-4000-8000-000000000002' and applied_at is not null) then raise exception 'Missing approval audit'; end if;
end $$;

update public.ai_phone_conversations set expires_at=now()-interval '1 day' where id='10000000-0000-4000-8000-000000000002';
delete from public.ai_phone_conversations where expires_at<now();
do $$ begin
 if exists(select 1 from public.ai_phone_events where conversation_id='10000000-0000-4000-8000-000000000002') then raise exception 'Expired event retained'; end if;
 if not exists(select 1 from public.ai_phone_instructions where user_id='10000000-0000-4000-8000-000000000001') then raise exception 'Explicit instruction unexpectedly expired'; end if;
end $$;
