// GET /api/seasons — completed-seasons history table, most recent first.
import { json, serverError } from "../_lib/http.js";

export async function onRequestGet({ env }) {
  try {
    const res = await env.DB
      .prepare(
        `SELECT id, name, sort_order, final_wins, final_losses, final_ties, playoff_result
         FROM seasons
         WHERE final_wins IS NOT NULL OR final_losses IS NOT NULL OR final_ties IS NOT NULL
         ORDER BY sort_order DESC`
      )
      .all();
    return json(res.results);
  } catch (err) {
    return serverError(err);
  }
}
