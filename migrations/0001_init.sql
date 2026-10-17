-- Big Dog Gotta Eat — D1 schema (0001_init)
--
-- Design notes (see /Users/VanKleek/.claude/plans/effervescent-gliding-pancake.md):
--   * Only RAW counting stats are stored. Rates (AVG/SLG/OB/OPS) are derived in
--     the API layer, never stored. Column names match scrape.py (b1/b2/b3 because
--     SQL identifiers can't start with a digit).
--   * A "season" is a logical rollup that can aggregate MULTIPLE league feeds
--     (Wednesday + Friday) via season_leagues.
--   * A player's "active" status is DERIVED from season_rosters membership in the
--     currently-active season — there is no active flag on players.
--   * Exactly one season is active at a time (enforced by a partial unique index).
--   * season_batting holds the migrated historical asset. For the active/current
--     season, per-season batting is instead computed by the API from
--     game_player_stats; don't scrape current-season batting into season_batting.

PRAGMA foreign_keys = ON;

CREATE TABLE players (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  number         TEXT,
  position       TEXT,
  bio_text       TEXT,
  photo_url      TEXT,
  -- Bio-page flag. Auto-seeded during migration at career AB >= 100, then a
  -- manually-editable toggle in admin. NOT a permanent hardcoded threshold.
  is_main_player INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE seasons (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,           -- "Fall 2026 Arlington Heights"
  start_date     TEXT,                    -- ISO yyyy-mm-dd
  end_date       TEXT,
  -- Season-close snapshot: captured once, stored permanently, never re-fetched
  -- live on page view (survives the league clearing old data).
  final_wins     INTEGER,
  final_losses   INTEGER,
  final_ties     INTEGER,
  playoff_result TEXT,                    -- free text, e.g. "Lost Top 5 Semifinal"
  is_active      INTEGER NOT NULL DEFAULT 0,
  -- Chronological ordering for the history table. Higher = more recent.
  sort_order     INTEGER NOT NULL DEFAULT 0,
  -- Preserve the SPS season id we migrated from, for traceability / re-sync.
  sps_season_id  INTEGER UNIQUE
);

-- At most one active season at a time.
CREATE UNIQUE INDEX idx_seasons_one_active ON seasons(is_active) WHERE is_active = 1;

CREATE TABLE season_leagues (
  id                  INTEGER PRIMARY KEY,
  season_id           INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  league_label        TEXT NOT NULL,      -- "Wednesday" / "Friday"
  quickscores_org_dir TEXT,
  quickscores_league_id TEXT,
  quickscores_team_id TEXT
);
CREATE INDEX idx_season_leagues_season ON season_leagues(season_id);

CREATE TABLE season_rosters (
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (season_id, player_id)
);
CREATE INDEX idx_season_rosters_player ON season_rosters(player_id);

CREATE TABLE games (
  id               INTEGER PRIMARY KEY,
  season_league_id INTEGER NOT NULL REFERENCES season_leagues(id) ON DELETE CASCADE,
  date             TEXT,                  -- ISO yyyy-mm-dd
  time             TEXT,
  field            TEXT,
  opponent         TEXT,
  our_score        INTEGER,
  opp_score        INTEGER,
  status           TEXT DEFAULT 'scheduled'  -- 'scheduled' | 'final'
);
CREATE INDEX idx_games_season_league ON games(season_league_id);

-- Per-game per-player raw counts. Always manual admin entry (no public source).
-- Starts empty for all historical seasons; fills going forward.
CREATE TABLE game_player_stats (
  id        INTEGER PRIMARY KEY,
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  gp  INTEGER NOT NULL DEFAULT 0,
  ab  INTEGER NOT NULL DEFAULT 0,
  r   INTEGER NOT NULL DEFAULT 0,
  h   INTEGER NOT NULL DEFAULT 0,
  b1  INTEGER NOT NULL DEFAULT 0,
  b2  INTEGER NOT NULL DEFAULT 0,
  b3  INTEGER NOT NULL DEFAULT 0,
  hr  INTEGER NOT NULL DEFAULT 0,
  bb  INTEGER NOT NULL DEFAULT 0,
  rbi INTEGER NOT NULL DEFAULT 0,
  so  INTEGER NOT NULL DEFAULT 0,
  sac INTEGER NOT NULL DEFAULT 0,
  sb  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, player_id)
);
CREATE INDEX idx_gps_player ON game_player_stats(player_id);

-- Per-player per-season aggregate. The migrated historical asset.
CREATE TABLE season_batting (
  id        INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  gp  INTEGER NOT NULL DEFAULT 0,
  ab  INTEGER NOT NULL DEFAULT 0,
  r   INTEGER NOT NULL DEFAULT 0,
  h   INTEGER NOT NULL DEFAULT 0,
  b1  INTEGER NOT NULL DEFAULT 0,
  b2  INTEGER NOT NULL DEFAULT 0,
  b3  INTEGER NOT NULL DEFAULT 0,
  hr  INTEGER NOT NULL DEFAULT 0,
  bb  INTEGER NOT NULL DEFAULT 0,
  rbi INTEGER NOT NULL DEFAULT 0,
  so  INTEGER NOT NULL DEFAULT 0,
  sac INTEGER NOT NULL DEFAULT 0,
  sb  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(season_id, player_id)
);
CREATE INDEX idx_season_batting_player ON season_batting(player_id);
