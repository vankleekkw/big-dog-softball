# Historical data migration

`build_seed.py` turns live SlowPitchStats (SPS) data into `seed/seed.generated.sql`
(loads into a D1 DB that already has `migrations/0001_init.sql` applied). It reuses
`scrape.py`'s HTTP/parsing helpers but implements its own pipeline.

## The model: per-game box scores are the source of truth

Reconciliation invariant (must hold): **game → season → career, each 100%.**

- `game_player_stats` — per-game per-player box scores (`stats.php?...&gameID=`). The heart.
- `season_batting` — per (season, player), taken from the player's `careerStats.php`
  page, which equals the sum of that player's game boxes for the season.
- career — sum of `season_batting`, equals the SPS team career page.

## The key: `playerUserID`, joined by season stat line

SPS has two player IDs:
- **`playerUserID`** — the canonical, cross-season person key (on the career pages).
- **`playerID`** — season-scoped; the per-game box pages link only this. The same
  person gets a different `playerID` every season.

No public SPS page cross-references the two. So the per-game data (keyed by season
`playerID`) is joined up to the canonical `playerUserID` by matching each season
`playerID`'s **full season-total stat line** to the canonical `careerStats` season
line — a within-season bijection. Entered names are also aliased ("Scott L" on the
box = "Scott Krywko" on the career page), so names are only used to break ties when
two players share an identical stat line.

## One-time setup

```sh
python3 -m venv scrape/.venv
scrape/.venv/bin/pip install requests beautifulsoup4
```

## Build the seed

```sh
scrape/.venv/bin/python3 scrape/build_seed.py            # scrape (resumable) + match + verify + emit
scrape/.venv/bin/python3 scrape/build_seed.py --cache-only   # re-emit from cache, no network (fast)
scrape/.venv/bin/python3 scrape/build_seed.py --verify-only  # reconcile, don't write
scrape/.venv/bin/python3 scrape/build_seed.py --limit-seasons 4   # smoke test on newest N seasons
```

HTTP responses are cached in `scrape/httpcache.db` (gitignored) so re-runs and
re-parsing are cheap and a mid-run failure resumes. Reconciliation prints
`game->season` and `season->career` mismatch counts; a clean run is 0 / 0.

## Known residue (does not affect any total)

- A couple of **tuple collisions** per full run: aliased fringe players (e.g. "Berger B",
  "Dave Flyers") whose season lines are *identical* to another player's. They're
  interchangeable, so season/career totals are unaffected; only which specific game a
  line is attributed to could swap.
- Current season (`sps_season_id` 21416) is **hard-excluded** from batting/games and
  hand-built as the single `is_active=1` season — it accumulates from live admin/sync
  entry going forward.

## Output (current full run)

45 historical seasons · 161 players · 833 games · 8302 game_player_stats · 865 season_batting.
`seed/seed.generated.sql` is committed as the durable archive (SPS is unstable).
No `BEGIN`/`COMMIT` in the file — `wrangler d1 execute --file` rejects explicit SQL
transactions and batches the statements itself.
