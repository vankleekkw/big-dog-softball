// QuickScores ResultsDisplay.php parser.
//
// scrape.py's scrape_quickscores() regex (matching "Big Dog Gotta Eat (A) 19
// vs. Chunichi Dragons (H) 5") was explicitly unvalidated against a live page
// -- its own comment says "Validate against a live page on first run and
// tighten the regex if needed." Fetching a real ResultsDisplay.php page
// confirmed that format does not exist in the actual markup: there is no
// "(A)"/"(H)"/"vs." text anywhere. The real per-game markup (confirmed
// against a live page) looks like:
//
//   <li class="event" id="76276132" ...><div class="GameDetails ">
//     <div class="cell date"><span class="e-day">Wed</span><time class="e-date">Aug 19</time></div>
//     <div class="cell local "><time class="e-time local-info" datetime="2026-08-19T18:30">
//       ...svg...<span>6:30 PM</span></time>
//       <span class="e-local local-info">...svg...
//         <a href="/Orgs/LocationDetails.php?...">Melas #1</a></span></div>
//     <div class="cell teams more-width">
//       <div class="team clearfix">
//         <span class="team-name bolder notranslate">A: <a ...>Big Dog Gotta Eat</a></span>
//         <div class="team-record digits2"><span class="bolder">19</span></div>
//       </div>
//       <div class="team clearfix">
//         <span class="team-name  notranslate">H: <a ...>Chunichi Dragons</a></span>
//         <div class="team-record digits2"><span class="">5</span></div>
//       </div>
//     </div>
//   </div></li>
//
// This parser works directly off that markup. Each <li class="event" ...>
// block is self-contained (we split on the opening tag), so per-block regexes
// are safe even though the HTML inside has no balanced-tag parsing.

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

// Parse a ResultsDisplay.php page into a list of games involving `teamMatch`
// (default "Big Dog", case-insensitive substring match against team names).
// Returns [{date, time, field, opponent, our_score, opp_score, status}].
export function parseResultsPage(html, teamMatch = "big dog") {
  const games = [];
  // Event <li>s can carry extra classes, e.g. <li class="event Highlight"> for
  // continuations/special games. Splitting on the bare `<li class="event"`
  // string silently swallowed those (dropping the game), so match any class list.
  const blocks = html.split(/<li class="event[^"]*"/);
  const needle = teamMatch.toLowerCase();

  for (const block of blocks.slice(1)) {
    const dateM = block.match(/datetime="(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}"/);
    const timeM = block.match(/<span>([\d: ]*[AP]M)<\/span>/);
    const fieldM = block.match(/LocationDetails\.php[^"]*"[^>]*>([^<]+)<\/a>/);
    const awayM = block.match(
      /A:\s*<a[^>]*>([^<]+)<\/a>\s*<\/span>\s*<div class="team-record[^"]*">\s*<span[^>]*>(\d*)<\/span>/
    );
    const homeM = block.match(
      /H:\s*<a[^>]*>([^<]+)<\/a>\s*<\/span>\s*<div class="team-record[^"]*">\s*<span[^>]*>(\d*)<\/span>/
    );
    if (!dateM || !awayM || !homeM) continue; // malformed/unrecognized block; skip, surfaced by caller via count mismatch

    const away = decodeEntities(awayM[1]);
    const home = decodeEntities(homeM[1]);
    const awayScore = awayM[2] === "" ? null : Number(awayM[2]);
    const homeScore = homeM[2] === "" ? null : Number(homeM[2]);

    let opponent, ourScore, oppScore;
    if (away.toLowerCase().includes(needle)) {
      opponent = home;
      ourScore = awayScore;
      oppScore = homeScore;
    } else if (home.toLowerCase().includes(needle)) {
      opponent = away;
      ourScore = homeScore;
      oppScore = awayScore;
    } else {
      continue; // game doesn't involve our team
    }

    games.push({
      date: dateM[1],
      time: timeM ? timeM[1].trim() : null,
      field: fieldM ? decodeEntities(fieldM[1]) : null,
      opponent,
      our_score: ourScore,
      opp_score: oppScore,
      status: ourScore != null && oppScore != null ? "final" : "scheduled",
    });
  }

  return games;
}

// League display name from the page <h1>, e.g. "Wednesday Rec 3".
export function parseLeagueName(html) {
  const m = html.match(/<h1>([^<]+)<\/h1>/);
  return m ? decodeEntities(m[1]) : null;
}

function bracketDateToISO(s) {
  const m = (s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = m[3];
  if (y.length === 2) y = "20" + y;
  return `${y}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
}

// Parse the <table id="TournamentBracket"> playoff bracket. The bracket is keyed
// by game id: `Game_<gid>` holds meta (Game #, date, time, field), and the two
// `*Team_<gid>` cells hold "[seed] TeamName" + score. Returns
// { games:[{date,time,field,opponent,our_score,opp_score,status,is_playoff,
// playoff_round}], placement } for the team. placement is "Champion"/"2nd"/...
export function parseBracket(html, teamMatch = "big dog") {
  const needle = teamMatch.toLowerCase();
  // The bracket is a deeply-nested table, so isolating it by a single
  // <table>…</table> match truncates it. The Game_/*Team_ anchor ids and the
  // paddingLeft10 score spans are bracket-unique, so parse off the whole doc,
  // gated on the bracket existing at all.
  if (!/id="TournamentBracket"/.test(html)) return { games: [], placement: null };
  const tb = html;

  // Game meta.
  const games = {};
  let m;
  const gameRe = /id="Game_(\d+)"[^>]*>([\s\S]{0,500}?)<\/div>/g;
  while ((m = gameRe.exec(tb))) {
    const ps = [...m[2].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((x) => decodeEntities(x[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
    const numM = (ps[0] || "").match(/Game\s+(\d+)/i);
    games[m[1]] = {
      num: numM ? Number(numM[1]) : null,
      date: bracketDateToISO(ps[1]),
      time: (ps[2] || "").trim() || null,
      field: (ps[3] || "").trim() || null,
    };
  }

  // Team cells (ids like HomeTeam_/AwayTeam_/VisitorTeam_). Two per game.
  const teams = {};
  const teamRe = /id="\w*Team_(\d+)"[^>]*>([\s\S]{0,300}?)<\/div>/g;
  while ((m = teamRe.exec(tb))) {
    const nameM = m[2].match(/<span class="notranslate">([^<]*)<\/span>/);
    if (!nameM) continue;
    const name = decodeEntities(nameM[1]).replace(/^\[\d+\]\s*/, "").trim();
    if (!name) continue;
    const scoreM = m[2].match(/<span class="paddingLeft10">(\d+)<\/span>/);
    (teams[m[1]] = teams[m[1]] || []).push({ name, score: scoreM ? Number(scoreM[1]) : null });
  }

  const maxNum = Math.max(0, ...Object.values(games).map((g) => g.num || 0));
  const out = [];
  for (const gid of Object.keys(games)) {
    const ts = (teams[gid] || []).filter((t) => t.name);
    const bd = ts.find((t) => t.name.toLowerCase().includes(needle));
    const opp = ts.find((t) => !t.name.toLowerCase().includes(needle));
    if (!bd || !opp || bd.score == null || opp.score == null) continue;
    const g = games[gid];
    out.push({
      date: g.date, time: g.time, field: g.field, opponent: opp.name,
      our_score: bd.score, opp_score: opp.score, status: "final",
      is_playoff: 1,
      playoff_round: g.num && g.num === maxNum ? "Championship" : "Playoff",
    });
  }

  let placement = null;
  const placeRe = /<td[^>]*>(Champion|\d+(?:st|nd|rd|th))<\/td>\s*<td[^>]*>([^<]+)<\/td>/gi;
  while ((m = placeRe.exec(tb))) {
    if (decodeEntities(m[2]).toLowerCase().includes(needle)) {
      placement = m[1];
      break;
    }
  }
  return { games: out, placement };
}

// Best-effort standings + playoff-placement scrape for the season-close
// snapshot. Returns { wins, losses, ties, playoff_result } with any field
// null if it couldn't be found -- never throws, caller treats this as
// best-effort prefill data.
export function parseStandingsAndSnapshot(html, teamMatch = "big dog") {
  const needle = teamMatch.toLowerCase();
  let wins = null, losses = null, ties = null, playoff_result = null;

  // Standings table row: team name link, then a "<td class=\"nowrap \">W-L</td>" cell.
  const standingsRe =
    /class="team-cell[^"]*"[^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td class="nowrap\s*">(\d+)-(\d+)(?:-(\d+))?<\/td>/gi;
  let m;
  while ((m = standingsRe.exec(html))) {
    if (decodeEntities(m[1]).toLowerCase().includes(needle)) {
      wins = Number(m[2]);
      losses = Number(m[3]);
      ties = m[4] != null ? Number(m[4]) : 0;
      break;
    }
  }

  // Placement/bracket table: "<td ...>Champion</td>    <td ...>Big Dog Gotta Eat</td>"
  // repeated for 2nd/3rd/4th/5th/etc.
  const placementRe =
    /<td[^>]*>(Champion|\d+(?:st|nd|rd|th))<\/td>\s*<td[^>]*>([^<]+)<\/td>/gi;
  while ((m = placementRe.exec(html))) {
    if (decodeEntities(m[2]).toLowerCase().includes(needle)) {
      const place = m[1];
      playoff_result = place === "Champion" ? "Champion" : `Finished ${place}`;
      break;
    }
  }

  return { wins, losses, ties, playoff_result };
}
