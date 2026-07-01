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
- [supabase/reviews.sql](/Users/quentinnichols/Documents/Websites/n3xra.com/supabase/reviews.sql): standalone review table/RLS update if your database already ran the main schema
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
3. In `Authentication -> URL Configuration`, set the Site URL to `https://n3xra.com` and add these Redirect URLs:
   - `https://n3xra.com/account`
   - `https://www.n3xra.com/account`
   - `https://n3xra.com/app`
   - `https://n3xra.com/app/login`
   - `https://n3xra.com/app/reset-password`
   - `https://www.n3xra.com/app`
   - `https://www.n3xra.com/app/login`
   - `https://www.n3xra.com/app/reset-password`
4. Deploy the site files to Vercel or your website
5. Open `/app/`
6. Create an account
7. Upload a supported file

If billing fields were added before this pass, rerun [supabase/schema.sql](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/supabase/schema.sql) so the new billing-protection trigger is installed.

If reviews are missing in an already deployed database, run [supabase/reviews.sql](/Users/quentinnichols/Documents/Websites/n3xra.com/supabase/reviews.sql) in the Supabase SQL Editor. This creates one shared `reviews` table for N3XRA Records organization reviews and AI Music profile reviews.

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
- the UI reads tier, status, and Stripe metadata from `organizations`
- signed-in users can edit profile fields only
- billing fields are meant to be changed outside the client app

Until Stripe is connected, use [supabase/manual_billing_updates.sql](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/supabase/manual_billing_updates.sql) in Supabase SQL Editor to:

- move an account between `free`, `starter`, and `organization`
- change `account_status`
- attach Stripe ids later when Stripe goes live

## Stripe billing setup

This repo now includes Supabase Edge Functions for Stripe:

- `stripe-billing`: creates Checkout and Customer Portal sessions
- `stripe-webhook`: receives Stripe webhook events and syncs the `organizations` table

### Required app config

Set this in [app/config.js](/Users/quentinnichols/Documents/Websites/n3xra.com/app/config.js):

```js
window.RECORDS_APP_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  billingEnabled: true,
};
```

### Required Supabase function secrets

Add these secrets before deploying the billing functions:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_ORGANIZATION`
- `APP_ORIGIN`

### Stripe product setup

Create two recurring monthly prices in Stripe:

- Starter: `$12/month`
- Organization: `$39/month`

Copy those price ids into:

- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_ORGANIZATION`

### Deploy functions

```bash
supabase functions deploy stripe-billing
supabase functions deploy stripe-webhook
```

### Webhook endpoint

Point Stripe to:

```text
https://YOUR-PROJECT-REF.supabase.co/functions/v1/stripe-webhook
```

Subscribe the webhook to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### Billing behavior

- Free libraries start paid plans through Stripe Checkout
- Active paid libraries manage upgrades, downgrades, cancellation, and payment methods in Stripe Customer Portal
- Stripe webhooks are the source of truth for `subscription_tier`, `account_status`, limits, and renewal date in `organizations`

## AI Music Stripe billing setup

AI Music billing uses separate Supabase Edge Functions so it does not change the existing N3XRA Records billing flow:

- `music-billing`: creates AI Music Checkout and Customer Portal sessions
- `music-stripe-webhook`: receives AI Music Stripe webhook events and syncs `music_profiles`

The existing Records functions remain separate:

- `stripe-billing`
- `stripe-webhook`

### AI Music plans

Create two recurring monthly Stripe prices:

- Creator: `$4.99/month`, 25 songs per billing period
- Studio: `$12.99/month`, 100 songs per billing period

Copy those Stripe price ids into Supabase function secrets:

- `STRIPE_PRICE_MUSIC_CREATOR`
- `STRIPE_PRICE_MUSIC_STUDIO`

### Required Supabase function secrets

Add these secrets before deploying the AI Music billing functions:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_MUSIC_WEBHOOK_SECRET`
- `STRIPE_PRICE_MUSIC_CREATOR`
- `STRIPE_PRICE_MUSIC_STUDIO`
- `APP_ORIGIN` set to `https://n3xra.com`

`STRIPE_WEBHOOK_SECRET` remains for the existing Records webhook. `STRIPE_MUSIC_WEBHOOK_SECRET` should be the signing secret from the AI Music webhook endpoint.

`SONAUTO_API_KEY` stays in Vercel because generation still runs through Vercel API routes.

### Webhook endpoint

Point a new Stripe webhook endpoint to the AI Music Supabase webhook:

```text
https://YOUR-PROJECT-REF.supabase.co/functions/v1/music-stripe-webhook
```

Subscribe the AI Music webhook to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`

### Deploy commands

```bash
supabase functions deploy music-billing
supabase functions deploy music-stripe-webhook
```

### AI Music billing behavior

- Free AI Music accounts get 2 songs per monthly period.
- Creator accounts get 25 songs per billing period.
- Studio accounts get 100 songs per billing period.
- The app uses Stripe Checkout for new paid subscriptions.
- The app uses Stripe Customer Portal for plan changes, cancellation, and payment method updates.
- Stripe webhooks are the source of truth for `music_profiles.plan`, `monthly_song_limit`, subscription status, renewal date, and cancellation state.
- Overages are not enabled yet; the app hard-stops at the current plan limit.
- AI Music stores its Stripe customer on `music_profiles.stripe_customer_id` to avoid changing or risking the existing Records billing customer flow.
- Normal browser users cannot directly edit billing fields, but Supabase service-role functions and admin SQL can update them for setup or support.
