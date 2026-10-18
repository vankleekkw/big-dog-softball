import { mountChrome, api, setLoading, resultPill, esc, mountSeasonPicker } from "../common.js";

mountChrome("schedule");

const app = document.getElementById("app");
app.innerHTML = `<h1>Schedule &amp; Results</h1><div id="picker"></div><div id="body"></div>`;
const picker = document.getElementById("picker");
const body = document.getElementById("body");
setLoading(body, "Loading the schedule…");

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function gameRow(g, withRound) {
  const score = g.status === "final"
    ? `${esc(g.our_score)}&ndash;${esc(g.opp_score)}`
    : `<span class="muted">—</span>`;
  const result = g.status === "final" ? resultPill(g.result) : `<span class="muted">Scheduled</span>`;
  const roundCell = withRound ? `<td>${esc(g.playoff_round || "Playoff")}</td>` : "";
  return `<tr>
      <td>${fmtDate(g.date)}</td>${roundCell}<td>${esc(g.opponent || "—")}</td>
      <td>${score}</td><td>${result}</td><td>${esc(g.field || "—")}</td>
    </tr>`;
}

function table(headCols, rows) {
  return `<div class="table-wrap" style="margin-bottom:var(--gap)">
    <table class="stats"><thead><tr>${headCols.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function leagueSection(league, games) {
  const mine = games.filter((g) => g.league_id === league.id);
  if (!mine.length && !league.playoff_result) return "";
  const regular = mine.filter((g) => !g.is_playoff);
  const playoff = mine.filter((g) => g.is_playoff);

  const heading = league.quickscores_url
    ? `<a href="${esc(league.quickscores_url)}" target="_blank" rel="noopener">${esc(league.label || "League")}</a>
       <span class="muted" style="font-size:.7rem">↗ QuickScores</span>`
    : esc(league.label || "League");
  const finish = league.playoff_result
    ? `<span class="pill w" style="margin-left:8px">🏆 ${esc(league.playoff_result)}</span>` : "";

  let html = `<h2>${heading}${finish}</h2>`;
  if (regular.length) {
    html += table(["Date", "Opponent", "Score", "Result", "Field"],
      regular.map((g) => gameRow(g, false)).join(""));
  }
  if (playoff.length) {
    html += `<h3 style="margin-top:4px">Playoffs</h3>` +
      table(["Date", "Round", "Opponent", "Score", "Result", "Field"],
        playoff.map((g) => gameRow(g, true)).join(""));
  }
  return html;
}

function render(data) {
  const games = Array.isArray(data.games) ? data.games : [];
  const leagues = Array.isArray(data.leagues) ? data.leagues : [];
  if (!games.length) {
    body.innerHTML = `<div class="card center"><p class="muted">Nothing on the board yet${data.season ? ` for ${esc(data.season.name)}` : ""}.</p></div>`;
    return;
  }
  const sections = leagues.map((l) => leagueSection(l, games)).join("");
  body.innerHTML = `<p class="muted">${data.season ? esc(data.season.name) : "Current season"}</p>${sections}`;
}

async function load(seasonId) {
  setLoading(body, "Loading the schedule…");
  try {
    const data = await api(`/api/schedule?season=${encodeURIComponent(seasonId)}`);
    render(data || {});
  } catch (err) {
    body.innerHTML = `<div class="card center"><h3>Couldn't load the schedule</h3>
      <p class="muted">${esc(err.message || "The schedule is temporarily off the board.")}</p></div>`;
  }
}

const initialId = await mountSeasonPicker(picker, load);
await load(initialId ?? "active");
