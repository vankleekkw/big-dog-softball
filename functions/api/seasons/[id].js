// GET /api/seasons/:id — season detail: meta (photo/recap/record) + its games.
import { json, notFound, serverError } from "../../_lib/http.js";
import { getSeasonById, getSeasonRecord, deriveResult } from "../../_lib/db.js";

export async function onRequestGet({ params, env }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) return notFound("Season not found.");
    const season = await getSeasonById(env.DB, id);
    if (!season) return notFound("Season not found.");

    const res = await env.DB
      .prepare(
        `SELECT g.id, g.date, g.time, g.field, g.opponent, g.our_score, g.opp_score, g.status,
                sl.league_label
         FROM games g JOIN season_leagues sl ON sl.id = g.season_league_id
         WHERE sl.season_id = ?
         ORDER BY g.date ASC, g.id ASC`
      )
      .bind(id)
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

    // Record: prefer the stored season-close snapshot; else derive live.
    const record =
      season.final_wins != null
        ? { wins: season.final_wins, losses: season.final_losses, ties: season.final_ties }
        : await getSeasonRecord(env.DB, id);

    return json({
      season: {
        id: season.id,
        name: season.name,
        final_wins: season.final_wins,
        final_losses: season.final_losses,
        final_ties: season.final_ties,
        playoff_result: season.playoff_result,
        photo_url: season.photo_url,
        recap: season.recap,
        sort_order: season.sort_order,
        is_active: season.is_active,
      },
      record,
      games,
    });
  } catch (err) {
    return serverError(err);
  }
}
