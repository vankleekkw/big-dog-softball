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

function groupByLeague(games) {
  const groups = new Map();
  for (const g of games) {
    const key = g.league_label || "Schedule";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  return groups;
}

function gameRow(g) {
  const scoreCell = g.status === "final"
    ? `${esc(g.our_score)}&ndash;${esc(g.opp_score)}`
    : `<span class="muted">—</span>`;
  const resultCell = g.status === "final" ? resultPill(g.result) : `<span class="muted">Scheduled</span>`;
  return `<tr>
      <td>${fmtDate(g.date)}</td><td>${esc(g.time || "—")}</td><td>${esc(g.field || "—")}</td>
      <td>${esc(g.opponent || "—")}</td><td>${scoreCell}</td><td>${resultCell}</td>
    </tr>`;
}

function render(data) {
  const games = Array.isArray(data.games) ? data.games : [];
  if (!games.length) {
    body.innerHTML = `<div class="card center"><p class="muted">Nothing on the board yet${data.season ? ` for ${esc(data.season.name)}` : ""}.</p></div>`;
    return;
  }
  const groups = groupByLeague(games);
  const sections = [...groups.entries()].map(([lab, rows]) => `
    <h2>${esc(lab)}</h2>
    <div class="table-wrap" style="margin-bottom:var(--gap)">
      <table class="stats">
        <thead><tr><th>Date</th><th>Time</th><th>Field</th><th>Opponent</th><th>Score</th><th>Result</th></tr></thead>
        <tbody>${rows.map(gameRow).join("")}</tbody>
      </table>
    </div>`).join("");
  body.innerHTML = `<p class="muted">${data.season ? esc(data.season.name) : "Current season"} · both leagues combined</p>${sections}`;
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
