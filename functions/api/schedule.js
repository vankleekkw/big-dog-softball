// GET /api/schedule?season=active|<id> — games (regular + playoff) for the
// season, plus per-league metadata (full QS name, QuickScores link, playoff result).
import { json, notFound, serverError } from "../_lib/http.js";
import { resolveSeason, getSeasonLeagues, deriveResult } from "../_lib/db.js";

function qsUrl(l) {
  return l.quickscores_org_dir && l.quickscores_league_id
    ? `https://www.quickscores.com/Orgs/ResultsDisplay.php?OrgDir=${l.quickscores_org_dir}&LeagueID=${l.quickscores_league_id}`
    : null;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const season = await resolveSeason(env.DB, url.searchParams.get("season") || "active");
    if (!season) return notFound("Season not found.");

    const leaguesRaw = await getSeasonLeagues(env.DB, season.id);
    const leagues = leaguesRaw.map((l) => ({
      id: l.id,
      label: l.league_label,
      playoff_result: l.playoff_result,
      quickscores_url: qsUrl(l),
    }));

    const res = await env.DB
      .prepare(
        `SELECT g.id, g.season_league_id, g.date, g.time, g.field, g.opponent,
                g.our_score, g.opp_score, g.status, g.is_playoff, g.playoff_round,
                sl.league_label
         FROM games g JOIN season_leagues sl ON sl.id = g.season_league_id
         WHERE sl.season_id = ?
         ORDER BY g.is_playoff ASC, g.date ASC, g.id ASC`
      )
      .bind(season.id)
      .all();

    const games = res.results.map((g) => ({
      id: g.id,
      league_id: g.season_league_id,
      league_label: g.league_label,
      date: g.date,
      time: g.time,
      field: g.field,
      opponent: g.opponent,
      our_score: g.our_score,
      opp_score: g.opp_score,
      status: g.status,
      is_playoff: !!g.is_playoff,
      playoff_round: g.playoff_round,
      result: deriveResult(g),
    }));

    return json({ season: { id: season.id, name: season.name }, leagues, games });
  } catch (err) {
    return serverError(err);
  }
}
