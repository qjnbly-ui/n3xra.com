-- QR campaigns open the same N3XRA-hosted signup page as hosted links, but
-- retain their own source type so attribution remains exact. Extend the
-- existing verified-source origin exception without rewriting its applied
-- predecessor migration.
do $migration$
declare
  function_signature regprocedure := 'public.ingest_website_form_submission(uuid,text,text,text,text,jsonb,uuid[],text[],jsonb,text,text,boolean)'::regprocedure;
  function_definition text;
  existing_clause text := 'if target_source.source_type = ''hosted_signup'' then';
  replacement_clause text := 'if target_source.source_type in (''hosted_signup'', ''qr_campaign'') then';
begin
  select pg_get_functiondef(function_signature) into function_definition;
  if strpos(function_definition, replacement_clause) > 0 then
    return;
  end if;
  if strpos(function_definition, existing_clause) = 0 then
    raise exception 'Expected hosted signup origin clause was not found.';
  end if;
  if strpos(substr(function_definition, strpos(function_definition, existing_clause) + length(existing_clause)), existing_clause) > 0 then
    raise exception 'Hosted signup origin clause was unexpectedly duplicated.';
  end if;
  execute replace(function_definition, existing_clause, replacement_clause);
end;
$migration$;

comment on function public.ingest_website_form_submission(
  uuid, text, text, text, text, jsonb, uuid[], text[], jsonb, text, text, boolean
) is 'Ingests universal website forms and permits email consent collection before provider delivery activation while preserving verified hosted and QR source origins, tenant ownership, and exact consent.';
