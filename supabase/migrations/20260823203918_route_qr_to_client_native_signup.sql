-- A branded website may host its own signup screen while continuing to use
-- the canonical Communications form, source, consent, and tenant records.
-- Keep N3XRA-hosted QR links valid for previously downloaded codes, and allow
-- QR submissions from the subscription form's verified client origins.
do $migration$
declare
  function_signature regprocedure := 'public.ingest_website_form_submission(uuid,text,text,text,text,jsonb,uuid[],text[],jsonb,text,text,boolean)'::regprocedure;
  function_definition text;
  existing_clause text := $clause$if target_source.source_type in ('hosted_signup', 'qr_campaign') then
    if normalized_origin not in ('https://n3xra.com', 'https://www.n3xra.com') then
      raise exception 'Submission origin is not allowed.';
    end if;
  elsif normalized_origin = '' or not (normalized_origin = any(target_form.allowed_origins)) then
    raise exception 'Submission origin is not allowed.';
  end if;$clause$;
  replacement_clause text := $clause$if target_source.source_type = 'hosted_signup' then
    if normalized_origin not in ('https://n3xra.com', 'https://www.n3xra.com') then
      raise exception 'Submission origin is not allowed.';
    end if;
  elsif target_source.source_type = 'qr_campaign' then
    if normalized_origin not in ('https://n3xra.com', 'https://www.n3xra.com')
       and (normalized_origin = '' or not (normalized_origin = any(target_form.allowed_origins))) then
      raise exception 'Submission origin is not allowed.';
    end if;
  elsif normalized_origin = '' or not (normalized_origin = any(target_form.allowed_origins)) then
    raise exception 'Submission origin is not allowed.';
  end if;$clause$;
begin
  select pg_get_functiondef(function_signature) into function_definition;
  if strpos(function_definition, replacement_clause) > 0 then
    return;
  end if;
  if strpos(function_definition, existing_clause) = 0 then
    raise exception 'Expected hosted and QR signup origin clause was not found.';
  end if;
  execute replace(function_definition, existing_clause, replacement_clause);
end;
$migration$;

update public.communications_signup_sources source
set metadata = jsonb_set(
  coalesce(source.metadata, '{}'::jsonb),
  '{landing_url}',
  to_jsonb('https://www.rootsandrelicsgreenhouse.com/join/'::text),
  true
)
from public.communications_workspaces workspace
where source.workspace_id = workspace.id
  and workspace.slug = 'roots-and-relics'
  and source.source_type in ('website_embed', 'qr_campaign')
  and source.status = 'active';

comment on function public.ingest_website_form_submission(
  uuid, text, text, text, text, jsonb, uuid[], text[], jsonb, text, text, boolean
) is 'Ingests universal website forms while preserving verified source attribution, client-native QR origins, tenant ownership, independent channel preferences, and exact consent.';
