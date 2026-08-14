-- Website access and product-library access are separate. This nullable legacy
-- reference is retained for compatibility, but portal apps are discovered from
-- the signed-in user's memberships and do not use it to select a library.
comment on column public.client_websites.organization_id is
'Legacy optional organization reference retained for compatibility. Website access uses website_members; portal app access and active libraries use the signed-in user memberships independently.';;
