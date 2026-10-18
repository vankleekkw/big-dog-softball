// Shared D1 query helpers. All queries are parameterized (.bind()); no string
// interpolation of user input into SQL. Keep per-season batting resolution
// (docs/API.md "Per-season batting resolution rule") centralized here so
// callers never special-case historical vs. active seasons.

const RAW_COUNT_COLS = ["gp", "ab", "r", "h", "b1", "b2", "b3", "hr", "bb", "rbi", "so", "sac", "sb"];

// ---- Seasons ---------------------------------------------------------------

export async function getActiveSeason(db) {
  const row = await db.prepare("SELECT * FROM seasons WHERE is_active = 1 LIMIT 1").first();
  return row || null;
}

export async function getSeasonById(db, id) {
  const row = await db.prepare("SELECT * FROM seasons WHERE id = ?").bind(id).first();
  return row || null;
}

// Resolve a `season` query/body param: 'active' (default) or a numeric id.
export async function resolveSeason(db, param) {
  if (!param || param === "active") return getActiveSeason(db);
  const id = Number(param);
  if (!Number.isInteger(id)) return null;
  return getSeasonById(db, id);
}

export async function listSeasons(db) {
  const res = await db.prepare("SELECT * FROM seasons ORDER BY sort_order DESC").all();
  return res.results;
}

// Activate a season, clearing any other active season atomically so the
// partial unique index (idx_seasons_one_active) never sees two is_active=1
// rows at once. `extraSetSql`/`extraValues` let a PATCH apply other field
// changes in the same transaction.
export async function setActiveSeason(db, seasonId, extraSetSql = "", extraValues = []) {
  const setClause = extraSetSql ? `${extraSetSql}, is_active = 1` : "is_active = 1";
  await db.batch([
    db.prepare("UPDATE seasons SET is_active = 0 WHERE is_active = 1"),
    db.prepare(`UPDATE seasons SET ${setClause} WHERE id = ?`).bind(...extraValues, seasonId),
  ]);
}

export async function getSeasonLeagues(db, seasonId) {
  const res = await db.prepare("SELECT * FROM season_leagues WHERE season_id = ?").bind(seasonId).all();
  return res.results;
}

// ---- Per-season batting resolution -----------------------------------------

// Raw per-player counts for a season: season_batting if it has rows for this
// season (historical/migrated), else aggregated from game_player_stats
// (active/live season).
export async function getSeasonBattingRows(db, seasonId) {
  const stored = await db
    .prepare(
      `SELECT player_id, gp, ab, r, h, b1, b2, b3, hr, bb, rbi, so, sac, sb
       FROM season_batting WHERE season_id = ?`
    )
    .bind(seasonId)
    .all();
  if (stored.results.length > 0) return stored.results;

  const agg = await db
    .prepare(
      `SELECT gps.player_id AS player_id,
              SUM(gps.gp) AS gp, SUM(gps.ab) AS ab, SUM(gps.r) AS r, SUM(gps.h) AS h,
              SUM(gps.b1) AS b1, SUM(gps.b2) AS b2, SUM(gps.b3) AS b3, SUM(gps.hr) AS hr,
              SUM(gps.bb) AS bb, SUM(gps.rbi) AS rbi, SUM(gps.so) AS so,
              SUM(gps.sac) AS sac, SUM(gps.sb) AS sb
       FROM game_player_stats gps
       JOIN games g ON g.id = gps.game_id
       JOIN season_leagues sl ON sl.id = g.season_league_id
       WHERE sl.season_id = ?
       GROUP BY gps.player_id`
    )
    .bind(seasonId)
    .all();
  return agg.results;
}

export async function getPlayersByIds(db, ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(",");
  const res = await db
    .prepare(`SELECT id, name, number, position FROM players WHERE id IN (${placeholders})`)
    .bind(...unique)
    .all();
  return res.results;
}

// Season batting rows joined with player name/number for display.
export async function getSeasonBattingWithPlayers(db, seasonId) {
  const rows = await getSeasonBattingRows(db, seasonId);
  if (rows.length === 0) return [];
  const players = await getPlayersByIds(db, rows.map((r) => r.player_id));
  const byId = new Map(players.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.player_id);
    return { ...r, name: p ? p.name : "Unknown", number: p ? p.number : null };
  });
}

// Career raw counts for one player: sum of season_batting rows for that
// player, PLUS game_player_stats aggregated for any season that has no
// season_batting rows at all (so a season is never double-counted).
export async function getPlayerCareerRaw(db, playerId) {
  const a = await db
    .prepare(
      `SELECT COALESCE(SUM(gp),0) gp, COALESCE(SUM(ab),0) ab, COALESCE(SUM(r),0) r, COALESCE(SUM(h),0) h,
              COALESCE(SUM(b1),0) b1, COALESCE(SUM(b2),0) b2, COALESCE(SUM(b3),0) b3, COALESCE(SUM(hr),0) hr,
              COALESCE(SUM(bb),0) bb, COALESCE(SUM(rbi),0) rbi, COALESCE(SUM(so),0) so,
              COALESCE(SUM(sac),0) sac, COALESCE(SUM(sb),0) sb
       FROM season_batting WHERE player_id = ?`
    )
    .bind(playerId)
    .first();

  const b = await db
    .prepare(
      `SELECT COALESCE(SUM(gps.gp),0) gp, COALESCE(SUM(gps.ab),0) ab, COALESCE(SUM(gps.r),0) r, COALESCE(SUM(gps.h),0) h,
              COALESCE(SUM(gps.b1),0) b1, COALESCE(SUM(gps.b2),0) b2, COALESCE(SUM(gps.b3),0) b3, COALESCE(SUM(gps.hr),0) hr,
              COALESCE(SUM(gps.bb),0) bb, COALESCE(SUM(gps.rbi),0) rbi, COALESCE(SUM(gps.so),0) so,
              COALESCE(SUM(gps.sac),0) sac, COALESCE(SUM(gps.sb),0) sb
       FROM game_player_stats gps
       JOIN games g ON g.id = gps.game_id
       JOIN season_leagues sl ON sl.id = g.season_league_id
       WHERE gps.player_id = ?
         AND sl.season_id NOT IN (SELECT DISTINCT season_id FROM season_batting)`
    )
    .bind(playerId)
    .first();

  const out = {};
  for (const k of RAW_COUNT_COLS) out[k] = (a?.[k] || 0) + (b?.[k] || 0);
  return out;
}

// Per-season raw counts for one player, resolved per the same rule, with
// season metadata attached, ordered chronologically (sort_order ascending).
export async function getPlayerSeasonRows(db, playerId) {
  const direct = await db
    .prepare(
      `SELECT season_id, gp, ab, r, h, b1, b2, b3, hr, bb, rbi, so, sac, sb
       FROM season_batting WHERE player_id = ?`
    )
    .bind(playerId)
    .all();

  const aggregated = await db
    .prepare(
      `SELECT sl.season_id AS season_id,
              SUM(gps.gp) AS gp, SUM(gps.ab) AS ab, SUM(gps.r) AS r, SUM(gps.h) AS h,
              SUM(gps.b1) AS b1, SUM(gps.b2) AS b2, SUM(gps.b3) AS b3, SUM(gps.hr) AS hr,
              SUM(gps.bb) AS bb, SUM(gps.rbi) AS rbi, SUM(gps.so) AS so,
              SUM(gps.sac) AS sac, SUM(gps.sb) AS sb
       FROM game_player_stats gps
       JOIN games g ON g.id = gps.game_id
       JOIN season_leagues sl ON sl.id = g.season_league_id
       WHERE gps.player_id = ?
         AND sl.season_id NOT IN (SELECT DISTINCT season_id FROM season_batting)
       GROUP BY sl.season_id`
    )
    .bind(playerId)
    .all();

  const bySeasonId = new Map();
  for (const r of direct.results) bySeasonId.set(r.season_id, r);
  for (const r of aggregated.results) bySeasonId.set(r.season_id, r);
  if (bySeasonId.size === 0) return [];

  const seasonIds = [...bySeasonId.keys()];
  const placeholders = seasonIds.map(() => "?").join(",");
  const seasons = await db
    .prepare(`SELECT id, name, sort_order FROM seasons WHERE id IN (${placeholders})`)
    .bind(...seasonIds)
    .all();
  const seasonMeta = new Map(seasons.results.map((s) => [s.id, s]));

  return [...bySeasonId.entries()]
    .map(([seasonId, counts]) => ({
      season_id: seasonId,
      season_name: seasonMeta.get(seasonId) ? seasonMeta.get(seasonId).name : null,
      sort_order: seasonMeta.get(seasonId) ? seasonMeta.get(seasonId).sort_order : 0,
      ...counts,
    }))
    .sort((x, y) => x.sort_order - y.sort_order);
}

// ---- Games / W-L-T -----------------------------------------------------------

export function deriveResult(game) {
  if (game.status !== "final" || game.our_score == null || game.opp_score == null) return null;
  if (game.our_score > game.opp_score) return "W";
  if (game.our_score < game.opp_score) return "L";
  return "T";
}

// Live W/L/T for a season, derived from games(status='final').
export async function getSeasonRecord(db, seasonId) {
  const res = await db
    .prepare(
      `SELECT g.our_score, g.opp_score
       FROM games g JOIN season_leagues sl ON sl.id = g.season_league_id
       WHERE sl.season_id = ? AND g.status = 'final' AND g.is_playoff = 0`
    )
    .bind(seasonId)
    .all();
  let wins = 0, losses = 0, ties = 0;
  for (const g of res.results) {
    if (g.our_score == null || g.opp_score == null) continue;
    if (g.our_score > g.opp_score) wins++;
    else if (g.our_score < g.opp_score) losses++;
    else ties++;
  }
  return { wins, losses, ties };
}

// Career W/L/T: sum of every season's stored final_* (closed seasons) plus
// the active season's live record (not yet closed/stored).
export async function getCareerRecord(db) {
  const totals = await db
    .prepare(
      `SELECT COALESCE(SUM(final_wins),0) w, COALESCE(SUM(final_losses),0) l, COALESCE(SUM(final_ties),0) t
       FROM seasons`
    )
    .first();
  const active = await getActiveSeason(db);
  const live = active ? await getSeasonRecord(db, active.id) : { wins: 0, losses: 0, ties: 0 };
  return {
    wins: (totals?.w || 0) + live.wins,
    losses: (totals?.l || 0) + live.losses,
    ties: (totals?.t || 0) + live.ties,
  };
}

// ---- Players ----------------------------------------------------------------

export async function listPlayersWithActiveFlag(db) {
  const active = await getActiveSeason(db);
  const res = await db
    .prepare("SELECT id, name, number, position, photo_url, is_main_player FROM players ORDER BY name")
    .all();
  if (!active) return res.results.map((p) => ({ ...p, active: false }));
  const rosterRes = await db
    .prepare("SELECT player_id FROM season_rosters WHERE season_id = ?")
    .bind(active.id)
    .all();
  const activeSet = new Set(rosterRes.results.map((r) => r.player_id));
  return res.results.map((p) => ({ ...p, active: activeSet.has(p.id) }));
}

export async function getPlayerById(db, id) {
  const row = await db.prepare("SELECT * FROM players WHERE id = ?").bind(id).first();
  return row || null;
}

// ---- Career (all-seasons) aggregates ---------------------------------------

// Per-player career raw counts across ALL seasons, joined with name. Uses
// season_batting for seasons that have it and game_player_stats only for
// seasons that don't, so no season is double-counted (mirrors getPlayerCareerRaw).
export async function getCareerBattingWithPlayers(db) {
  const sumCols = (prefix = "") =>
    RAW_COUNT_COLS.map((c) => `SUM(${prefix}${c}) AS ${c}`).join(", ");

  const sb = await db
    .prepare(`SELECT player_id, ${sumCols()} FROM season_batting GROUP BY player_id`)
    .all();
  const gps = await db
    .prepare(
      `SELECT gps.player_id AS player_id, ${sumCols("gps.")}
       FROM game_player_stats gps
       JOIN games g ON g.id = gps.game_id
       JOIN season_leagues sl ON sl.id = g.season_league_id
       WHERE sl.season_id NOT IN (SELECT DISTINCT season_id FROM season_batting)
       GROUP BY gps.player_id`
    )
    .all();

  const byId = new Map();
  const add = (rows) => {
    for (const r of rows) {
      const cur = byId.get(r.player_id) || Object.fromEntries(RAW_COUNT_COLS.map((c) => [c, 0]));
      for (const c of RAW_COUNT_COLS) cur[c] += r[c] || 0;
      byId.set(r.player_id, cur);
    }
  };
  add(sb.results);
  add(gps.results);
  if (byId.size === 0) return [];

  // Fetch all players in one go (career spans ~every player; an IN(...) list
  // would blow D1's 100-bound-parameter limit).
  const all = await db.prepare("SELECT id, name, number FROM players").all();
  const nameById = new Map(all.results.map((p) => [p.id, p]));
  return [...byId.entries()].map(([player_id, counts]) => {
    const p = nameById.get(player_id);
    return { player_id, name: p ? p.name : "Unknown", number: p ? p.number : null, ...counts };
  });
}

export async function getTotalFinalGames(db) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM games WHERE status = 'final'").first();
  return row ? row.n : 0;
}
