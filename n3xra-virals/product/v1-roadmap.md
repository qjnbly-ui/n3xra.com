# N3XRA Virals V1 Roadmap

## V1 Goal

Ship one strong workflow:

```txt
Paste URL -> Analyze Content
```

The workflow should function before accounts, subscriptions, trend databases, or advanced tracking systems are added inside Virals.

## V1 User Flow

1. User opens Virals from the N3XRA product dashboard.
2. User pastes a video URL.
3. API verifies the Master session and product access.
4. API creates an analysis job in the Virals Supabase project.
5. System retrieves content metadata and transcript when available.
6. AI analyzes content structure and messaging.
7. Results are saved to Virals Supabase.
8. UI displays analysis, improved hooks, captions, CTAs, and script variations.

## V1 Build Order

1. Create Virals Supabase schema.
2. Add Virals product entry in the Master dashboard.
3. Build static analyzer page.
4. Add `analyze` API endpoint.
5. Wire endpoint to Virals Supabase.
6. Add AI analysis output schema.
7. Render saved analysis results in the UI.

## Deferred

- trend discovery database
- scheduled trend ingestion
- competitor monitoring
- product research dashboards
- creator tracking dashboards
- subscriptions inside Virals

