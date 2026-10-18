// GET /api/season-list — every season (incl. active), newest first, for the
// season picker on the schedule/stats pages.
import { json, serverError } from "../_lib/http.js";
import { listSeasons } from "../_lib/db.js";

export async function onRequestGet({ env }) {
  try {
    const seasons = await listSeasons(env.DB);
    return json(
      seasons.map((s) => ({
        id: s.id,
        name: s.name,
        is_active: s.is_active,
        sort_order: s.sort_order,
      }))
    );
  } catch (err) {
    return serverError(err);
  }
}
