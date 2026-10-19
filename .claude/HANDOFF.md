# Build Sheet — Big Dog Gotta Eat Softball site

Updated 2026-10-18. **Status: LIVE in production. All core features shipped.**
This is the context-restart sheet — read it, then continue from "Resume here".

## Live / repo

- **Production:** https://big-dog-softball.pages.dev  (Cloudflare Pages, $0/yr)
- **Repo:** https://github.com/vankleekkw/big-dog-softball  (public, branch `main`)
- **Local:** `/Users/VanKleek/GitHub/softball-stats`
- **Original plan:** `/Users/VanKleek/.claude/plans/effervescent-gliding-pancake.md`
- **Site-copy plan:** `.claude/plans/site-copy-editor.md` (built, shipped)

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
- **wrangler is CLI-authed**, under Kris's account.

## Deploy / operate (common tasks)

- **Redeploy** (after any code/asset change): `npx wrangler pages deploy public --project-name=big-dog-softball --branch=main`
  (GitHub push-to-deploy is NOT wired; connect in the Pages dashboard if wanted.)
- **Remote DB query/exec:** `npx wrangler d1 execute softball --remote --command "…"` (or `--file=…`).
  Local uses `--local` but the local DB is keyed to the (now real) database_id and is empty;
  re-init with `npm run db:init:local && db:seed:local` if you want local dev again.
- **Current-season games** come from the admin **Sync Now** (QuickScores), NOT the seed.
  Sync preserves `photo_url`/`photo_caption` (it doesn't update those columns).
- **Bump `public/sw.js` CACHE** (currently `bigdog-v10`) on shell/JS changes so clients refresh
  (strategy is network-first for the shell, so this matters less than it used to, but still
  bump it on every deploy that touches `public/js/**` or `public/css/**`).
- **Preview before promoting:** `wrangler pages deploy public --branch=<name>` deploys to
  `<name>.big-dog-softball.pages.dev` without touching production. Used this session for
  `site-copy-preview`, `mobile-tables-preview`, `hof-preview` before merging to `main`.

## Data model / migration

- `scrape/build_seed.py` → `seed/seed.generated.sql` (committed archive). This file is the
  **source of truth for a fresh local re-seed** — keep it in sync with any structural change
  made directly against remote D1 (seasons/leagues/games reshuffling, not just row edits).
  This session required full block regeneration after a multi-step reorg; see gotcha below.
- **Playoffs** parsed from the QuickScores `TournamentBracket` HTML
  (`functions/_lib/quickscores.js parseBracket`). Round names derived from bracket game
  number. Per-league `season_leagues.playoff_result`; `games.is_playoff`; regular record
  excludes playoffs.
- **site_copy table** (new): admin-editable header brand, footer tagline, Home/History/HOF
  blurbs. `GET /api/site-copy` (public map), `GET`/`PATCH /api/admin/site-copy[/:key]`.
  Shared fetch cached via `common.js getSiteCopy()`.
- **Pseudo-seasons**: `Tournaments` (id 10) and `Preseason` (id 15) are multi-event/multi-year
  buckets, not real seasons — each `season_leagues` row under them is one real event/year.
  Identified by `sort_order <= 0` (Tournaments=0, Preseason=-1); both sort below every real
  season on History. `getAllSeasonBattingWithPlayers(db, { realSeasonsOnly: true })` uses this
  same `sort_order > 0` rule to exclude them from single-season leaderboards.
- **Game photos:** `games.photo_url`/`photo_caption` (gallery on season page, playoff games
  only) + `seasons.photo_url` (single team photo, any season). Admin **Site Copy** tab does
  NOT cover these — photos are set via the admin **Games** editor (photo_url/caption fields)
  or `seasons` editor; no file upload yet (needs R2).

## Watch out for

- **`season_batting.season_id` is `ON DELETE CASCADE`.** Deleting a `seasons` row silently
  wipes that player's career batting lines for it. This bit us this session: merging seasons
  deleted the old season rows before checking for season_batting dependents, cascade-wiped 109
  rows, caught and recovered (summed into the survivor seasons, verified against the pre-merge
  seed snapshot). **Before deleting any `seasons` row going forward: check `season_batting`,
  `season_leagues`, and `games` for rows pointing at it first**, reassign/merge them, *then*
  delete.
- **D1 bound-parameter limit (~100).** `getPlayersByIds`'s `IN (...)` pattern breaks once the
  id list crosses ~100 (hit this with 161 players). For whole-table-ish scans, just fetch the
  full table instead of filtering by id list — see `getAllSeasonBattingWithPlayers`.
- **`.gitignore` had `Photos/` unanchored**, which on macOS's case-insensitive filesystem also
  matched `public/assets/photos/` — every site photo (including ones already live) had never
  actually been committed to git. Fixed by anchoring to `/Photos/`. If photos ever seem to
  "disappear" after a clone, check this isn't recurring with a new path.
- Service worker is network-first for the shell (not cache-first), so a stale SW is rarely the
  actual cause of "my change isn't showing" — check the deploy actually went to `main` first.

## Resume here (open / optional — none blocking)

- **Spine flame graphic** — removed (looked bad). Kris to supply a tribal-flame asset → drop
  in `public/assets/` and wire via `body::before/::after` in `styles.css`.
- **R2** — enable in dashboard → `wrangler r2 bucket create big-dog-assets` → uncomment the
  `[[r2_buckets]]` block → redeploy, for admin photo uploads (would upgrade Site Copy /
  player / season photo fields from URL-paste to real upload).
- **GitHub push-to-deploy** — connect the repo in the Pages dashboard (needs Kris to click
  through the GitHub App OAuth consent himself).
- **Player bios/photos** — main-player bio cards still mostly empty; fill via admin
  (`is_main_player` toggle).
- **Tournament/Preseason sub-league names** — 7 of 8 Tournaments entries and 6 of 7 Preseason
  entries got placeholder date-based labels (e.g. "2016 Tournament (Jul)") since Kris didn't
  have the real event names handy. Rename anytime via admin → Seasons & Leagues → select
  Tournaments/Preseason.
- **More QuickScores seasons** — Kris can hand (season → night → LeagueID); add to
  `QS_SEASON_LEAGUES` in `scrape/build_seed.py`.

## Features shipped (for orientation)

Home (hero + record + champion badge + highlight photo + recent/upcoming + Who-We-Are blurb),
History (card list, chronological, Tournaments/Preseason pinned at the bottom), Hall of Fame
(career record book: Hits/2B/3B/HR/OBP/SLG + Single-Season Leaders top-5 + Dubious Honors),
Schedule + Team Stats (season picker incl. Career; mobile-friendly column order), Players
(bio-card players only), player career pages, Season detail (games + photo gallery + per-league
playoff finishes, grouped sub-events for Tournaments/Preseason). Compact top-right dropdown nav.
Mobile-first responsive (History cards, Schedule/Season horizontal-scroll tables reordered for
small screens). PWA installable. Admin: players/rosters/seasons+leagues/games (incl. photo
fields)/game-stats/site-copy + Sync Now + season snapshot.
