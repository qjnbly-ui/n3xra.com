# N3XRA Virals API

This folder contains product-scoped API source files.

For Vercel deployment, add thin wrappers in the root `api/` directory when endpoints are ready. Keeping the product source here makes the Virals boundary clear while the main site remains unchanged.

Expected server environment variables:

```txt
MASTER_SUPABASE_URL
MASTER_SUPABASE_SERVICE_ROLE_KEY
VIRALS_SUPABASE_URL
VIRALS_SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
```

The API should:

1. verify the user session against N3XRA Master
2. verify Virals product access in N3XRA Master
3. write product data to N3XRA Virals Supabase
4. return analysis status/results to the frontend

