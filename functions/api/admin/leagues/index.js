// /api/admin/leagues — season_leagues CRUD. GET list (optionally
// ?season_id=), POST create.
import { json, badRequest, serverError } from "../../../_lib/http.js";

const WRITABLE_FIELDS = [
  "season_id",
  "league_label",
  "quickscores_org_dir",
  "quickscores_league_id",
  "quickscores_team_id",
];

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const seasonId = url.searchParams.get("season_id");
    const res = seasonId
      ? await env.DB.prepare("SELECT * FROM season_leagues WHERE season_id = ?").bind(Number(seasonId)).all()
      : await env.DB.prepare("SELECT * FROM season_leagues ORDER BY season_id DESC").all();
    return json(res.results);
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!Number.isInteger(Number(body.season_id)) || !body.league_label) {
      return badRequest("`season_id` and `league_label` are required.");
    }

    const fields = {};
    for (const f of WRITABLE_FIELDS) if (f in body) fields[f] = body[f];
    fields.season_id = Number(body.season_id);

    const cols = Object.keys(fields);
    const placeholders = cols.map(() => "?").join(", ");
    const res = await env.DB
      .prepare(`INSERT INTO season_leagues (${cols.join(", ")}) VALUES (${placeholders})`)
      .bind(...cols.map((c) => fields[c]))
      .run();

    const id = res.meta.last_row_id;
    const row = await env.DB.prepare("SELECT * FROM season_leagues WHERE id = ?").bind(id).first();
    return json(row, 201);
  } catch (err) {
    return serverError(err);
  }
}
