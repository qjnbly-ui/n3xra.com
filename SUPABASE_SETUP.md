# Supabase Setup

This repo now includes a simple authenticated app at [app/index.html](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/index.html).

## Simplest deployment model

For the current MVP:

- Vercel only hosts the static files
- Supabase handles Auth, Database, and Storage
- text extraction happens in the browser during upload

That means you do **not** need:

- a Vercel `/api/ingest-document` route
- a Supabase Edge Function
- the `service_role` key

For now, the browser:

1. reads the file locally
2. extracts text for supported file types
3. uploads the original file to Supabase Storage
4. saves the extracted text into the `documents` table

This matches your existing pattern of storing extracted text once and searching that saved text later.

## Files to use

- [app/index.html](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/index.html): session router entrypoint
- [app/login.html](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/login.html): auth page
- [app/dashboard.html](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/dashboard.html): signed-in dashboard
- [app/login.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/login.js): signup and sign-in logic
- [app/dashboard.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/dashboard.js): profile, billing, upload, search, and downloads
- [app/lib/plan-config.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/lib/plan-config.js): shared plan definitions and limits
- [app/lib/supabase-client.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/lib/supabase-client.js): shared Supabase client helper
- [app/styles.css](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/styles.css): shared app styles
- [app/config.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/config.js): client config
- [supabase/schema.sql](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/supabase/schema.sql): tables, storage bucket, and RLS policies
- [supabase/manual_billing_updates.sql](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/supabase/manual_billing_updates.sql): pre-Stripe manual tier changes

## What you need to configure

You already have the two client-side values the app needs:

- `supabaseUrl`
- `supabaseAnonKey`

Those belong in [app/config.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/config.js).

You do **not** need to add anything to Vercel environment variables for this version unless you later add a real server-side API.

## What still needs to be done in Supabase

1. Make sure you ran [supabase/schema.sql](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/supabase/schema.sql)
2. In `Authentication -> Providers`, make sure email/password auth is enabled
3. Deploy the site files to Vercel or your website
4. Open `/app/`
5. Create an account
6. Upload a supported file

If billing fields were added before this pass, rerun [supabase/schema.sql](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/supabase/schema.sql) so the new billing-protection trigger is installed.

If you already ran the schema before the signup form was expanded, also add these columns to `profiles`:

```sql
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists organization_name text;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists subscription_tier text not null default 'free';
alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles add column if not exists document_limit integer not null default 25;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists stripe_price_id text;
alter table public.profiles add column if not exists subscription_current_period_end timestamptz;
```

Then run:

```sql
alter table public.profiles drop constraint if exists profiles_subscription_tier_check;
alter table public.profiles
  add constraint profiles_subscription_tier_check
  check (subscription_tier in ('free', 'starter', 'organization'));

alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'trialing', 'past_due', 'canceled'));
```

## Supported file types in the simple version

- `.docx`
- `.txt`
- `.md`
- `.csv`
- `.json`
- `.html`
- `.htm`

Not supported yet:

- `.pdf`
- scanned image OCR
- legacy `.doc`

For unsupported types, convert them to `.docx` first.

## Why this is simpler

Because extraction is happening in the browser, there is no private backend runtime to manage right now.

That avoids:

- function deployment
- secret management
- service role access
- `/api/...` routing

## When you will eventually need a backend

You should move extraction to a backend later if you add:

- PDF parsing
- OCR
- AI summaries
- embeddings
- document chat
- long-running processing

At that point, a Vercel API route is probably the easiest next step for you.

## Pre-Stripe billing flow

Right now:

- the app enforces plan document limits
- the UI reads tier, status, and Stripe metadata from `profiles`
- signed-in users can edit profile fields only
- billing fields are meant to be changed outside the client app

Until Stripe is connected, use [supabase/manual_billing_updates.sql](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/supabase/manual_billing_updates.sql) in Supabase SQL Editor to:

- move an account between `free`, `starter`, and `organization`
- change `account_status`
- attach Stripe ids later when Stripe goes live
