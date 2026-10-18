// GET /api/stats?season=active|<id> — team totals + per-player batting + leaders.
import { json, notFound, serverError } from "../_lib/http.js";
import { resolveSeason, getSeasonBattingWithPlayers } from "../_lib/db.js";
import { sumCounts, withRates } from "../_lib/stats.js";

const LEADER_MIN_AB = 10;

function pickLeader(players, key) {
  const eligible = players.filter((p) => (p.ab || 0) >= LEADER_MIN_AB);
  if (eligible.length === 0) return null;
  let best = eligible[0];
  for (const p of eligible) {
    if ((p[key] || 0) > (best[key] || 0)) best = p;
  }
  return { player_id: best.player_id, name: best.name, value: best[key] || 0 };
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const seasonParam = url.searchParams.get("season") || "active";
    const season = await resolveSeason(env.DB, seasonParam);
    if (!season) return notFound("Season not found.");

    const rawRows = await getSeasonBattingWithPlayers(env.DB, season.id);
    const players = rawRows.map((r) => withRates(r));
    const team = withRates(sumCounts(rawRows));
    // team.gp from summing player rows = player-appearances, not games played.
    // Override with the actual count of completed team games this season.
    const gamesRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM games g
       JOIN season_leagues sl ON sl.id = g.season_league_id
       WHERE sl.season_id = ? AND g.status = 'final'`
    ).bind(season.id).first();
    team.gp = gamesRow ? gamesRow.n : team.gp;

    const leaders = {
      avg: pickLeader(players, "avg"),
      hr: pickLeader(players, "hr"),
      rbi: pickLeader(players, "rbi"),
      h: pickLeader(players, "h"),
    };

    return json({
      season: { id: season.id, name: season.name },
      team,
      players,
      leaders,
    });
  } catch (err) {
    return serverError(err);
  }
}
