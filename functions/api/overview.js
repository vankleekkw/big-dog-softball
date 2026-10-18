// GET /api/overview — home-page payload for the active season.
import { json, serverError } from "../_lib/http.js";
import { getActiveSeason, getSeasonRecord, getCareerRecord, deriveResult } from "../_lib/db.js";

export async function onRequestGet({ env }) {
  try {
    const db = env.DB;
    const season = await getActiveSeason(db);
    if (!season) {
      return json({
        season: null,
        record: { wins: 0, losses: 0, ties: 0 },
        nextGame: null,
        lastGame: null,
        career: await getCareerRecord(db),
      });
    }

    const record = await getSeasonRecord(db, season.id);

    const nextGameRow = await db
      .prepare(
        `SELECT g.*, sl.league_label
         FROM games g JOIN season_leagues sl ON sl.id = g.season_league_id
         WHERE sl.season_id = ? AND g.status != 'final'
         ORDER BY g.date ASC, g.id ASC LIMIT 1`
      )
      .bind(season.id)
      .first();

    const lastGameRow = await db
      .prepare(
        `SELECT g.*, sl.league_label
         FROM games g JOIN season_leagues sl ON sl.id = g.season_league_id
         WHERE sl.season_id = ? AND g.status = 'final'
         ORDER BY g.date DESC, g.id DESC LIMIT 1`
      )
      .bind(season.id)
      .first();

    const nextGame = nextGameRow
      ? {
          date: nextGameRow.date,
          time: nextGameRow.time,
          field: nextGameRow.field,
          opponent: nextGameRow.opponent,
          league_label: nextGameRow.league_label,
        }
      : null;

    const lastGame = lastGameRow
      ? {
          date: lastGameRow.date,
          opponent: lastGameRow.opponent,
          our_score: lastGameRow.our_score,
          opp_score: lastGameRow.opp_score,
          result: deriveResult(lastGameRow),
        }
      : null;

    const career = await getCareerRecord(db);

    return json({
      season: {
        id: season.id, name: season.name, is_active: season.is_active,
        playoff_result: season.playoff_result,
      },
      record,
      nextGame,
      lastGame,
      career,
    });
  } catch (err) {
    return serverError(err);
  }
}
