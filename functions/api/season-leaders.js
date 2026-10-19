// GET /api/season-leaders — top-5 single-season batting performances per
// category, scanned across every season (not career totals, not one season).
import { json, serverError } from "../_lib/http.js";
import { getAllSeasonBattingWithPlayers } from "../_lib/db.js";
import { withRates, computeTopLeaders } from "../_lib/stats.js";

const CATS = [
  { key: "h" }, { key: "b2" }, { key: "b3" }, { key: "hr" },
  { key: "obp", rate: true }, { key: "slg", rate: true },
];

export async function onRequestGet({ env }) {
  try {
    const rows = await getAllSeasonBattingWithPlayers(env.DB, { realSeasonsOnly: true });
    const withStats = rows.map(withRates);
    const { leaders, minAB } = computeTopLeaders(withStats, CATS, 5);
    return json({ leaders, qualifyMinAB: Math.ceil(minAB) });
  } catch (err) {
    return serverError(err);
  }
}
