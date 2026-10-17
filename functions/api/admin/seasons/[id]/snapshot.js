// POST /api/admin/seasons/:id/snapshot — best-effort scrape of final record
// + playoff result from each of the season's QuickScores leagues. Returns a
// PREFILL object for the admin to confirm/edit; never auto-saves (the admin
// saves via PATCH /api/admin/seasons/:id). Degrades gracefully on failure:
// always 200 with whatever was found, plus a `notes` array of what failed.
import { json, badRequest, notFound, serverError, parseId } from "../../../../_lib/http.js";
import { parseStandingsAndSnapshot } from "../../../../_lib/quickscores.js";

export async function onRequestPost({ env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid season id.");

    const season = await env.DB.prepare("SELECT * FROM seasons WHERE id = ?").bind(id).first();
    if (!season) return notFound("Season not found.");

    const leaguesRes = await env.DB
      .prepare("SELECT * FROM season_leagues WHERE season_id = ?")
      .bind(id)
      .all();
    const leagues = leaguesRes.results;

    const notes = [];
    let wins = 0, losses = 0, ties = 0;
    let haveRecord = false;
    const playoffResults = [];

    const scrapable = leagues.filter((l) => l.quickscores_org_dir && l.quickscores_league_id);
    if (scrapable.length === 0) {
      notes.push("No season_leagues with QuickScores IDs configured for this season — nothing to scrape.");
    }

    for (const league of scrapable) {
      const url = `https://www.quickscores.com/Orgs/ResultsDisplay.php?OrgDir=${league.quickscores_org_dir}&LeagueID=${league.quickscores_league_id}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          notes.push(`${league.league_label || league.id}: HTTP ${res.status} fetching QuickScores.`);
          continue;
        }
        const html = await res.text();
        const parsed = parseStandingsAndSnapshot(html);
        if (parsed.wins == null) {
          notes.push(`${league.league_label || league.id}: couldn't find our team in the standings table.`);
        } else {
          wins += parsed.wins;
          losses += parsed.losses;
          ties += parsed.ties || 0;
          haveRecord = true;
        }
        if (parsed.playoff_result) playoffResults.push(parsed.playoff_result);
      } catch (err) {
        notes.push(`${league.league_label || league.id}: scrape failed (${err.message}).`);
      }
    }

    return json({
      final_wins: haveRecord ? wins : null,
      final_losses: haveRecord ? losses : null,
      final_ties: haveRecord ? ties : null,
      playoff_result: playoffResults.length ? playoffResults.join("; ") : null,
      notes,
    });
  } catch (err) {
    return serverError(err);
  }
}
