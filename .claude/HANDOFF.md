# Build Sheet — Big Dog Gotta Eat Softball site

Updated 2026-10-18. **Status: LIVE in production. All core features shipped.**
This is the context-restart sheet — read it, then continue from "Resume here".

## Live / repo

- **Production:** https://big-dog-softball.pages.dev  (Cloudflare Pages, $0/yr)
- **Repo:** https://github.com/vankleekkw/big-dog-softball  (public, branch `main`)
- **Local:** `/Users/VanKleek/GitHub/softball-stats`
- **Original plan:** `/Users/VanKleek/.claude/plans/effervescent-gliding-pancake.md`

## Cloudflare resources (under Kris's account)

- **D1:** database `softball`, id `3aa14288-4c12-4734-a51e-ffd006f8e600` (in `wrangler.toml`). Fully loaded.
- **Pages project:** `big-dog-softball` (production branch `main`).
- **Access (admin auth):** team `bigdogsoftball.cloudflareaccess.com`, app "Big Dog Admin"
  protects `/admin*` + `/api/admin*`, policy "Allowed Admins" (email allowlist + OTP).
  `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` set in `wrangler.toml [vars]`. Admin fails closed.
  Add/remove admins = edit the policy emails. (GitHub-login works only if that account's
  email is in the policy + GitHub added as an IdP.)
- **R2:** NOT enabled (account activation needed). `[[r2_buckets]]` is commented out in
  `wrangler.toml`; admin photo-upload is off until enabled.
- **wrangler is CLI-authed** (`wrangler login` done this session, under Kris's account).

## Direct-connection toolkit (NEW — activates after restart)

The Cloudflare plugin marketplace + MCP are installed (`cloudflare/skills`,
`cloudflare@cloudflare`, user scope). After `/reload-plugins` or a restart they load,
giving direct Cloudflare MCP tools (manage Pages/D1/Access via MCP instead of the
`wrangler` CLI). First use will likely prompt for Cloudflare auth (OAuth/token).

## Deploy / operate (common tasks)

- **Redeploy** (after any code/asset change): `npx wrangler pages deploy public --project-name=big-dog-softball --branch=main`
  (GitHub push-to-deploy is NOT wired; connect in the Pages dashboard if wanted.)
- **Remote DB query/exec:** `npx wrangler d1 execute softball --remote --command "…"` (or `--file=…`).
  Local uses `--local` but the local DB is keyed to the (now real) database_id and is empty;
  re-init with `npm run db:init:local && db:seed:local` if you want local dev again.
- **Current-season games** come from the admin **Sync Now** (QuickScores), NOT the seed.
  They were pre-loaded once on remote via a one-off `wrangler d1 execute --remote`.
  Sync preserves `photo_url`/`photo_caption` (it doesn't update those columns).
- **Bump `public/sw.js` CACHE** (currently `bigdog-v6`) on shell changes so clients refresh.

## Data model / migration

- `scrape/build_seed.py` → `seed/seed.generated.sql` (committed archive) from SlowPitchStats
  **per-game box scores** keyed to canonical **playerUserID**; `season_batting`+career are
  derived so **game→season→career reconcile 100%** (0/0). Name aliasing solved by
  season-total stat-line matching. Resumable via `scrape/httpcache.db`; `--cache-only`
  re-emits without network. Run: `scrape/.venv/bin/python3 scrape/build_seed.py`.
- **Playoffs** parsed from the QuickScores `TournamentBracket` HTML
  (`functions/_lib/quickscores.js parseBracket`; Python mirror `qs_league_info`). Round
  names (Quarterfinal/Semifinal/Championship) derived from bracket game number. Per-league
  `season_leagues.playoff_result`; `games.is_playoff`; regular record excludes playoffs.
- **QuickScores wired** for recent AHeights seasons: 2025 Summer/Fall, 2026 Summer, and the
  current 2026 Fall (Wed `1740394`/Fri `1740619`). Config: `QS_SEASON_LEAGUES` in build_seed.
  Older seasons predate ahpd on QuickScores. (Tuesday Rec 2 `1491516` dropped — no mappable
  data.) The QS JSON API needs an org token (not obtainable) → we scrape server-rendered HTML.
- **Game photos:** `games.photo_url` + `games.photo_caption` (added to schema + ALTERed on
  remote). 2026 Fall Wednesday QF (vs Beavers) + Championship (vs Buck Boyz) photos set on
  remote; files in `public/assets/photos/`. Rendered as a gallery on the season page's
  playoff section. No admin UI for game photos yet (set via SQL).

## Resume here (open / optional — none blocking)

- **Admin game-photo field** — add photo_url/caption to the admin Games editor so Kris can
  manage highlight photos himself (currently SQL-only).
- **Spine flame graphic** — removed (looked bad). Kris to supply a tribal-flame asset → drop
  in `public/assets/` and wire via `body::before/::after` in `styles.css`.
- **R2** — enable in dashboard → `wrangler r2 bucket create big-dog-assets` → uncomment the
  `[[r2_buckets]]` block → redeploy, for admin photo uploads.
- **GitHub push-to-deploy** — connect the repo in the Pages dashboard (optional).
- **Player bios/photos** — 31 auto-flagged main players (career AB ≥ 100) have empty bios;
  fill via admin. "Bio card" = `is_main_player` (admin toggle).
- **More QuickScores seasons** — Kris can hand (season → night → LeagueID); add to
  `QS_SEASON_LEAGUES`, regenerate seed. Older seasons' playoffs otherwise unavailable.

## Features shipped (for orientation)

Home (hero + record + champion badge + recent/upcoming), History (all seasons incl. current),
Hall of Fame (career record book w/ ≥50%-AB qualifier), Schedule + Team Stats (season picker
incl. Career; regular+playoff split per league, QS-linked league names), Players (bio-card
players only), player career pages, Season detail (games + photo gallery + per-league playoff
finishes). Compact top-right dropdown nav (site + admin). Mobile vertical layout. PWA
installable. Admin: players/rosters/seasons+leagues/games/game-stats + Sync Now + season snapshot.
