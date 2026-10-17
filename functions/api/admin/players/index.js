// /api/admin/players — GET list (incl. inactive), POST create.
import { json, badRequest, serverError } from "../../../_lib/http.js";

const WRITABLE_FIELDS = ["name", "number", "position", "bio_text", "photo_url", "is_main_player"];

export async function onRequestGet({ env }) {
  try {
    const res = await env.DB.prepare("SELECT * FROM players ORDER BY name").all();
    return json(res.results);
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return badRequest("`name` is required.");
    }

    const fields = {};
    for (const f of WRITABLE_FIELDS) if (f in body) fields[f] = body[f];
    fields.name = body.name.trim();
    fields.is_main_player = fields.is_main_player ? 1 : 0;

    const cols = Object.keys(fields);
    const placeholders = cols.map(() => "?").join(", ");
    const res = await env.DB
      .prepare(`INSERT INTO players (${cols.join(", ")}) VALUES (${placeholders})`)
      .bind(...cols.map((c) => fields[c]))
      .run();

    const id = res.meta.last_row_id;
    const row = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(id).first();
    return json(row, 201);
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return badRequest("A player with that name already exists.");
    }
    return serverError(err);
  }
}
