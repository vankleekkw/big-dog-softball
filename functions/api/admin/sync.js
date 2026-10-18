// POST /api/admin/sync — {season_id} -> fetch each of the season's QuickScores
// league pages, parse regular-season games (from the event list) AND playoff
// games (from the tournament bracket), upsert by (date + opponent) scoped to
// that league. Also refreshes the league's display name and playoff result.
// Returns {inserted, updated, errors:[...]}. Fetch/parse failures per league
// go into `errors` and never stop the other leagues.
import { json, badRequest, notFound, serverError } from "../../_lib/http.js";
import { parseResultsPage, parseBracket, parseLeagueName } from "../../_lib/quickscores.js";

function formatPlacement(p) {
  if (!p) return null;
  return p === "Champion" ? "Champions" : `${p} Place`;
}

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
    const scrapable = leaguesRes.results.filter(
      (l) => l.quickscores_org_dir && l.quickscores_league_id
    );

    let inserted = 0, updated = 0;
    const errors = [];
    if (scrapable.length === 0) {
      errors.push("No season_leagues with QuickScores IDs configured for this season.");
    }

    for (const league of scrapable) {
      const label = league.league_label || league.id;
      const url = `https://www.quickscores.com/Orgs/ResultsDisplay.php?OrgDir=${league.quickscores_org_dir}&LeagueID=${league.quickscores_league_id}`;
      let html;
      try {
        const res = await fetch(url);
        if (!res.ok) { errors.push(`${label}: HTTP ${res.status} fetching QuickScores.`); continue; }
        html = await res.text();
      } catch (err) {
        errors.push(`${label}: fetch failed (${err.message}).`); continue;
      }

      let regular, bracket;
      try {
        regular = parseResultsPage(html);
        bracket = parseBracket(html);
      } catch (err) {
        errors.push(`${label}: parse failed (${err.message}).`); continue;
      }
      if (regular.length === 0 && bracket.games.length === 0) {
        errors.push(`${label}: parsed 0 games from QuickScores — check the page.`); continue;
      }

      // Refresh league display name (full QS name, e.g. "Wednesday Rec 3") and
      // this league's playoff finish.
      const qsName = parseLeagueName(html);
      await env.DB
        .prepare("UPDATE season_leagues SET league_label = COALESCE(?, league_label), playoff_result = ? WHERE id = ?")
        .bind(qsName, formatPlacement(bracket.placement), league.id)
        .run();

      const all = [
        ...regular.map((g) => ({ ...g, is_playoff: 0, playoff_round: null })),
        ...bracket.games,
      ];
      for (const g of all) {
        try {
          const existing = await env.DB
            .prepare("SELECT id FROM games WHERE season_league_id = ? AND date = ? AND opponent = ?")
            .bind(league.id, g.date, g.opponent)
            .first();
          if (existing) {
            await env.DB
              .prepare(
                `UPDATE games SET time=?, field=?, our_score=?, opp_score=?, status=?,
                 is_playoff=?, playoff_round=? WHERE id = ?`
              )
              .bind(g.time, g.field, g.our_score, g.opp_score, g.status,
                    g.is_playoff, g.playoff_round, existing.id)
              .run();
            updated++;
          } else {
            await env.DB
              .prepare(
                `INSERT INTO games (season_league_id, date, time, field, opponent,
                 our_score, opp_score, status, is_playoff, playoff_round)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .bind(league.id, g.date, g.time, g.field, g.opponent, g.our_score,
                    g.opp_score, g.status, g.is_playoff, g.playoff_round)
              .run();
            inserted++;
          }
        } catch (err) {
          errors.push(`${label} ${g.date} vs ${g.opponent}: ${err.message}`);
        }
      }
    }

    return json({ inserted, updated, errors });
  } catch (err) {
    return serverError(err);
  }
}
