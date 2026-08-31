do $migration$
declare
  function_definition text;
  previous_guard text := 'and not (state = ''failed'' and failure_stage = ''queued'')';
  replacement_guard text := 'and not (state = ''failed'' and (failure_stage = ''queued'' or actor_is_admin))';
begin
  select pg_get_functiondef('public.claim_website_change_run(uuid,uuid,text,text)'::regprocedure)
  into function_definition;

  if position(previous_guard in function_definition) = 0 then
    raise exception 'The website preview retry guard no longer matches the expected definition.';
  end if;

  execute replace(function_definition, previous_guard, replacement_guard);
end;
$migration$;

comment on function public.claim_website_change_run(uuid, uuid, text, text) is
'Starts Vercel previews only for active platform administrators, permits request-owner Fast Preview auto-start, and allows only an administrator to retry a diagnosed failed preview without the client cooldown.';
