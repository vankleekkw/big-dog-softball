// POST /api/admin/sync — {season_id} -> fetch each of the season's
// QuickScores league pages, parse games, upsert by (date + opponent) scoped
// to that league. Returns {inserted, updated, errors:[...]}. Parse/fetch
// failures are pushed into `errors` and never silently swallowed — a league
// that fails doesn't stop the others from syncing.
import { json, badRequest, notFound, serverError } from "../../_lib/http.js";
import { parseResultsPage } from "../../_lib/quickscores.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const seasonId = Number(body.season_id);
    if (!Number.isInteger(seasonId)) return badRequest("`season_id` is required.");

    const season = await env.DB.prepare("SELECT id FROM seasons WHERE id = ?").bind(seasonId).first();
    if (!season) return notFound("Season not found.");

    const leaguesRes = await env.DB
      .prepare("SELECT * FROM season_leagues WHERE season_id = ?")
      .bind(seasonId)
      .all();
    const leagues = leaguesRes.results;

    let inserted = 0, updated = 0;
    const errors = [];

    const scrapable = leagues.filter((l) => l.quickscores_org_dir && l.quickscores_league_id);
    if (scrapable.length === 0) {
      errors.push("No season_leagues with QuickScores IDs configured for this season.");
    }

    for (const league of scrapable) {
      const url = `https://www.quickscores.com/Orgs/ResultsDisplay.php?OrgDir=${league.quickscores_org_dir}&LeagueID=${league.quickscores_league_id}`;
      let html;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          errors.push(`${league.league_label || league.id}: HTTP ${res.status} fetching QuickScores.`);
          continue;
        }
        html = await res.text();
      } catch (err) {
        errors.push(`${league.league_label || league.id}: fetch failed (${err.message}).`);
        continue;
      }

      let games;
      try {
        games = parseResultsPage(html);
      } catch (err) {
        errors.push(`${league.league_label || league.id}: parse failed (${err.message}).`);
        continue;
      }
      if (games.length === 0) {
        errors.push(`${league.league_label || league.id}: parsed 0 games from QuickScores — check the page/regex.`);
        continue;
      }

      for (const g of games) {
        try {
          const existing = await env.DB
            .prepare(
              "SELECT id FROM games WHERE season_league_id = ? AND date = ? AND opponent = ?"
            )
            .bind(league.id, g.date, g.opponent)
            .first();

          if (existing) {
            await env.DB
              .prepare(
                `UPDATE games SET time = ?, field = ?, our_score = ?, opp_score = ?, status = ?
                 WHERE id = ?`
              )
              .bind(g.time, g.field, g.our_score, g.opp_score, g.status, existing.id)
              .run();
            updated++;
          } else {
            await env.DB
              .prepare(
                `INSERT INTO games (season_league_id, date, time, field, opponent, our_score, opp_score, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .bind(league.id, g.date, g.time, g.field, g.opponent, g.our_score, g.opp_score, g.status)
              .run();
            inserted++;
          }
        } catch (err) {
          errors.push(`${league.league_label || league.id} ${g.date} vs ${g.opponent}: ${err.message}`);
        }
      }
    }

    return json({ inserted, updated, errors });
  } catch (err) {
    return serverError(err);
  }
}
