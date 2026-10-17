import { mountChrome, api, setLoading, resultPill } from "../common.js";

mountChrome("schedule");

const app = document.getElementById("app");
setLoading(app, "Loading the schedule…");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
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
  return `
    <tr>
      <td>${fmtDate(g.date)}</td>
      <td>${esc(g.time || "—")}</td>
      <td>${esc(g.field || "—")}</td>
      <td>${esc(g.opponent || "—")}</td>
      <td>${scoreCell}</td>
      <td>${resultCell}</td>
    </tr>
  `;
}

function render(data) {
  const games = Array.isArray(data.games) ? data.games : [];

  if (!games.length) {
    app.innerHTML = `
      <h1>Schedule</h1>
      <div class="card center"><p class="muted">Nothing scheduled yet${data.season ? ` for ${esc(data.season.name)}` : ""}. Check back soon.</p></div>
    `;
    return;
  }

  const groups = groupByLeague(games);
  const sections = [...groups.entries()].map(([label, rows]) => `
    <h2>${esc(label)}</h2>
    <div class="table-wrap" style="margin-bottom:var(--gap)">
      <table class="stats">
        <thead><tr><th>Date</th><th>Time</th><th>Field</th><th>Opponent</th><th>Score</th><th>Result</th></tr></thead>
        <tbody>${rows.map(gameRow).join("")}</tbody>
      </table>
    </div>
  `).join("");

  app.innerHTML = `
    <h1>Schedule</h1>
    <p class="muted">${data.season ? esc(data.season.name) : "Current season"} · both leagues</p>
    ${sections}
  `;
}

try {
  const data = await api("/api/schedule?season=active");
  render(data || {});
} catch (err) {
  app.innerHTML = `
    <h1>Schedule</h1>
    <div class="card center">
      <h3>Couldn't load the schedule</h3>
      <p class="muted">${esc(err.message || "The schedule is temporarily off the board.")}</p>
    </div>
  `;
}
