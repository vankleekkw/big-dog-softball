// /api/admin/games/:id — PATCH partial update, DELETE.
import { json, badRequest, notFound, serverError, parseId } from "../../../_lib/http.js";

const WRITABLE_FIELDS = ["season_league_id", "date", "time", "field", "opponent", "our_score", "opp_score", "status"];

export async function onRequestPatch({ request, env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid game id.");

    const body = await request.json().catch(() => ({}));
    const fields = {};
    for (const f of WRITABLE_FIELDS) if (f in body) fields[f] = body[f];
    if (Object.keys(fields).length === 0) return badRequest("No updatable fields provided.");

    const cols = Object.keys(fields);
    const setClause = cols.map((c) => `${c} = ?`).join(", ");
    const res = await env.DB
      .prepare(`UPDATE games SET ${setClause} WHERE id = ?`)
      .bind(...cols.map((c) => fields[c]), id)
      .run();
    if (res.meta.changes === 0) return notFound("Game not found.");

    const row = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(id).first();
    return json(row);
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid game id.");
    const res = await env.DB.prepare("DELETE FROM games WHERE id = ?").bind(id).run();
    if (res.meta.changes === 0) return notFound("Game not found.");
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
