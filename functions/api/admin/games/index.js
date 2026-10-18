// /api/admin/games — games CRUD. GET list (optionally ?season_league_id= or
// ?season_id=), POST create.
import { json, badRequest, serverError } from "../../../_lib/http.js";

const WRITABLE_FIELDS = ["season_league_id", "date", "time", "field", "opponent", "our_score", "opp_score", "status", "photo_url", "photo_caption"];

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const seasonLeagueId = url.searchParams.get("season_league_id");
    const seasonId = url.searchParams.get("season_id");

    let res;
    if (seasonLeagueId) {
      res = await env.DB
        .prepare("SELECT * FROM games WHERE season_league_id = ? ORDER BY date ASC, id ASC")
        .bind(Number(seasonLeagueId))
        .all();
    } else if (seasonId) {
      res = await env.DB
        .prepare(
          `SELECT g.* FROM games g JOIN season_leagues sl ON sl.id = g.season_league_id
           WHERE sl.season_id = ? ORDER BY g.date ASC, g.id ASC`
        )
        .bind(Number(seasonId))
        .all();
    } else {
      res = await env.DB.prepare("SELECT * FROM games ORDER BY date DESC, id DESC").all();
    }
    return json(res.results);
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!Number.isInteger(Number(body.season_league_id))) {
      return badRequest("`season_league_id` is required.");
    }

    const fields = {};
    for (const f of WRITABLE_FIELDS) if (f in body) fields[f] = body[f];
    fields.season_league_id = Number(body.season_league_id);
    if (!fields.status) fields.status = "scheduled";

    const cols = Object.keys(fields);
    const placeholders = cols.map(() => "?").join(", ");
    const res = await env.DB
      .prepare(`INSERT INTO games (${cols.join(", ")}) VALUES (${placeholders})`)
      .bind(...cols.map((c) => fields[c]))
      .run();

    const id = res.meta.last_row_id;
    const row = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(id).first();
    return json(row, 201);
  } catch (err) {
    return serverError(err);
  }
}
