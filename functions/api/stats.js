// GET /api/stats?season=active|career|<id>
// Team totals + per-player batting (raw + derived) + qualified leaders.
import { json, notFound, serverError } from "../_lib/http.js";
import {
  resolveSeason, getSeasonBattingWithPlayers, getCareerBattingWithPlayers, getTotalFinalGames,
} from "../_lib/db.js";
import { sumCounts, withRates, computeLeaders } from "../_lib/stats.js";

// Leader categories. rate:true ones get the relative-AB qualifier.
const LEADER_CATS = [
  { key: "avg", rate: true }, { key: "obp", rate: true },
  { key: "slg", rate: true }, { key: "ops", rate: true },
  { key: "hr" }, { key: "h" }, { key: "r" }, { key: "ab" },
  { key: "b2" }, { key: "b3" },
];
const QUALIFY_PCT = 0.5; // must have >= 50% of the top AB to make a rate leaderboard

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const seasonParam = url.searchParams.get("season") || "active";

    let rawRows, seasonMeta, teamGames;
    if (seasonParam === "career") {
      rawRows = await getCareerBattingWithPlayers(env.DB);
      seasonMeta = { id: "career", name: "Career · All-Time" };
      teamGames = await getTotalFinalGames(env.DB);
    } else {
      const season = await resolveSeason(env.DB, seasonParam);
      if (!season) return notFound("Season not found.");
      rawRows = await getSeasonBattingWithPlayers(env.DB, season.id);
      seasonMeta = { id: season.id, name: season.name };
      const g = await env.DB
        .prepare(
          `SELECT COUNT(*) AS n FROM games g
           JOIN season_leagues sl ON sl.id = g.season_league_id
           WHERE sl.season_id = ? AND g.status = 'final'`
        )
        .bind(season.id)
        .first();
      teamGames = g ? g.n : 0;
    }

    const players = rawRows.map((r) => withRates(r));
    const team = withRates(sumCounts(rawRows));
    team.gp = teamGames; // games played, not summed player appearances

    const { leaders, minAB } = computeLeaders(players, LEADER_CATS, QUALIFY_PCT);

    return json({ season: seasonMeta, team, players, leaders, qualifyMinAB: Math.ceil(minAB) });
  } catch (err) {
    return serverError(err);
  }
}
