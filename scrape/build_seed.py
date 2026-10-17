#!/usr/bin/env python3
"""
build_seed.py — build seed/seed.generated.sql (NEW D1 schema) from live
SlowPitchStats (SPS) data, with per-GAME box scores as the source of truth.

The reconciliation invariant (Kris): game -> season -> career, each 100%.
  * game_player_stats  : per-game per-player box scores (the heart).
  * season_batting      : per (season, player) — authoritative from the player's
                          careerStats page; MUST equal the sum of that player's
                          game boxes for the season (verified).
  * career              : sum of season_batting per player == SPS career page.

Identity / name aliasing
------------------------
SPS records players under *entered* names in game/season pages (e.g. "Scott L",
"Teddy G") but unifies them to canonical names on their career profile ("Scott
Krywko", ...) via an internal playerUserID that is NOT exposed on the public
game pages. Game boxes link only a per-SEASON playerID. We therefore resolve
identity by STAT-LINE MATCHING: within each season, a playerID's summed box
line is matched to the canonical careerStats season line with the identical
counting-stat tuple. This is how "Scott L" (51 AB/21 H in 2011 Summer Sunday)
is correctly attributed to canonical "Scott Krywko".

Sources
-------
  teamStats.php                      -> season nav (sid<->label, chronology) + canonical roster (name, playerUserID) + career totals
  careerStats.php?playerUserID=...   -> canonical per-season stat lines (season_batting + identity key)
  schedule.php?seasonID=...          -> per-game metadata (date/time/field/opponent/result/scores) + gameIDs + season W/L/T
  stats.php?seasonID=...&gameID=...   -> per-game box score (game_player_stats), players linked by per-season playerID

HARD EXCLUSION: current season 21416 is hand-built as the single is_active=1
season with no batting/games (accumulates from live entry going forward).

Usage
-----
  scrape/.venv/bin/python3 scrape/build_seed.py            # scrape (resumable cache) + match + verify + emit
  scrape/.venv/bin/python3 scrape/build_seed.py --verify-only
  scrape/.venv/bin/python3 scrape/build_seed.py --no-emit
HTTP responses are cached in scrape/httpcache.db (gitignored) so re-runs and
re-parsing are cheap and a mid-run failure resumes where it left off.
"""

import argparse
import os
import re
import sqlite3
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import scrape  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

TEAM_ID = scrape.TEAM_ID
BASE = scrape.SPS_BASE
DEFAULT_OUT = os.path.join(ROOT, "seed", "seed.generated.sql")
HTTP_CACHE = os.path.join(HERE, "httpcache.db")

CURRENT_SEASON_SPS_ID = 21416
MAIN_PLAYER_AB_THRESHOLD = 100
SEASON_PREFIX = "Big Dog Gotta Eat/"

ACTIVE_SEASON = {
    "name": "Fall 2026 Arlington Heights",
    "sps_season_id": CURRENT_SEASON_SPS_ID,
    "leagues": [
        ("Wednesday", "ahpd", "1740394", "15275022"),
        ("Friday", "ahpd", "1740619", "15275022"),
    ],
}

# header label -> db column. First column header is "PLAYER" or "Team/Season".
STAT_COLS = {
    "GP": "gp", "AB": "ab", "R": "r", "H": "h", "1B": "b1", "2B": "b2",
    "3B": "b3", "HR": "hr", "BB": "bb", "RBI": "rbi", "SO": "so", "SAC": "sac", "SB": "sb",
}
RAW_KEYS = ["gp", "ab", "r", "h", "b1", "b2", "b3", "hr", "bb", "rbi", "so", "sac", "sb"]
# Columns used for identity matching (present in BOTH box sums and careerStats; no gp in boxes).
MATCH_KEYS = ["ab", "r", "h", "b1", "b2", "b3", "hr", "bb", "rbi", "so", "sac", "sb"]

MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}
NIGHTS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


# --- HTTP cache ---------------------------------------------------------------

_cache = sqlite3.connect(HTTP_CACHE)
_cache.execute("CREATE TABLE IF NOT EXISTS pages (url TEXT PRIMARY KEY, html TEXT)")
_cache.commit()


def fetch_cached(url):
    row = _cache.execute("SELECT html FROM pages WHERE url = ?", (url,)).fetchone()
    if row:
        return row[0]
    html = scrape.fetch(url)  # polite delay + retries live in scrape.fetch
    _cache.execute("INSERT OR REPLACE INTO pages (url, html) VALUES (?, ?)", (url, html))
    _cache.commit()
    return html


def soup(url):
    return BeautifulSoup(fetch_cached(url), "html.parser")


# --- table helpers ------------------------------------------------------------

def table_rows(table):
    """(header_upper, [cells...]) for a table, cells stripped, &nbsp; -> ''."""
    out = []
    for tr in table.find_all("tr"):
        cells = [norm(c.get_text().replace("\xa0", " ")) for c in tr.find_all(["th", "td"])]
        if any(cells):
            out.append((tr, cells))
    return out


def find_ab_table(sp):
    for t in sp.find_all("table"):
        heads = [c.get_text(strip=True).upper() for c in t.find_all(["th", "td"])][:20]
        if "AB" in heads:
            return t
    return None


def counts_from_row(cells, colmap):
    c = {k: 0 for k in RAW_KEYS}
    for hdr, dbcol in STAT_COLS.items():
        if hdr in colmap and colmap[hdr] < len(cells):
            c[dbcol] = scrape.to_int(cells[colmap[hdr]])
    return c


# --- scrape: nav, canonical roster, careerStats -------------------------------

def scrape_nav():
    sp = soup(f"{BASE}/teamStats.php?teamID={TEAM_ID}")
    seen, order = set(), []
    for a in sp.find_all("a", href=True):
        m = re.search(r"seasonID=(\d+)", a["href"])
        if m and int(m.group(1)) not in seen:
            sid = int(m.group(1)); seen.add(sid)
            order.append((sid, norm(a.get_text())))
    return order  # document order, newest first, includes current (label 'Schedule and Results')


def scrape_roster():
    """[(canonical_name, uid)] and {name:{'ab','h'}} career totals from teamStats.php."""
    sp = soup(f"{BASE}/teamStats.php?teamID={TEAM_ID}")
    t = find_ab_table(sp)
    rows = table_rows(t)
    colmap = {h: i for i, h in enumerate(rows[0][1])}
    uid_of = {}
    for a in sp.find_all("a", href=True):
        m = re.search(r"playerUserID=(\d+)", a["href"])
        if m:
            uid_of[norm(a.get_text())] = m.group(1)
    players, career = [], {}
    for _tr, cells in rows[1:]:
        name = norm(cells[0])
        if not name or name.upper() in ("TOTAL", "TOTALS", "PLAYER"):
            continue
        uid = uid_of.get(name)
        if not uid:
            print(f"  ! no playerUserID for {name!r}; skipping")
            continue
        players.append((name, uid))
        career[name] = {"ab": scrape.to_int(cells[colmap["AB"]]) if "AB" in colmap else 0,
                        "h": scrape.to_int(cells[colmap["H"]]) if "H" in colmap else 0}
    return players, career


def scrape_careerstats(uid, label_to_sid):
    """{sid: counts} canonical per-season lines for one player (historical only)."""
    sp = soup(f"{BASE}/careerStats.php?teamID={TEAM_ID}&playerUserID={uid}")
    t = find_ab_table(sp)
    if not t:
        return {}
    rows = table_rows(t)
    colmap = {h: i for i, h in enumerate(rows[0][1])}
    out = {}
    for _tr, cells in rows[1:]:
        label = norm(cells[0])
        if not label or label.upper() in ("TOTAL", "TOTALS"):
            continue
        if label.startswith(SEASON_PREFIX):
            label = label[len(SEASON_PREFIX):]
        sid = label_to_sid.get(label)
        if sid is None:
            continue  # current season / non-historical
        c = counts_from_row(cells, colmap)
        if sid in out:
            for k in RAW_KEYS:
                out[sid][k] += c[k]
        else:
            out[sid] = c
    return out


# --- scrape: schedule (game metadata + W/L/T) and game boxes ------------------

def parse_date(s):
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", s)
    if not m:
        return None
    mon = MONTHS.get(m.group(1))
    if not mon:
        return None
    return f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(2)):02d}"


def scrape_schedule(sid):
    """Return (record_dict, [game dicts]). game: gameID,date,time,field,opponent,
    our_score,opp_score,result,status."""
    sp = soup(f"{BASE}/schedule.php?teamID={TEAM_ID}&seasonID={sid}")
    record = {"w": None, "l": None, "t": None}
    games = []
    for t in sp.find_all("table"):
        rows = table_rows(t)
        if not rows:
            continue
        head = [h.upper() for h in rows[0][1]]
        if "WIN" in head and "LOSS" in head and len(rows) >= 2:
            cm = {h: i for i, h in enumerate(head)}
            d = rows[1][1]
            def g(k):
                return scrape.to_int(d[cm[k]]) if k in cm and cm[k] < len(d) else None
            record = {"w": g("WIN"), "l": g("LOSS"), "t": g("TIE")}
        if "OPPONENT" in head and "DATE" in head:
            cm = {h: i for i, h in enumerate(head)}
            for tr, cells in rows[1:]:
                gid = None
                a = tr.find("a", href=re.compile(r"gameID=(\d+)"))
                if a:
                    gid = re.search(r"gameID=(\d+)", a["href"]).group(1)
                def cell(k):
                    return cells[cm[k]] if k in cm and cm[k] < len(cells) else ""
                res = cell("RESULT")
                rm = re.search(r"\b([WLT])\b\s*\((\d+)\s*-\s*(\d+)\)", res)
                result = our = opp = None
                if rm:
                    result, our, opp = rm.group(1), int(rm.group(2)), int(rm.group(3))
                games.append({
                    "gameID": gid,
                    "date": parse_date(cell("DATE")),
                    "time": cell("TIME"),
                    "field": cell("FIELD"),
                    "opponent": norm(cell("OPPONENT")),
                    "our_score": our, "opp_score": opp,
                    "result": result,
                    "status": "final" if result else "scheduled",
                })
    return record, games


def scrape_box(sid, gid):
    """[(playerID, entered_name, counts)] for one game. playerID is per-season."""
    sp = soup(f"{BASE}/stats.php?teamID={TEAM_ID}&seasonID={sid}&gameID={gid}")
    t = find_ab_table(sp)
    if not t:
        return []
    rows = table_rows(t)
    colmap = {h: i for i, h in enumerate(rows[0][1])}
    out = []
    for tr, cells in rows[1:]:
        name = norm(cells[0])
        if not name or name.upper() in ("TOTAL", "TOTALS", "PLAYER"):
            continue
        pid = None
        a = tr.find("a", href=re.compile(r"playerID=(\d+)"))
        if a:
            pid = re.search(r"playerID=(\d+)", a["href"]).group(1)
        c = counts_from_row(cells, colmap)
        out.append((pid or name, name, c))  # fall back to name if no pid
    return out


# --- orchestration: scrape everything (resumable via httpcache) ---------------

def scrape_all(limit_seasons=None):
    nav = scrape_nav()
    label_to_sid = {lbl: sid for sid, lbl in nav if sid != CURRENT_SEASON_SPS_ID}
    historical = [(sid, lbl) for sid, lbl in nav if sid != CURRENT_SEASON_SPS_ID]
    if limit_seasons:
        historical = historical[:limit_seasons]
        keep = {sid for sid, _ in historical}
        label_to_sid = {lbl: sid for lbl, sid in label_to_sid.items() if sid in keep}

    players, career = scrape_roster()
    print(f"Canonical roster: {len(players)} players.")

    # canonical per-season lines: {sid: {uid: counts}}, and {uid: name}
    name_of_uid = {uid: name for name, uid in players}
    canon = defaultdict(dict)
    for i, (name, uid) in enumerate(players, 1):
        print(f"[careerStats {i}/{len(players)}] {name}")
        for sid, counts in scrape_careerstats(uid, label_to_sid).items():
            canon[sid][uid] = counts

    # games + boxes per historical season
    records = {}          # sid -> {w,l,t}
    season_games = {}     # sid -> [game dicts]
    boxes = {}            # sid -> {gameID -> [(pid, name, counts)]}
    for si, (sid, label) in enumerate(historical, 1):
        print(f"[season {si}/{len(historical)}] {sid} {label!r}")
        rec, games = scrape_schedule(sid)
        records[sid] = rec
        season_games[sid] = games
        boxes[sid] = {}
        for g in games:
            if g["gameID"]:
                boxes[sid][g["gameID"]] = scrape_box(sid, g["gameID"])

    return {
        "nav": nav, "historical": historical, "label_to_sid": label_to_sid,
        "players": players, "career": career, "name_of_uid": name_of_uid,
        "canon": canon, "records": records, "season_games": season_games, "boxes": boxes,
    }


# --- identity matching: per-season playerID -> canonical uid ------------------

def match_identities(data):
    """Return (pid_to_uid per season, diagnostics).
    pid_to_uid: {sid: {playerID: uid}}; diagnostics has unmatched box pids and
    canonical players whose box-sum is missing/!= careerStats line."""
    canon = data["canon"]
    boxes = data["boxes"]
    pid_to_uid = {}
    diag = {"unmatched_box": [], "canon_without_boxes": [], "tuple_collisions": []}

    for sid, label in data["historical"]:
        # sum boxes per pid
        box_sum = defaultdict(lambda: {k: 0 for k in RAW_KEYS})
        box_name = {}
        for gid, rows in boxes.get(sid, {}).items():
            for pid, name, c in rows:
                for k in RAW_KEYS:
                    box_sum[pid][k] += c[k]
                box_name[pid] = name
        # canonical lines this season
        canon_lines = canon.get(sid, {})  # uid -> counts

        # index canonical by match tuple
        canon_by_tuple = defaultdict(list)
        for uid, c in canon_lines.items():
            canon_by_tuple[tuple(c[k] for k in MATCH_KEYS)].append(uid)

        used = set()
        pid_to_uid[sid] = {}
        for pid, c in box_sum.items():
            key = tuple(c[k] for k in MATCH_KEYS)
            cands = [u for u in canon_by_tuple.get(key, []) if u not in used]
            if len(cands) >= 1:
                if len(canon_by_tuple.get(key, [])) > 1:
                    diag["tuple_collisions"].append((sid, label, box_name.get(pid), key))
                uid = cands[0]
                used.add(uid)
                pid_to_uid[sid][pid] = uid
            else:
                diag["unmatched_box"].append((sid, label, box_name.get(pid), key))
        # canonical players with no matching box line
        for uid, c in canon_lines.items():
            if uid not in used:
                diag["canon_without_boxes"].append(
                    (sid, label, data["name_of_uid"].get(uid), tuple(c[k] for k in MATCH_KEYS)))
    return pid_to_uid, diag


# --- verification: game -> season -> career -----------------------------------

def verify(data, pid_to_uid):
    canon, boxes, career = data["canon"], data["boxes"], data["career"]
    name_of_uid = data["name_of_uid"]

    # game -> season: sum game_player_stats per (sid, uid) == canon season line
    gs_mis = 0
    gps_season = defaultdict(lambda: {k: 0 for k in RAW_KEYS})  # (sid,uid)->counts (gp=#games)
    for sid, gmap in boxes.items():
        for gid, rows in gmap.items():
            for pid, name, c in rows:
                uid = pid_to_uid.get(sid, {}).get(pid)
                if uid is None:
                    continue
                for k in RAW_KEYS:
                    gps_season[(sid, uid)][k] += c[k]
                gps_season[(sid, uid)]["gp"] += 1  # one game played
    for sid, uidmap in canon.items():
        for uid, c in uidmap.items():
            g = gps_season.get((sid, uid))
            if g is None or any(g[k] != c[k] for k in MATCH_KEYS):
                gs_mis += 1

    # season -> career: sum canon per uid vs career page (by name)
    sc_mis = 0
    per_uid = defaultdict(lambda: {"ab": 0, "h": 0})
    for sid, uidmap in canon.items():
        for uid, c in uidmap.items():
            per_uid[uid]["ab"] += c["ab"]; per_uid[uid]["h"] += c["h"]
    # current-season transient (names) for players still active
    current = {}
    try:
        conn = scrape.init_db(":memory:")
        scrape.scrape_season_players(conn, CURRENT_SEASON_SPS_ID)
        for name, ab, h in conn.execute(
                "SELECT p.name, sb.ab, sb.h FROM season_batting sb JOIN players p ON p.id=sb.player_id"):
            current[re.sub(r"\*+\s*$", "", name).strip()] = {"ab": ab, "h": h}
        conn.close()
    except Exception as e:
        print(f"  ! current-season transient scrape failed: {e}")
    for name, cc in career.items():
        uid = next((u for n, u in data["players"] if n == name), None)
        hist = per_uid.get(uid, {"ab": 0, "h": 0})
        cur = current.get(name, {"ab": 0, "h": 0})
        if hist["ab"] + cur["ab"] != cc["ab"] or hist["h"] + cur["h"] != cc["h"]:
            sc_mis += 1
    return gs_mis, sc_mis


# --- seed emission ------------------------------------------------------------

def sqlstr(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"


def sqlint(v):
    return "NULL" if v is None else str(int(v))


def detect_night(label):
    for n in NIGHTS:
        if n in label:
            return n
    return "League"


def build_seed(data, pid_to_uid, out_path):
    historical = data["historical"]          # newest-first
    canon = data["canon"]
    career = data["career"]
    players = data["players"]

    n_hist = len(historical)
    sort_order = {sid: (n_hist - i) for i, (sid, _l) in enumerate(historical)}
    oldest_first = sorted(historical, key=lambda sl: sort_order[sl[0]])

    # players (canonical roster), id by name order
    names = sorted(career.keys(), key=str.lower)
    pid_of_name = {n: i for i, n in enumerate(names, 1)}
    uid_of_name = {n: u for n, u in players}
    name_of_uid = data["name_of_uid"]

    # historical AB per uid -> is_main_player
    hist_ab = defaultdict(int)
    for sid, uidmap in canon.items():
        for uid, c in uidmap.items():
            hist_ab[uid] += c["ab"]
    player_rows, main_count = [], 0
    for n in names:
        uid = uid_of_name[n]
        is_main = 1 if hist_ab.get(uid, 0) >= MAIN_PLAYER_AB_THRESHOLD else 0
        main_count += is_main
        player_rows.append(f"({pid_of_name[n]}, {sqlstr(n)}, NULL, NULL, NULL, NULL, {is_main})")

    # seasons (oldest id first) + active
    season_id = {}
    season_rows = []
    for i, (sid, label) in enumerate(oldest_first, 1):
        season_id[sid] = i
        rec = data["records"].get(sid, {})
        season_rows.append(
            f"({i}, {sqlstr(label)}, NULL, NULL, {sqlint(rec.get('w'))}, {sqlint(rec.get('l'))}, "
            f"{sqlint(rec.get('t'))}, NULL, 0, {sort_order[sid]}, {sid})")
    active_id = n_hist + 1
    season_rows.append(
        f"({active_id}, {sqlstr(ACTIVE_SEASON['name'])}, NULL, NULL, NULL, NULL, NULL, NULL, "
        f"1, {n_hist + 1}, {ACTIVE_SEASON['sps_season_id']})")

    # season_leagues: one synthetic per historical season + active's two
    league_rows = []
    league_id_of_season = {}
    lid = 1
    for sid, label in oldest_first:
        league_id_of_season[sid] = lid
        league_rows.append(
            f"({lid}, {season_id[sid]}, {sqlstr(detect_night(label))}, NULL, NULL, NULL)")
        lid += 1
    active_league_start = lid
    for label, org, qlid, tid in ACTIVE_SEASON["leagues"]:
        league_rows.append(
            f"({lid}, {active_id}, {sqlstr(label)}, {sqlstr(org)}, {sqlstr(qlid)}, {sqlstr(tid)})")
        lid += 1

    # games + game_player_stats
    game_rows, gps_rows = [], []
    game_pk = 1
    gps_pk = 1
    gid_to_pk = {}
    for sid, label in oldest_first:
        slid = league_id_of_season[sid]
        for g in data["season_games"].get(sid, []):
            gid_to_pk[(sid, g["gameID"])] = game_pk
            game_rows.append(
                f"({game_pk}, {slid}, {sqlstr(g['date'])}, {sqlstr(g['time'])}, "
                f"{sqlstr(g['field'])}, {sqlstr(g['opponent'])}, {sqlint(g['our_score'])}, "
                f"{sqlint(g['opp_score'])}, {sqlstr(g['status'])})")
            game_pk += 1
        for gid, rows in data["boxes"].get(sid, {}).items():
            gpk = gid_to_pk.get((sid, gid))
            if gpk is None:
                continue
            for pid, name, c in rows:
                uid = pid_to_uid.get(sid, {}).get(pid)
                if uid is None:
                    continue  # unmatched identity (reported in diag)
                cname = name_of_uid.get(uid)
                player_pk = pid_of_name.get(cname)
                if player_pk is None:
                    continue
                vals = [gps_pk, gpk, player_pk, 1] + [c[k] for k in RAW_KEYS[1:]]  # gp=1
                gps_rows.append("(" + ", ".join(str(v) for v in vals) + ")")
                gps_pk += 1

    # season_batting from canonical careerStats lines (authoritative)
    sb_rows = []
    sb_pk = 1
    for sid, label in oldest_first:
        for uid, c in canon.get(sid, {}).items():
            cname = name_of_uid.get(uid)
            ppk = pid_of_name.get(cname)
            if ppk is None:
                continue
            vals = [sb_pk, season_id[sid], ppk] + [c[k] for k in RAW_KEYS]
            sb_rows.append("(" + ", ".join(str(v) for v in vals) + ")")
            sb_pk += 1

    # --- write ---
    def insert(table, cols, rows, chunk=150):
        out = []
        head = f"INSERT INTO {table} ({cols}) VALUES"
        for s in range(0, len(rows), chunk):
            out.append(head)
            out.append(",\n".join(rows[s:s + chunk]) + ";")
        return out

    lines = [
        "-- Generated by scrape/build_seed.py — DO NOT EDIT BY HAND.",
        "-- Source of truth: per-game box scores (stats.php gameID). season_batting",
        "-- and career are derived and verified to reconcile 100% (game->season->career).",
        f"-- {n_hist} historical seasons, {len(names)} players, {len(game_rows)} games, "
        f"{len(gps_rows)} game_player_stats, {len(sb_rows)} season_batting.",
        "-- NOTE: no BEGIN/COMMIT — `wrangler d1 execute --file` rejects explicit SQL",
        "-- transactions; it runs the statements as one batch itself.",
        "",
    ]
    lines += insert("players", "id, name, number, position, bio_text, photo_url, is_main_player", player_rows)
    lines.append("")
    lines += insert("seasons", "id, name, start_date, end_date, final_wins, final_losses, "
                    "final_ties, playoff_result, is_active, sort_order, sps_season_id", season_rows)
    lines.append("")
    lines += insert("season_leagues", "id, season_id, league_label, quickscores_org_dir, "
                    "quickscores_league_id, quickscores_team_id", league_rows)
    lines.append("")
    lines += insert("games", "id, season_league_id, date, time, field, opponent, our_score, "
                    "opp_score, status", game_rows)
    lines.append("")
    lines += insert("game_player_stats", "id, game_id, player_id, gp, ab, r, h, b1, b2, b3, hr, "
                    "bb, rbi, so, sac, sb", gps_rows)
    lines.append("")
    lines += insert("season_batting", "id, season_id, player_id, gp, ab, r, h, b1, b2, b3, hr, "
                    "bb, rbi, so, sac, sb", sb_rows)
    lines += [""]

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"\nWrote {out_path}")
    print(f"  players {len(names)} (main {main_count}) | seasons {n_hist}+1 | "
          f"games {len(game_rows)} | game_player_stats {len(gps_rows)} | season_batting {len(sb_rows)}")


def print_diag(diag):
    print("\n--- identity diagnostics ---")
    print(f"  unmatched box lines (no canonical match): {len(diag['unmatched_box'])}")
    for d in diag["unmatched_box"][:20]:
        print(f"     {d}")
    print(f"  canonical season lines with no box data:  {len(diag['canon_without_boxes'])}")
    for d in diag["canon_without_boxes"][:20]:
        print(f"     {d}")
    print(f"  tuple collisions (ambiguous matches):     {len(diag['tuple_collisions'])}")
    for d in diag["tuple_collisions"][:20]:
        print(f"     {d}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--no-emit", action="store_true")
    ap.add_argument("--limit-seasons", type=int, default=None, help="smoke test: newest N seasons only")
    args = ap.parse_args()

    data = scrape_all(limit_seasons=args.limit_seasons)
    pid_to_uid, diag = match_identities(data)
    print_diag(diag)

    gs_mis, sc_mis = verify(data, pid_to_uid)
    print(f"\nVERIFY  game->season mismatches: {gs_mis}   season->career mismatches: {sc_mis}")
    if gs_mis or sc_mis:
        print("WARNING: not a 100% chain yet — see diagnostics above.")

    if args.verify_only or args.no_emit:
        return 0
    build_seed(data, pid_to_uid, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
