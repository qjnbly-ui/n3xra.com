# N3XRA Utilities API Notes

Production Utilities endpoints live in the root `api/` directory:

- `api/utilities-onboarding.js` creates utility organization setup records.
- `api/utilities-admin.js` serves N3XRA platform-admin review and update actions.
- `api/utilities-portal.js` returns public-safe branded portal configuration.

These endpoints use the main N3XRA Supabase project through server-side service-role REST calls. Service-role keys must never be exposed in browser code.

Browser-facing routes send only public-safe data or authenticated platform-admin requests with a Supabase access token.
