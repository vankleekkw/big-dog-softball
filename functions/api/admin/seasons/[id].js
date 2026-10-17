// /api/admin/seasons/:id — PATCH partial update (is_active:true activates,
// clearing any other active season atomically), DELETE.
import { json, badRequest, notFound, serverError, parseId } from "../../../_lib/http.js";
import { setActiveSeason } from "../../../_lib/db.js";

const WRITABLE_FIELDS = [
  "name",
  "start_date",
  "end_date",
  "final_wins",
  "final_losses",
  "final_ties",
  "playoff_result",
  "sort_order",
  "sps_season_id",
];

export async function onRequestPatch({ request, env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid season id.");

    const body = await request.json().catch(() => ({}));
    const existing = await env.DB.prepare("SELECT id FROM seasons WHERE id = ?").bind(id).first();
    if (!existing) return notFound("Season not found.");

    const fields = {};
    for (const f of WRITABLE_FIELDS) if (f in body) fields[f] = body[f];
    const cols = Object.keys(fields);

    if (body.is_active === true) {
      // Atomic: clear any currently-active season, then set this one active
      // (plus any other field changes) in a single D1 batch/transaction so
      // the partial unique index (idx_seasons_one_active) never sees two
      // is_active=1 rows at once.
      const extraSetSql = cols.length ? cols.map((c) => `${c} = ?`).join(", ") : "";
      await setActiveSeason(env.DB, id, extraSetSql, cols.map((c) => fields[c]));
    } else if (cols.length > 0 || body.is_active === false) {
      const setFields = { ...fields };
      if (body.is_active === false) setFields.is_active = 0;
      const setCols = Object.keys(setFields);
      const setClause = setCols.map((c) => `${c} = ?`).join(", ");
      await env.DB
        .prepare(`UPDATE seasons SET ${setClause} WHERE id = ?`)
        .bind(...setCols.map((c) => setFields[c]), id)
        .run();
    } else {
      return badRequest("No updatable fields provided.");
    }

    const row = await env.DB.prepare("SELECT * FROM seasons WHERE id = ?").bind(id).first();
    return json(row);
  } catch (err) {
    return serverError(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid season id.");
    const res = await env.DB.prepare("DELETE FROM seasons WHERE id = ?").bind(id).run();
    if (res.meta.changes === 0) return notFound("Season not found.");
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
