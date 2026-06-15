# N3XRA Virals

N3XRA Virals is the viral framework intelligence product inside the N3XRA platform.

Tagline: Discover. Analyze. Create.

Core positioning:

```txt
Daily Virals shows what is working.
TokScript rewrites what is working.
N3XRA Virals explains why it works and turns it into reusable content systems.
```

## Product Boundary

N3XRA Master Supabase owns:

- auth
- users
- organizations
- billing
- subscriptions
- product access

N3XRA Virals Supabase owns:

- videos
- transcripts
- AI analyses
- trends
- creators
- products
- saved scripts

Virals should receive verified `master_user_id` and `organization_id` values from the N3XRA Master platform. It should not become a separate login system unless the product intentionally becomes standalone later.

## V1 Workflow

The first product workflow is:

```txt
Paste TikTok/Daily Virals reference -> Extract Framework -> Generate Posting Pack
```

V1 should support:

- TikTok or Daily Virals reference URL submission
- optional product, niche, goal, transcript, caption, or notes
- framework extraction for hook type, body structure, psychology, and CTA logic
- generated hooks
- generated script variations
- generated captions, CTAs, and shot lists
- saved framework library
- localStorage prototype mode before paid backend setup
- Groq-powered analysis through `/api/virals-analyze` when `GROQ_API_KEY` or `GROQ_VIRALS_API_KEY` is available

Advanced TikTok Shop data imports, competitor tracking, product research, and monitoring can be added after the framework analyzer workflow works end to end.

If Groq is not configured, the web prototype falls back to local framework rules so the UI remains testable.

## Folder Structure

```txt
n3xra-virals/
  README.md
  product/
    vision.md
    v1-roadmap.md
  supabase/
    schema.sql
    README.md
  api/
    README.md
    analyze.js

virals/
  index.html
  virals.css
  virals.js
```

## Deployment Note

The public app now lives at `/virals/` so the URL can be `n3xra.com/virals/`. The `n3xra-virals/` folder keeps product planning, API notes, and Supabase schema work together. On Vercel, functions usually need to live in the root `api/` directory to deploy automatically.
