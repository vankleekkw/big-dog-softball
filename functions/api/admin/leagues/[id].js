// /api/admin/leagues/:id — PATCH partial update, DELETE.
import { json, badRequest, notFound, serverError, parseId } from "../../../_lib/http.js";

const WRITABLE_FIELDS = [
  "season_id",
  "league_label",
  "quickscores_org_dir",
  "quickscores_league_id",
  "quickscores_team_id",
];

export async function onRequestPatch({ request, env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid league id.");

    const body = await request.json().catch(() => ({}));
    const fields = {};
    for (const f of WRITABLE_FIELDS) if (f in body) fields[f] = body[f];
    if (Object.keys(fields).length === 0) return badRequest("No updatable fields provided.");

    const cols = Object.keys(fields);
    const setClause = cols.map((c) => `${c} = ?`).join(", ");
    const res = await env.DB
      .prepare(`UPDATE season_leagues SET ${setClause} WHERE id = ?`)
      .bind(...cols.map((c) => fields[c]), id)
      .run();
    if (res.meta.changes === 0) return notFound("League not found.");

    const row = await env.DB.prepare("SELECT * FROM season_leagues WHERE id = ?").bind(id).first();
    return json(row);
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid league id.");
    const res = await env.DB.prepare("DELETE FROM season_leagues WHERE id = ?").bind(id).run();
    if (res.meta.changes === 0) return notFound("League not found.");
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
