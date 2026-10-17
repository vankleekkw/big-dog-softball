#!/usr/bin/env python3
"""
Scrape Big Dog Gotta Eat softball history into a local SQLite database.

Two public, no-login sources:
  * SlowPitchStats (teamID 51700) -- per-player SEASON batting aggregates,
    per-game TEAM hitting totals, and the season list.
  * QuickScores (OrgDir=ahpd)     -- per-game date/opponent/score/location/result.

What is and isn't recoverable (see the plan doc):
  * season_batting  -- fully recoverable from SPS, all 46 seasons. This is the asset.
  * games           -- opponent + runs_for from SPS; date/location/runs_against/result
                       come from QuickScores, which we only have league IDs for going
                       forward. Historical games therefore land with partial fields.
  * batting (per-player-per-game) -- NOT exposed publicly anywhere; stays empty,
                       to be filled by the new site's admin entry going forward.

Usage:
  python scrape.py            # full scrape -> softball.db
  python scrape.py --verify   # scrape, then reconcile season sums vs SPS career page
  python scrape.py --limit 2  # scrape only the first 2 seasons (quick smoke test)

Requires: requests, beautifulsoup4   (pip install requests beautifulsoup4)
"""

import argparse
import re
import sqlite3
import sys
import time
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup

# --- Config ------------------------------------------------------------------

TEAM_ID = 51700
SPS_BASE = "https://slowpitchstats.com/php/softball"
DB_PATH = "softball.db"

# Polite scraping: this site is unstable, so we go slow and identify ourselves.
REQUEST_DELAY_S = 1.5
RETRIES = 3
RETRY_BACKOFF_S = 4
HEADERS = {
    "User-Agent": "BigDogStatsArchiver/1.0 (one-time personal team-data export)"
}

# QuickScores leagues we know the IDs for. Add historical leagues here as you
# find them (OrgDir/LeagueID are in the ResultsDisplay.php URL). Each entry maps
# a league to the SPS season it corresponds to so games can be matched up.
#   (quickscores_org, quickscores_league_id, sps_season_id)
QUICKSCORES_LEAGUES = [
    ("ahpd", 1740394, 21416),  # 2026 Fall AHeights
]

# Known SPS season IDs (from the career page), used if the live list can't be
# scraped. The scraper prefers the live list and falls back to this.
KNOWN_SEASON_IDS = [
    21416, 21182, 21002, 20926, 20672, 20575, 20352, 20216, 19550, 20083,
    19960, 19778, 19618, 19439, 19231, 18987, 18859, 18692, 18317, 18316,
    18022, 17682, 17482, 17269, 16895, 16738, 16428, 15943, 15713, 15346,
    14777, 14551, 14075, 13335, 12530, 11756, 11060, 10835, 10839, 10849,
    10847, 10873, 10917, 10890, 10973, 12318,
]

# Raw counting-stat columns we keep. Everything else (AVG/SLG/OB/OPS) is derived
# later by SQL views, so we deliberately drop it on import.
PLAYER_STAT_COLS = {
    "GP": "gp", "AB": "ab", "R": "r", "H": "h",
    "1B": "b1", "2B": "b2", "3B": "b3", "HR": "hr",
    "BB": "bb", "RBI": "rbi", "SO": "so", "SAC": "sac", "SB": "sb",
}

# --- HTTP --------------------------------------------------------------------

_session = requests.Session()
_session.headers.update(HEADERS)


def fetch(url: str) -> str:
    """GET with retries and a polite delay. Returns HTML text."""
    last_err = None
    for attempt in range(1, RETRIES + 1):
        try:
            resp = _session.get(url, timeout=30)
            resp.raise_for_status()
            time.sleep(REQUEST_DELAY_S)
            return resp.text
        except requests.RequestException as e:
            last_err = e
            print(f"  ! {url} failed (attempt {attempt}/{RETRIES}): {e}")
            time.sleep(RETRY_BACKOFF_S * attempt)
    raise RuntimeError(f"giving up on {url}: {last_err}")


# --- HTML table parsing ------------------------------------------------------

def parse_table(table) -> tuple[list[str], list[list[str]]]:
    """Return (headers, rows) of stripped cell text from a <table>."""
    rows = []
    for tr in table.find_all("tr"):
        cells = [c.get_text(strip=True) for c in tr.find_all(["th", "td"])]
        if cells:
            rows.append(cells)
    if not rows:
        return [], []
    return rows[0], rows[1:]


def find_stats_table(soup) -> tuple[list[str], list[list[str]]] | None:
    """Pick the table whose header row contains an 'AB' column (the stats table)."""
    for table in soup.find_all("table"):
        headers, body = parse_table(table)
        norm = [h.upper() for h in headers]
        if "AB" in norm and body:
            return norm, body
    return None


def to_int(s: str) -> int:
    s = s.strip().replace(",", "")
    return int(s) if s.lstrip("-").isdigit() else 0


# --- Season metadata ---------------------------------------------------------

SESSION_WORDS = ("Spring", "Summer", "Fall", "Winter")


@dataclass
class SeasonMeta:
    sps_id: int
    label: str
    year: int | None
    session: str | None
    league: str | None


def parse_season_label(sps_id: int, soup) -> SeasonMeta:
    """
    Pull the season label from the page (e.g. '2026 Fall AHeights') and split it
    into year / session / league. Falls back gracefully if the shape differs.
    """
    text = soup.get_text(" ", strip=True)
    # The season label is the token right before 'Season Stats' / 'Stats' header,
    # but it also appears standalone; grab the first 'YYYY <Session> <rest>'.
    m = re.search(r"(20\d{2})\s+(" + "|".join(SESSION_WORDS) + r")\s+([A-Za-z0-9 ]+?)\s+(?:Season\s+)?Stats", text)
    if not m:
        m = re.search(r"(20\d{2})\s+(" + "|".join(SESSION_WORDS) + r")\s+(\S+)", text)
    if m:
        year, session, league = int(m.group(1)), m.group(2), m.group(3).strip()
        label = f"{year} {session} {league}"
    else:
        year = int(re.search(r"20\d{2}", text).group()) if re.search(r"20\d{2}", text) else None
        session = next((w for w in SESSION_WORDS if w in text), None)
        league = None
        label = f"season {sps_id}"
    return SeasonMeta(sps_id, label, year, session, league)


def scrape_season_ids() -> list[int]:
    """Prefer the live list of season IDs from the career page; fall back to known."""
    try:
        html = fetch(f"{SPS_BASE}/teamStats.php?teamID={TEAM_ID}")
        ids = sorted({int(x) for x in re.findall(r"seasonID=(\d+)", html)}, reverse=True)
        if ids:
            print(f"Found {len(ids)} season IDs from the live career page.")
            return ids
    except Exception as e:
        print(f"Could not scrape live season list ({e}); using known IDs.")
    return KNOWN_SEASON_IDS


# --- Database ----------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY, year INTEGER, session TEXT, league_name TEXT,
  label TEXT, sps_season_id INTEGER UNIQUE
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  date TEXT, time TEXT, location TEXT, opponent TEXT, home_away TEXT,
  runs_for INTEGER, runs_against INTEGER, result TEXT
);
CREATE TABLE IF NOT EXISTS batting (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  ab INTEGER, r INTEGER, h INTEGER, b1 INTEGER, b2 INTEGER, b3 INTEGER, hr INTEGER,
  bb INTEGER, rbi INTEGER, so INTEGER, sac INTEGER, sb INTEGER,
  UNIQUE(game_id, player_id)
);
CREATE TABLE IF NOT EXISTS season_batting (
  id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  gp INTEGER, ab INTEGER, r INTEGER, h INTEGER, b1 INTEGER, b2 INTEGER,
  b3 INTEGER, hr INTEGER, bb INTEGER, rbi INTEGER, so INTEGER, sac INTEGER, sb INTEGER,
  UNIQUE(season_id, player_id)
);
"""


def init_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def get_player_id(conn, name: str) -> int:
    name = name.strip()
    cur = conn.execute("SELECT id FROM players WHERE name = ?", (name,))
    row = cur.fetchone()
    if row:
        return row[0]
    return conn.execute("INSERT INTO players (name) VALUES (?)", (name,)).lastrowid


def upsert_season(conn, meta: SeasonMeta) -> int:
    conn.execute(
        """INSERT INTO seasons (year, session, league_name, label, sps_season_id)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(sps_season_id) DO UPDATE SET
             year=excluded.year, session=excluded.session,
             league_name=excluded.league_name, label=excluded.label""",
        (meta.year, meta.session, meta.league, meta.label, meta.sps_id),
    )
    return conn.execute(
        "SELECT id FROM seasons WHERE sps_season_id = ?", (meta.sps_id,)
    ).fetchone()[0]


# --- Scrapers ----------------------------------------------------------------

def scrape_season_players(conn, sps_id: int):
    """Per-player season batting aggregates -> season_batting."""
    html = fetch(f"{SPS_BASE}/stats.php?teamID={TEAM_ID}&seasonID={sps_id}&type=players")
    soup = BeautifulSoup(html, "html.parser")
    meta = parse_season_label(sps_id, soup)
    season_id = upsert_season(conn, meta)

    found = find_stats_table(soup)
    if not found:
        print(f"  [{meta.label}] no player stats table found")
        return 0
    headers, body = found
    col = {h: i for i, h in enumerate(headers)}

    n = 0
    for row in body:
        name = row[0].strip()
        if not name or name.upper() in ("TOTAL", "TOTALS", "PLAYER"):
            continue
        player_id = get_player_id(conn, name)
        vals = {
            db_col: to_int(row[col[hdr]])
            for hdr, db_col in PLAYER_STAT_COLS.items()
            if hdr in col and col[hdr] < len(row)
        }
        cols = ", ".join(["season_id", "player_id", *vals.keys()])
        marks = ", ".join(["?"] * (2 + len(vals)))
        updates = ", ".join(f"{c}=excluded.{c}" for c in vals)
        conn.execute(
            f"""INSERT INTO season_batting ({cols}) VALUES ({marks})
                ON CONFLICT(season_id, player_id) DO UPDATE SET {updates}""",
            [season_id, player_id, *vals.values()],
        )
        n += 1
    print(f"  [{meta.label}] {n} players")
    return n


def scrape_season_games(conn, sps_id: int):
    """Per-game TEAM hitting totals -> games (opponent + runs_for only)."""
    html = fetch(f"{SPS_BASE}/stats.php?teamID={TEAM_ID}&seasonID={sps_id}&type=games")
    soup = BeautifulSoup(html, "html.parser")
    season_id = upsert_season(conn, parse_season_label(sps_id, soup))

    found = find_stats_table(soup)
    if not found:
        return 0
    headers, body = found
    col = {h: i for i, h in enumerate(headers)}
    n = 0
    for row in body:
        opp = row[0].strip()
        if not opp or opp.upper() in ("TOTAL", "TOTALS", "OPPONENT"):
            continue
        runs_for = to_int(row[col["R"]]) if "R" in col else None
        conn.execute(
            """INSERT INTO games (season_id, opponent, runs_for) VALUES (?, ?, ?)""",
            (season_id, opp, runs_for),
        )
        n += 1
    return n


def scrape_quickscores(conn):
    """
    Enrich/insert games from QuickScores for the leagues we have IDs for.

    NOTE: QuickScores markup hasn't been parsed field-by-field yet. This reads the
    results page text and extracts lines of the form:
        '... <Away> (A) <score> vs. <Home> (H) <score>'
    Validate against a live page on first run and tighten the regex if needed.
    """
    for org, league_id, sps_id in QUICKSCORES_LEAGUES:
        url = f"https://www.quickscores.com/Orgs/ResultsDisplay.php?OrgDir={org}&LeagueID={league_id}"
        try:
            html = fetch(url)
        except Exception as e:
            print(f"  QuickScores {league_id} failed: {e}")
            continue
        soup = BeautifulSoup(html, "html.parser")
        season_row = conn.execute(
            "SELECT id FROM seasons WHERE sps_season_id = ?", (sps_id,)
        ).fetchone()
        if not season_row:
            print(f"  QuickScores {league_id}: no matching SPS season {sps_id}, skipping")
            continue
        season_id = season_row[0]

        text = soup.get_text("\n", strip=True)
        # "Big Dog Gotta Eat (A) 19 vs. Chunichi Dragons (H) 5"
        pat = re.compile(
            r"(.+?)\s*\((A|H)\)\s*(\d+)\s*vs\.?\s*(.+?)\s*\((A|H)\)\s*(\d+)"
        )
        n = 0
        for line in text.splitlines():
            m = pat.search(line)
            if not m:
                continue
            away, _, away_score, home, _, home_score = m.groups()
            away_score, home_score = int(away_score), int(home_score)
            if "Big Dog" in away:
                opp, us, them, ha = home, away_score, home_score, "A"
            elif "Big Dog" in home:
                opp, us, them, ha = away, home_score, away_score, "H"
            else:
                continue  # game not involving our team
            result = "W" if us > them else "L" if us < them else "T"
            conn.execute(
                """INSERT INTO games
                   (season_id, opponent, home_away, runs_for, runs_against, result)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (season_id, opp.strip(), ha, us, them, result),
            )
            n += 1
        print(f"  QuickScores {org}/{league_id}: {n} games")


# --- Verification ------------------------------------------------------------

def verify_career(conn):
    """
    Reconcile summed season_batting against the SPS career page, per player.
    This is the migration's acceptance test: every line should match exactly.
    """
    html = fetch(f"{SPS_BASE}/teamStats.php?teamID={TEAM_ID}")
    soup = BeautifulSoup(html, "html.parser")
    found = find_stats_table(soup)
    if not found:
        print("VERIFY: could not find career stats table")
        return
    headers, body = found
    col = {h: i for i, h in enumerate(headers)}

    print("\nVERIFY (career totals: scraped-sum vs SPS):")
    mismatches = 0
    for row in body:
        name = row[0].strip()
        if not name or name.upper() in ("TOTAL", "TOTALS", "PLAYER"):
            continue
        sps_ab = to_int(row[col["AB"]]) if "AB" in col else None
        sps_h = to_int(row[col["H"]]) if "H" in col else None
        s = conn.execute(
            """SELECT COALESCE(SUM(ab),0), COALESCE(SUM(h),0)
               FROM season_batting sb JOIN players p ON p.id = sb.player_id
               WHERE p.name = ?""",
            (name,),
        ).fetchone()
        ab_ok = sps_ab is None or s[0] == sps_ab
        h_ok = sps_h is None or s[1] == sps_h
        flag = "" if ab_ok and h_ok else "  <-- MISMATCH"
        if flag:
            mismatches += 1
        print(f"  {name:24} AB {s[0]:>5}/{sps_ab}   H {s[1]:>5}/{sps_h}{flag}")
    print(f"VERIFY: {mismatches} mismatch(es).")


# --- Main --------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Archive Big Dog softball stats to SQLite")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--limit", type=int, default=None, help="only first N seasons")
    ap.add_argument("--verify", action="store_true", help="reconcile vs SPS career page")
    ap.add_argument("--skip-games", action="store_true", help="skip game-level scraping")
    args = ap.parse_args()

    conn = init_db(args.db)
    season_ids = scrape_season_ids()
    if args.limit:
        season_ids = season_ids[: args.limit]

    print(f"\nScraping {len(season_ids)} seasons into {args.db} ...")
    for i, sps_id in enumerate(season_ids, 1):
        print(f"[{i}/{len(season_ids)}] seasonID={sps_id}")
        try:
            scrape_season_players(conn, sps_id)
            if not args.skip_games:
                scrape_season_games(conn, sps_id)
            conn.commit()
        except Exception as e:
            print(f"  ! season {sps_id} error: {e}")

    if not args.skip_games:
        print("\nQuickScores enrichment ...")
        scrape_quickscores(conn)
        conn.commit()

    counts = {
        t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        for t in ("players", "seasons", "games", "season_batting")
    }
    print(f"\nDone. {counts}")

    if args.verify:
        verify_career(conn)

    conn.close()


if __name__ == "__main__":
    sys.exit(main())
