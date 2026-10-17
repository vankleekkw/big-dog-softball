// GET /api/players/:id — player detail (Baseball-Reference style).
import { json, notFound, badRequest, serverError } from "../../_lib/http.js";
import { getPlayerById, getPlayerSeasonRows, getPlayerCareerRaw } from "../../_lib/db.js";
import { withRates } from "../../_lib/stats.js";

export async function onRequestGet({ env, params }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) return badRequest("Invalid player id.");

    const player = await getPlayerById(env.DB, id);
    if (!player) return notFound("Player not found.");

    const seasonRows = await getPlayerSeasonRows(env.DB, id);
    const seasons = seasonRows.map((r) => {
      const { sort_order, ...rest } = r;
      return withRates(rest);
    });

    const careerRaw = await getPlayerCareerRaw(env.DB, id);
    const career = withRates(careerRaw);

    return json({ player, seasons, career });
  } catch (err) {
    return serverError(err);
  }
}
