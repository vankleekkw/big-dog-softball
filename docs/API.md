# API contract — Big Dog Gotta Eat

Pages Functions under `functions/`. File-based routing: `functions/api/foo.js` → `/api/foo`.
All responses JSON. Errors: `{ "error": "message" }` with an appropriate HTTP status.

## Derived stats (shared rule — do NOT store these)

Given raw counts, compute at display time:
- `tb` (total bases) = `b1 + 2*b2 + 3*b3 + 4*hr`  (if b1/b2/b3 absent but H present, fall back: singles = h - b2 - b3 - hr)
- `avg` = `h / ab`
- `slg` = `tb / ab`
- `obp` = `(h + bb + sac) / (ab + bb + sac)`   ← matches slowpitchstats.com's OB formula
- `ops` = `obp + slg`
- Guard divide-by-zero → return `0` (or `null`) when denominator is 0.
- Format rates to 3 decimals, leading-zero stripped (".572"), in the UI layer.

A shared helper lives at `public/js/stats.js` (frontend) and `functions/_lib/stats.js` (server);
keep both in sync — same formulas.

## Per-season batting resolution rule

For a given season, "the batting rows" are:
- **If `season_batting` has rows for that season** (historical, migrated) → use them.
- **Else** → aggregate `game_player_stats` for that season (join games → season_leagues → season),
  grouped by player. This is how the active/current season accumulates from live game entry.

The API encapsulates this so callers never special-case it.

---

## Public (read-only, no auth)

### GET /api/overview
Home-page payload for the active season.
```json
{
  "season": { "id": 47, "name": "Fall 2026 Arlington Heights", "is_active": 1 },
  "record": { "wins": 7, "losses": 3, "ties": 0 },
  "nextGame": { "date": "2026-10-22", "time": "7:00 PM", "field": "Melas Park 3",
                "opponent": "Chunichi Dragons", "league_label": "Wednesday" },
  "lastGame": { "date": "2026-10-15", "opponent": "...", "our_score": 19,
                "opp_score": 5, "result": "W" },
  "career": { "wins": 463, "losses": 346, "ties": 1 }
}
```
`nextGame`/`lastGame` may be `null`. `record` is the active season's live W/L/T from games
(status='final'); `career` sums all seasons' stored final_* plus active live record.

### GET /api/seasons
History table. Completed seasons, most recent first.
```json
[{ "id": 46, "name": "Spring 2026 Arlington Heights", "sort_order": 46,
   "final_wins": 9, "final_losses": 4, "final_ties": 0,
   "playoff_result": "Lost Top 5 Semifinal" }]
```

### GET /api/schedule?season=active|<id>
Both leagues combined, ordered by date. Defaults to active season.
```json
{ "season": { "id": 47, "name": "..." },
  "games": [{ "id": 1, "league_label": "Wednesday", "date": "2026-09-03",
              "time": "7:00 PM", "field": "Melas Park 3", "opponent": "...",
              "our_score": 12, "opp_score": 7, "status": "final", "result": "W" }] }
```
`result` derived: our>opp "W", <"L", == "T"; `null` if not final.

### GET /api/stats?season=active|<id>
Team totals + per-player season batting (raw + derived) + leaders.
```json
{ "season": { "id": 47, "name": "..." },
  "team": { "gp": 10, "ab": 300, "r": 150, "h": 170, "hr": 40, ... ,
            "avg": 0.566, "slg": 0.9, "obp": 0.6, "ops": 1.5 },
  "players": [{ "player_id": 3, "name": "...", "gp": 10, "ab": 35, "h": 20,
                "hr": 5, ..., "avg": 0.571, "slg": 1.1, "obp": 0.6, "ops": 1.7 }],
  "leaders": { "avg": {"player_id":3,"name":"...","value":0.571},
               "hr": {...}, "rbi": {...}, "h": {...} } }
```
Leaders computed over players with a minimum AB (use 10) to avoid tiny-sample noise.

### GET /api/players
Roster. `active` = has a season_rosters row in the active season.
```json
[{ "id": 3, "name": "...", "number": "24", "position": "SS",
   "photo_url": "https://.../p3.jpg", "is_main_player": 1, "active": true }]
```

### GET /api/players/:id
Player detail (Baseball-Reference style).
```json
{ "player": { "id": 3, "name": "...", "number": "24", "position": "SS",
              "bio_text": "...", "photo_url": "...", "is_main_player": 1 },
  "seasons": [{ "season_id": 46, "season_name": "Spring 2026 Arlington Heights",
                "gp": 10, "ab": 35, "h": 20, ..., "avg": .571, "slg": 1.1,
                "obp": .6, "ops": 1.7 }],
  "career": { "gp": 400, "ab": 1200, "h": 700, ..., "avg": .583, ... } }
```
`seasons` ordered chronologically; uses the per-season resolution rule above.

---

## Admin (write) — ALL under /api/admin/*, gated by functions/api/admin/_middleware.js

Auth: Cloudflare Access. Middleware verifies the `Cf-Access-Jwt-Assertion` header against
`ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` (JWKS). **Fails closed** if those vars are unset in
production. Local dev: set `ADMIN_DEV_BYPASS=1` in `.dev.vars` to skip verification.

- `GET  /api/admin/players`                  list (incl. inactive) for management
- `POST /api/admin/players`                  create `{name, number?, position?, bio_text?, photo_url?, is_main_player?}`
- `PATCH /api/admin/players/:id`             partial update (any of the above fields)
- `DELETE /api/admin/players/:id`
- `POST /api/admin/players/:id/photo`        multipart upload → R2 (ASSETS_BUCKET), sets photo_url
- `POST /api/admin/rosters`                  `{season_id, player_id}` add to roster
- `DELETE /api/admin/rosters`                `{season_id, player_id}` remove
- `GET/POST/PATCH/DELETE /api/admin/seasons` CRUD; PATCH `{is_active:true}` activates (clears others atomically)
- `GET/POST/PATCH/DELETE /api/admin/leagues` season_leagues CRUD
- `GET/POST/PATCH/DELETE /api/admin/games`   games CRUD
- `POST /api/admin/game-stats`               upsert `{game_id, player_id, ...rawcounts}`
- `POST /api/admin/sync`                      `{season_id}` → fetch each season_league's quickscores
                                              page, parse, upsert games by (date+opponent). Returns
                                              `{inserted, updated, errors:[...]}`. Surface parse
                                              failures loudly, never silent.
- `POST /api/admin/seasons/:id/snapshot`      scrape quickscores for final record + playoff result,
                                              return a PREFILL `{final_wins, final_losses, final_ties,
                                              playoff_result}` for the admin to confirm/edit — does NOT
                                              auto-save. Admin saves via PATCH /api/admin/seasons/:id.
                                              Must degrade gracefully if the scrape fails (return
                                              best-effort + an error note, never silently overwrite).
