// GET /api/players — roster. active = has a season_rosters row in the active season.
import { json, serverError } from "../../_lib/http.js";
import { listPlayersWithActiveFlag } from "../../_lib/db.js";

export async function onRequestGet({ env }) {
  try {
    const players = await listPlayersWithActiveFlag(env.DB);
    return json(players);
  } catch (err) {
    return serverError(err);
  }
}
