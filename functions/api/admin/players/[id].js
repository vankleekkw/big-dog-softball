// /api/admin/players/:id — PATCH partial update, DELETE.
import { json, badRequest, notFound, serverError, parseId } from "../../../_lib/http.js";

const WRITABLE_FIELDS = ["name", "number", "position", "bio_text", "photo_url", "is_main_player"];

export async function onRequestPatch({ request, env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid player id.");

    const body = await request.json().catch(() => ({}));
    const fields = {};
    for (const f of WRITABLE_FIELDS) if (f in body) fields[f] = body[f];
    if (Object.keys(fields).length === 0) return badRequest("No updatable fields provided.");
    if ("is_main_player" in fields) fields.is_main_player = fields.is_main_player ? 1 : 0;
    if ("name" in fields) {
      if (typeof fields.name !== "string" || !fields.name.trim()) {
        return badRequest("`name` cannot be empty.");
      }
      fields.name = fields.name.trim();
    }

    const cols = Object.keys(fields);
    const setClause = cols.map((c) => `${c} = ?`).join(", ");
    const res = await env.DB
      .prepare(`UPDATE players SET ${setClause} WHERE id = ?`)
      .bind(...cols.map((c) => fields[c]), id)
      .run();
    if (res.meta.changes === 0) return notFound("Player not found.");

    const row = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(id).first();
    return json(row);
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return badRequest("A player with that name already exists.");
    }
    return serverError(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid player id.");
    const res = await env.DB.prepare("DELETE FROM players WHERE id = ?").bind(id).run();
    if (res.meta.changes === 0) return notFound("Player not found.");
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
