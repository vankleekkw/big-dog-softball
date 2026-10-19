// Derived softball stats — SERVER copy. Keep in sync with public/js/stats.js.
// Only raw counts are stored; rates are computed from them here.

// Sum an array of raw-count rows into one totals object.
export function sumCounts(rows) {
  const keys = ["gp", "ab", "r", "h", "b1", "b2", "b3", "hr", "bb", "rbi", "so", "sac", "sb"];
  const t = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const row of rows) for (const k of keys) t[k] += row[k] || 0;
  return t;
}

// Total bases. Falls back to deriving singles from H when b1 is absent/zero.
export function totalBases(s) {
  const singles = s.b1 || Math.max(0, (s.h || 0) - (s.b2 || 0) - (s.b3 || 0) - (s.hr || 0));
  return singles + 2 * (s.b2 || 0) + 3 * (s.b3 || 0) + 4 * (s.hr || 0);
}

// Leaderboard with a RELATIVE at-bats qualifier: to appear in a RATE-stat
// leaderboard (avg/obp/slg/ops) a player must have at least `qualifyPct` of the
// season's/career's top AB total (so a 2-for-2 doesn't lead the batting title).
// Counting-stat leaders (hr, h, ab, b2, b3, r) are not AB-qualified.
// `cats` is an array of { key, rate? }. Returns { leaders, minAB }.
export function computeLeaders(players, cats, qualifyPct = 0.5) {
  const maxAB = players.reduce((m, p) => Math.max(m, p.ab || 0), 0);
  const minAB = maxAB * qualifyPct;
  const leaders = {};
  for (const c of cats) {
    const pool = c.rate ? players.filter((p) => (p.ab || 0) >= minAB && (p.ab || 0) > 0) : players;
    let best = null;
    for (const p of pool) {
      const v = Number(p[c.key] || 0);
      if (!best || v > best.value) best = { player_id: p.player_id, name: p.name, value: v };
    }
    if (best) leaders[c.key] = best;
  }
  return { leaders, minAB };
}

// Same AB-qualifier rule as computeLeaders, but returns the top N rows per
// category instead of just the best one. Built for single-season (not career)
// leaderboards, where `players` is one row per player-per-season — each row
// needs a `season_name` the caller wants surfaced alongside the value.
export function computeTopLeaders(players, cats, n = 5, qualifyPct = 0.5) {
  const maxAB = players.reduce((m, p) => Math.max(m, p.ab || 0), 0);
  const minAB = maxAB * qualifyPct;
  const leaders = {};
  for (const c of cats) {
    const pool = c.rate ? players.filter((p) => (p.ab || 0) >= minAB && (p.ab || 0) > 0) : players;
    leaders[c.key] = [...pool]
      .sort((a, b) => Number(b[c.key] || 0) - Number(a[c.key] || 0))
      .slice(0, n)
      .map((p) => ({
        player_id: p.player_id, name: p.name,
        season_id: p.season_id, season_name: p.season_name,
        value: Number(p[c.key] || 0),
      }));
  }
  return { leaders, minAB };
}

// Attach avg/slg/obp/ops (numbers, 0 when undefined). Returns a NEW object.
export function withRates(s) {
  const ab = s.ab || 0, bb = s.bb || 0, sac = s.sac || 0, h = s.h || 0;
  const tb = totalBases(s);
  const obDen = ab + bb + sac;
  const avg = ab ? h / ab : 0;
  const slg = ab ? tb / ab : 0;
  const obp = obDen ? (h + bb + sac) / obDen : 0;
  return { ...s, tb, avg, slg, obp, ops: obp + slg };
}
