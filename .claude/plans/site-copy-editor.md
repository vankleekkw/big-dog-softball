# Admin-editable site copy

Scope confirmed with Kris: 7 fields, not a generic CMS for every string on the
site. 5 are pre-flagged `edit-note` placeholders already left in the code by
the original build; 2 are the site-wide brand/tagline Kris asked to add.

## Fields

| key | shown on | current text |
|---|---|---|
| `header_brand` | nav brand + footer | "Big Dog Gotta Eat" |
| `footer_tagline` | footer | "Chicagoland 12″ softball" |
| `home_blurb` | Home — "Who We Are" card | team bio blurb |
| `history_intro` | History — intro paragraph | origin-story blurb |
| `hof_longest_tenure` | Hall of Fame — Dubious Honors | placeholder note |
| `hof_most_nachos` | Hall of Fame — Dubious Honors | placeholder note |
| `hof_best_excuse` | Hall of Fame — Dubious Honors | placeholder note |

Out of scope: nav labels, hero stat labels ("Next Up", "This Season"), player
bio / season recap (already admin-editable via their own tables).

## Data model

New table in `migrations/0001_init.sql` (this repo's convention is to keep
that file as the current-schema source of truth, then apply the delta live
via a one-off `wrangler d1 execute --remote`):

```sql
CREATE TABLE site_copy (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value TEXT NOT NULL
);
```

Seeded with the 7 rows above, value = the exact text currently on the live
site (including the placeholder notes for the 3 HOF slots), so deploying the
migration changes nothing visually until Kris edits a field.

## API

- `functions/api/site-copy.js` — public `GET`, returns `{ key: value }` map.
- `functions/api/admin/site-copy.js` — admin `GET`, full rows (key/label/value).
- `functions/api/admin/site-copy/[key].js` — admin `PATCH { value }`, upserts one row.

## Frontend

- `common.js`: add a module-level `getSiteCopy()` (fetches `/api/site-copy`
  once, cached) so `mountChrome` and page scripts share one request per page
  load. Header/footer render with the current hardcoded strings as fallback
  immediately (no flash-of-blank, degrades gracefully if the API errors),
  then patch in the fetched values once resolved.
- `index.js`, `history.js`, `hof.js`: pull their blurb(s) from the same
  helper, replace the hardcoded `<p>` text, delete the `edit-note` lines
  (their job — marking what needed wiring — is done).

## Admin UI

New "Site Copy" tab in `public/admin/index.html` (same tab pattern as
Players/Seasons/Games): one labeled textarea per field, individual Save
buttons PATCHing `/api/admin/site-copy/:key`.

## Verification

- `node --check` on all new/modified JS.
- Deploy to a preview URL (`wrangler pages deploy` without `--branch=main`
  first, or just check the per-deploy preview link it always prints) and
  `curl` `/api/site-copy` + the rendered pages to confirm values flow through
  before touching production.
- No browser extension connected this session, so the live visual check on
  Home/History/Hall of Fame/admin needs Kris to eyeball the preview URL
  before I promote to `main` — per the standing gate, I won't call this done
  without that confirmation.

## Out of scope

- No rich text / markdown — plain text in a single `<p>`, same as `bio_text`
  and `recap` today.
- No per-field history/undo.
