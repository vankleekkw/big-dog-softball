// GET /api/schedule?season=active|<id> — both leagues combined, by date.
import { json, notFound, serverError } from "../_lib/http.js";
import { resolveSeason, deriveResult } from "../_lib/db.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const seasonParam = url.searchParams.get("season") || "active";
    const season = await resolveSeason(env.DB, seasonParam);
    if (!season) return notFound("Season not found.");

    const res = await env.DB
      .prepare(
        `SELECT g.id, g.date, g.time, g.field, g.opponent, g.our_score, g.opp_score, g.status,
                sl.league_label
         FROM games g JOIN season_leagues sl ON sl.id = g.season_league_id
         WHERE sl.season_id = ?
         ORDER BY g.date ASC, g.id ASC`
      )
      .bind(season.id)
      .all();

    const games = res.results.map((g) => ({
      id: g.id,
      league_label: g.league_label,
      date: g.date,
      time: g.time,
      field: g.field,
      opponent: g.opponent,
      our_score: g.our_score,
      opp_score: g.opp_score,
      status: g.status,
      result: deriveResult(g),
    }));

    return json({ season: { id: season.id, name: season.name }, games });
  } catch (err) {
    return serverError(err);
  }
}
