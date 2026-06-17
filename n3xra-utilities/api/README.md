# N3XRA Utilities API

This folder contains product-scoped API source files for the Utilities portal.

For Vercel deployment, add thin wrappers in the root `api/` directory when endpoints are ready. Keeping source files here makes the Utilities boundary clear while the main site remains unchanged.

Expected future server environment variables:

```txt
UTILITIES_SUPABASE_URL
UTILITIES_SUPABASE_SERVICE_ROLE_KEY
UTILITY_TENANT_CONFIG_SECRET
N3XRA_MASTER_SUPABASE_URL optional
N3XRA_MASTER_SUPABASE_SERVICE_ROLE_KEY optional
```

The API should:

1. identify the requested utility tenant
2. load the tenant's registered Supabase project metadata
3. verify the operator session against that utility-owned Supabase project
4. check N3XRA-side tenant linkage and permissions
5. read or write only N3XRA Utilities coordination data

Current prototype endpoint:

- `POST /api/utilities-tenant-session` is not wired yet and should return a setup placeholder until tenant verification is implemented.
