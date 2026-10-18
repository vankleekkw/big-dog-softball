# Handoff — Big Dog Gotta Eat Softball website

Updated 2026-10-18. **Status: BUILT + DEPLOYED + LIVE.**

## Live

- **Production:** https://big-dog-softball.pages.dev (Cloudflare Pages, $0/yr).
- **Repo:** https://github.com/vankleekkw/big-dog-softball (public, `main`).
- **Admin:** https://big-dog-softball.pages.dev/admin — gated by Cloudflare Access
  (team `bigdogsoftball.cloudflareaccess.com`, app "Big Dog Admin", email allowlist +
  one-time code). Add/remove admins by editing the Access policy emails.

## Stack

Cloudflare Pages (static `public/`) + Pages Functions (`functions/api/*`) + D1
(`softball`, id `3aa14288-4c12-4734-a51e-ffd006f8e600`). No build step. Admin auth =
Cloudflare Access verified by `functions/api/admin/_middleware.js` against
`ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` (set in `wrangler.toml [vars]`); fails closed.

## Deploy / operate

- **Redeploy:** `npx wrangler pages deploy public --project-name=big-dog-softball --branch=main`
  (wrangler is CLI-authed under Kris's Cloudflare account). GitHub push-to-deploy is
  NOT wired yet — connect the repo in the Pages dashboard if wanted.
- **DB:** schema `migrations/0001_init.sql`; seed `seed/seed.generated.sql` (committed,
  durable archive). Remote load: `npm run db:init:remote && npm run db:seed:remote`.
- **Current-season games** are NOT in the seed — they come from the admin "Sync Now"
  (QuickScores). On first deploy they were pre-loaded once via a one-off
  `wrangler d1 execute --remote`. Going forward, Sync Now keeps them fresh.

## Data model / migration (the hard-won part)

- `scrape/build_seed.py` builds the seed from SlowPitchStats (SPS) **per-game box
  scores** keyed to the canonical **playerUserID**; `season_batting` + career are
  derived so **game → season → career reconcile 100%** (0/0). Name aliasing resolved
  by season-total stat-line matching. Run: `scrape/.venv/bin/python3 scrape/build_seed.py`
  (resumable via `scrape/httpcache.db`; `--cache-only` to re-emit without network).
- **Playoffs** parsed from the QuickScores `TournamentBracket` HTML (JS:
  `functions/_lib/quickscores.js parseBracket`; Python mirror in build_seed). Per-league
  (`season_leagues.playoff_result`), games flagged `games.is_playoff`. Regular record
  excludes playoffs.
- QuickScores wired for recent AHeights seasons (2025 Summer/Fall, 2026 Summer + current
  2026 Fall). Older seasons (BG/Wheeling/etc.) predate ahpd on QuickScores. The JSON API
  exists but needs an org API token (not obtainable) — so we scrape the server-rendered
  HTML (robust enough; the `<li class="event Highlight">` split bug is fixed).

## Open / optional

- **R2 not enabled** on the account → admin photo-upload binding is commented out in
  `wrangler.toml`. To enable: Dashboard → R2 → activate, `wrangler r2 bucket create
  big-dog-assets`, uncomment the `[[r2_buckets]]` block, redeploy.
- **Spine flame graphic** removed (looked bad); Kris to supply a tribal-flame asset →
  drop at `public/assets/` and wire via `body::before/::after`.
- Bios/photos for the 31 auto-flagged main players (career AB ≥ 100) are empty — fill
  via admin going forward. Player "bio card" = `is_main_player` (admin toggle).
- GitHub push-to-deploy + custom domain are future niceties.

## Plan of record

`/Users/VanKleek/.claude/plans/effervescent-gliding-pancake.md` (original architecture).
