# N3XRA Utilities Supabase

This folder is for the future separate N3XRA Utilities Supabase project.

The schema draft stores coordination data only. It does not make N3XRA the owner of utility operator users. Operator users should remain in each utility company's Supabase Auth project.

## Security Model

- Utility-owned Supabase projects own operator Auth users.
- N3XRA Utilities stores tenant linkage, setup state, and support coordination.
- Server-side API routes verify utility operator sessions before reading or writing coordination data.
- Service-role keys must never be exposed in browser code.
- RLS is enabled on all public tables as defense in depth.
- Browser policies are intentionally not broad until the final auth model exists.

## Current State

`schema.sql` is a planning schema. Do not apply it as a production migration until the tenant verification flow, roles, and API access model are finalized.
