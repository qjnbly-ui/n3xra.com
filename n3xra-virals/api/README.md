# N3XRA Virals API

This folder contains product-scoped API source files.

For Vercel deployment, add thin wrappers in the root `api/` directory when endpoints are ready. Keeping the product source here makes the Virals boundary clear while the main site remains unchanged.

Expected server environment variables:

```txt
GROQ_API_KEY
GROQ_VIRALS_API_KEY optional override
GROQ_VIRALS_MODEL optional override
MASTER_SUPABASE_URL later
MASTER_SUPABASE_SERVICE_ROLE_KEY later
VIRALS_SUPABASE_URL later
VIRALS_SUPABASE_SERVICE_ROLE_KEY later
SCRAPECREATORS_API_KEY optional future fallback
```

The API should:

1. verify the user session against N3XRA Master
2. verify Virals product access in N3XRA Master
3. write product data to N3XRA Virals Supabase
4. return analysis status/results to the frontend

Current prototype endpoints:

- `POST /api/virals-transcript` tries to extract TikTok page metadata and WEBVTT subtitles from TikTok's embedded page data.
- `POST /api/virals-analyze` tries the same TikTok transcript extraction first, then sends extracted context to Groq for framework analysis.

This avoids video downloads when TikTok exposes subtitle metadata, but it is a best-effort scraper path and can break. ScrapeCreators should remain the paid fallback once a key is available.
