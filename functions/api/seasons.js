// GET /api/seasons — season-by-season history, most recent first. Includes the
// current season (its record derived live from games, since it isn't finalized).
import { json, serverError } from "../_lib/http.js";
import { listSeasons, getSeasonRecord } from "../_lib/db.js";

export async function onRequestGet({ env }) {
  try {
    const seasons = await listSeasons(env.DB); // all seasons, sort_order desc
    const out = [];
    for (const s of seasons) {
      const finalized =
        s.final_wins != null || s.final_losses != null || s.final_ties != null;
      let wins = s.final_wins, losses = s.final_losses, ties = s.final_ties;
      if (!finalized) {
        const live = await getSeasonRecord(env.DB, s.id);
        wins = live.wins; losses = live.losses; ties = live.ties;
      }
      out.push({
        id: s.id,
        name: s.name,
        sort_order: s.sort_order,
        is_active: s.is_active,
        final_wins: wins,
        final_losses: losses,
        final_ties: ties,
        playoff_result: s.playoff_result,
      });
    }
    return json(out);
  } catch (err) {
    return serverError(err);
  }
}
