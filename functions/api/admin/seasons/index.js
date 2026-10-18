// /api/admin/seasons — GET list, POST create.
import { json, badRequest, serverError } from "../../../_lib/http.js";

const WRITABLE_FIELDS = ["name", "start_date", "end_date", "sort_order", "sps_season_id",
  "final_wins", "final_losses", "final_ties", "playoff_result", "photo_url", "recap"];

export async function onRequestGet({ env }) {
  try {
    const res = await env.DB.prepare("SELECT * FROM seasons ORDER BY sort_order DESC").all();
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

    const cols = Object.keys(fields);
    const placeholders = cols.map(() => "?").join(", ");
    const res = await env.DB
      .prepare(`INSERT INTO seasons (${cols.join(", ")}) VALUES (${placeholders})`)
      .bind(...cols.map((c) => fields[c]))
      .run();

    const id = res.meta.last_row_id;
    const row = await env.DB.prepare("SELECT * FROM seasons WHERE id = ?").bind(id).first();
    return json(row, 201);
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return badRequest("A season with that sps_season_id already exists.");
    }
    return serverError(err);
  }
}
