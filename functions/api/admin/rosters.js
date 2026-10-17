// /api/admin/rosters — GET membership for ?season_id= (not in docs/API.md but
// needed by the admin UI to render current roster checkboxes; additive, same
// resource path as the documented POST/DELETE), POST add {season_id, player_id},
// DELETE remove.
import { json, badRequest, serverError } from "../../_lib/http.js";

function parseBody(body) {
  const seasonId = Number(body.season_id);
  const playerId = Number(body.player_id);
  if (!Number.isInteger(seasonId) || !Number.isInteger(playerId)) return null;
  return { seasonId, playerId };
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const seasonId = Number(url.searchParams.get("season_id"));
    if (!Number.isInteger(seasonId)) return badRequest("`season_id` query param is required.");

    const res = await env.DB
      .prepare("SELECT player_id FROM season_rosters WHERE season_id = ?")
      .bind(seasonId)
      .all();
    return json(res.results.map((r) => r.player_id));
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseBody(body);
    if (!parsed) return badRequest("`season_id` and `player_id` are required.");

    await env.DB
      .prepare("INSERT OR IGNORE INTO season_rosters (season_id, player_id) VALUES (?, ?)")
      .bind(parsed.seasonId, parsed.playerId)
      .run();
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseBody(body);
    if (!parsed) return badRequest("`season_id` and `player_id` are required.");

    await env.DB
      .prepare("DELETE FROM season_rosters WHERE season_id = ? AND player_id = ?")
      .bind(parsed.seasonId, parsed.playerId)
      .run();
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
