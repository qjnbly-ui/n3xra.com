# N3XRA Virals TikTok Data Strategy

## Decision

Build N3XRA Virals as a TikTok Shop intelligence product first, not a general TikTok scraper.

The fastest competitive path is:

```txt
TikTok Shop data provider API
  -> N3XRA Virals import jobs
  -> Virals Supabase snapshots
  -> velocity/opportunity scoring
  -> AI hooks/scripts/captions
```

## Why

Daily Virals, FastMoss, Kalodata, Shoplus, and similar tools are valuable because they identify products and videos moving right now. The core product is not only a list of popular products. The core product is velocity:

```txt
product/video/shop/creator metric at time A
product/video/shop/creator metric at time B
delta = opportunity signal
```

Examples:

```txt
sold_count yesterday: 10,000
sold_count today: 10,500
units moved: 500
estimated revenue: 500 * current price
```

```txt
video views yesterday: 4,000
video views today: 80,000
views gained: 76,000
early viral signal
```

## Data Sources To Evaluate

### 1. Official TikTok Shop Affiliate APIs

Use if we can get approved.

Capabilities publicly described by TikTok include:

- search creators by GMV, keywords, and demographics
- find open-collaboration products by category, commission rate, and keywords
- generate affiliate product promotion links
- retrieve affiliate orders for conversion tracking

Pros:

- cleanest legal/commercial path
- good for affiliate/product workflow
- stronger long-term foundation

Cons:

- approval required
- may not expose enough competitor/trend data
- not the fastest path for broad market intelligence

### 2. ScrapeCreators

Useful for fast prototype and TikTok/TikTok Shop endpoints.

Public docs/blog describe:

- TikTok Shop product search
- product details
- shop metadata
- stock/sold count signals
- TikToks promoting a product
- creator video product detection through fields like `shop_product_url`

Pros:

- straightforward API
- good for URL analyzer and product lookup
- no infrastructure burden

Cons:

- third-party dependency
- endpoint behavior can change if TikTok changes
- costs scale with request volume

### 2a. First-Party TikTok Subtitle Extraction

For some TikTok video pages, TikTok embeds `subtitleInfos` inside `__UNIVERSAL_DATA_FOR_REHYDRATION__`. Those entries can point to a WEBVTT subtitle file. This means we can sometimes retrieve transcript text without downloading video/audio and without paying a provider.

Pros:

- no video download
- no extra transcript API cost
- returns timed WEBVTT text when captions exist
- also exposes useful metadata such as caption, creator, stats, hashtags, sticker text, and subtitle source

Cons:

- brittle because TikTok page structure can change
- not every video has subtitles
- TikTok can block server requests or require anti-bot handling
- should be treated as a best-effort path, not the only transcript strategy

Recommended order:

```txt
1. Try first-party TikTok subtitle extraction
2. If no transcript, use ScrapeCreators transcript API
3. If still no transcript, ask user for notes/transcript or use optional AI/audio fallback later
```

### 3. Apify Actors

Good for testing multiple TikTok Shop datasets quickly.

Relevant actor categories include:

- TikTok Shop affiliate products
- TikTok Shop product scrapers
- TikTok video/profile/hashtag scrapers
- affiliate intelligence and creator finder actors

Pros:

- fast to test
- many competing actors
- can schedule runs
- easy export/API access

Cons:

- actor quality varies
- some actors have low usage/reviews
- costs and reliability vary by actor
- lock-in to actor input/output shapes

### 4. EchoTik API

Evaluate as a more specialized TikTok ecommerce data source.

Public site claims:

- real-time and historical TikTok ecommerce data
- product/shop/creator/brand/retailer use cases
- API key access after signup
- 100 test API calls

Pros:

- closer to a real data product than raw scraping
- useful if API coverage is good
- may include historical data that we cannot build immediately

Cons:

- pricing/limits need confirmation
- coverage and freshness need hands-on testing

### 5. Bright Data

Use if we need more enterprise-grade scraping/data reliability.

Public docs describe TikTok scraper APIs and TikTok Shop datasets.

Pros:

- established data provider
- pay-per-success scraper options
- ready-made datasets available

Cons:

- may be overkill for MVP
- likely more expensive than lightweight providers
- less product-specific intelligence unless we build it

## MVP Product To Build

Build a TikTok Shop product discovery dashboard with AI content generation.

### Core Screens

```txt
/virals
  Trending TikTok Shop products
  filters: category, price, commission, sold count, velocity

/virals/products/:id
  product details
  sales snapshots
  estimated daily units/revenue
  creator videos promoting the product
  AI content opportunities

/virals/analyze
  paste TikTok URL
  extract video/product data if available
  generate hooks, captions, CTAs, scripts

/virals/scripts
  saved generated scripts
```

### First Data Model

```txt
products
product_snapshots
videos
video_snapshots
creators
creator_snapshots
product_video_links
analysis_runs
generated_scripts
```

### Scoring

Start with simple explainable scoring:

```txt
product_velocity_score =
  sold_count_delta_24h
  + revenue_delta_24h
  + video_count_delta
  + engagement_delta
  - saturation_penalty
```

```txt
content_opportunity_score =
  video_view_velocity
  + engagement_rate
  + product_commission_score
  + product_sales_velocity
  - age_penalty
```

## Build Order

1. Pick one data provider and test 20-50 product queries.
2. Normalize returned product/video/creator data into Virals Supabase.
3. Add snapshot tables and a daily import job.
4. Build product list and product detail pages.
5. Add AI generation for hooks/scripts/captions from product + winning videos.
6. Add saved scripts.
7. Add Master login/product access gating.

## Recommendation

Start with ScrapeCreators or Apify for MVP speed.

Do not build a custom TikTok scraper first. Use providers to prove the product, then replace or supplement the provider later if cost or reliability becomes a problem.

The first N3XRA Virals differentiator should be:

```txt
Daily Virals-style product/video discovery
+ better AI explanation
+ better script generation
+ saved creator workflow
```
