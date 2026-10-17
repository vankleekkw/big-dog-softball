// /api/admin/game-stats — GET existing rows for ?game_id= (not in docs/API.md
// but needed by the admin UI to prefill the stat-entry grid when reopening a
// game; additive, same resource path as the documented POST), POST upsert
// {game_id, player_id, ...rawcounts}.
import { json, badRequest, serverError } from "../../_lib/http.js";

const COUNT_FIELDS = ["gp", "ab", "r", "h", "b1", "b2", "b3", "hr", "bb", "rbi", "so", "sac", "sb"];

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const gameId = Number(url.searchParams.get("game_id"));
    if (!Number.isInteger(gameId)) return badRequest("`game_id` query param is required.");

    const res = await env.DB
      .prepare("SELECT * FROM game_player_stats WHERE game_id = ?")
      .bind(gameId)
      .all();
    return json(res.results);
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const gameId = Number(body.game_id);
    const playerId = Number(body.player_id);
    if (!Number.isInteger(gameId) || !Number.isInteger(playerId)) {
      return badRequest("`game_id` and `player_id` are required.");
    }

    const counts = {};
    for (const f of COUNT_FIELDS) counts[f] = Number.isFinite(Number(body[f])) ? Number(body[f]) : 0;

    const cols = ["game_id", "player_id", ...COUNT_FIELDS];
    const placeholders = cols.map(() => "?").join(", ");
    const updates = COUNT_FIELDS.map((c) => `${c} = excluded.${c}`).join(", ");

    await env.DB
      .prepare(
        `INSERT INTO game_player_stats (${cols.join(", ")}) VALUES (${placeholders})
         ON CONFLICT(game_id, player_id) DO UPDATE SET ${updates}`
      )
      .bind(gameId, playerId, ...COUNT_FIELDS.map((c) => counts[c]))
      .run();

    const row = await env.DB
      .prepare("SELECT * FROM game_player_stats WHERE game_id = ? AND player_id = ?")
      .bind(gameId, playerId)
      .first();
    return json(row);
  } catch (err) {
    return serverError(err);
  }
}
