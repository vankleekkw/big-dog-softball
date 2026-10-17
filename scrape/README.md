# Historical data migration

`build_seed.py` turns live SlowPitchStats (SPS) data into `seed/seed.generated.sql`
— a SQL file that loads into a fresh D1 database that already has
`migrations/0001_init.sql` applied. It reuses `scrape.py`'s HTTP/HTML-parsing
logic (imported as a module) rather than duplicating it.

## One-time setup

```sh
python3 -m venv scrape/.venv
scrape/.venv/bin/pip install requests beautifulsoup4
```

## Regenerating the seed

```sh
scrape/.venv/bin/python3 scrape/build_seed.py
```

This will:

1. Read the season list straight off SPS's `teamStats.php` nav (both the
   labels and the true reverse-chronological order come from there — see
   "Why not `scrape.py`'s own label parser" below).
2. Scrape every season's per-player batting into `scrape/softball.db`
   (gitignored, OLD schema — same shape `scrape.py` uses standalone).
3. Reconcile the scrape against the SPS career totals page (`--verify`
   equivalent) and print a mismatch report.
4. Emit `seed/seed.generated.sql` (gitignored, regenerate as needed) with
   `players`, `seasons`, `season_leagues`, and `season_batting` INSERTs
   mapped to the NEW D1 schema, wrapped in `BEGIN;` / `COMMIT;`.

Useful flags:

| Flag | Effect |
|---|---|
| `--skip-scrape` | Reuse the existing `scrape/softball.db`, just re-emit the seed (fast iteration on the SQL-emission logic). |
| `--verify-only` | Scrape + verify, don't write the seed. |
| `--no-verify` | Skip the career-page reconciliation fetch. |
| `--limit N` | Smoke-test: only scrape the first N historical seasons. Refuses to write a (partial) seed when set. |
| `--db PATH` / `--out PATH` | Override the default `scrape/softball.db` / `seed/seed.generated.sql` paths. |

## Validating a generated seed

The local D1 used by `wrangler pages dev` already has real data in it, so
don't load the seed there to test it. Instead, load it into a throwaway
plain-sqlite db:

```sh
rm -f /tmp/seedtest.db
sqlite3 /tmp/seedtest.db < migrations/0001_init.sql
sqlite3 /tmp/seedtest.db < seed/seed.generated.sql && echo OK

sqlite3 /tmp/seedtest.db "SELECT COUNT(*) FROM players;"
sqlite3 /tmp/seedtest.db "SELECT name, is_active, sps_season_id FROM seasons WHERE is_active=1;"
sqlite3 /tmp/seedtest.db "SELECT COUNT(*) FROM season_batting sb JOIN seasons s ON s.id=sb.season_id WHERE s.sps_season_id=21416;" # must be 0
```

## Design notes / known SPS quirks

**Current season is hard-excluded.** SPS seasonID `21416` ("2026 Fall
AHeights") is the in-progress current season. It is never scraped into
`softball.db` and never appears in `season_batting` in the seed — the seed
instead gets a hand-built `is_active = 1` season row ("Fall 2026 Arlington
Heights") with `season_leagues` wired to the Wednesday/Friday QuickScores
league IDs, and deliberately no `season_batting`/`season_rosters` (those
accumulate from live game entry going forward). `build_seed.py` does
scrape season 21416 into a throwaway **in-memory** db — never written to
disk — purely so `--verify`'s reconciliation math can show that the
historical scrape plus the current season together account for everything
on the career totals page.

**`scrape.py`'s own season-label parser is buggy and is bypassed here.**
`parse_season_label()`'s regex matches a stray nav-menu fragment ("2009
Summer Libertyville 2008 Season Player") on every single season page,
regardless of which season it actually is. It goes unnoticed by `scrape.py
--verify` because that only checks AB/H sums, never labels. `build_seed.py`
instead reads the season list directly off `teamStats.php`'s nav anchors,
which gives both the correct label text *and* the true reverse-chronological
order as SPS itself displays it (including un-placeable-by-regex oddities
like an undated "Tournaments" entry) — used directly to compute `sort_order`.

**`scrape.py`'s player-name scraping leaves a stray `**` suffix attached**
for players SPS flags as under the minimum-plate-appearance threshold (e.g.
`"AJ Kidd**"` instead of `"AJ Kidd"`). That name never matches the
un-flagged version on the career totals page, so every reconciliation join
for a flagged player silently returned 0 before this was caught. Patched in
`build_seed.py` via a monkeypatch of `scrape.get_player_id` (not edited in
`scrape.py` itself, since that's the separately-maintained reference
scraper) — strips a trailing `\*+\s*$` before the name is stored.

**17 of 161 players don't fully reconcile, and that's expected.** Those
players' SPS *career* totals include some stats that do not appear on any
of the 46 known season pages — verified by an exhaustive whitespace-
collapsed substring search across every season ID in the nav. This affects
~3% of total career at-bats and does not flip any player across the
`is_main_player` (career AB ≥ 100) threshold. It looks like a legacy/orphaned
adjustment on SPS's own aggregate, not a scraper bug — there's no season-level
source to recover those extra at-bats from.

**`is_main_player`** is seeded `1` for any player whose summed historical
`season_batting.ab` ≥ 100, else `0`. It's a one-time migration seed, not a
permanent rule — editable afterward in admin.
