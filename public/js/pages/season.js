import { mountChrome, api, setLoading, resultPill, esc } from "../common.js";

mountChrome("history", { back: true });

const app = document.getElementById("app");
setLoading(app, "Pulling up the season…");

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function recordLine(rec) {
  if (!rec) return "";
  const t = rec.ties ? `-${rec.ties}` : "";
  return `${rec.wins}-${rec.losses}${t}`;
}

function gameRow(g) {
  const score = g.status === "final" ? `${esc(g.our_score)}&ndash;${esc(g.opp_score)}` : `<span class="muted">—</span>`;
  const result = g.status === "final" ? resultPill(g.result) : `<span class="muted">Scheduled</span>`;
  return `<tr><td>${fmtDate(g.date)}</td><td>${esc(g.league_label || "")}</td>
    <td>${esc(g.opponent || "—")}</td><td>${esc(g.field || "—")}</td><td>${score}</td><td>${result}</td></tr>`;
}

function render(data) {
  const s = data.season || {};
  const games = Array.isArray(data.games) ? data.games : [];

  const photo = s.photo_url
    ? `<img class="season-photo" src="${esc(s.photo_url)}" alt="${esc(s.name)} team photo">`
    : "";
  const recap = s.recap && s.recap.trim()
    ? `<div class="card"><h2>Highlights</h2><p class="season-recap">${esc(s.recap)}</p></div>`
    : `<div class="card"><h2>Highlights</h2><p class="muted edit-note">No highlights written up yet — add them in the admin panel.</p></div>`;
  const playoff = s.playoff_result ? ` · <span class="muted">${esc(s.playoff_result)}</span>` : "";

  const gamesTable = games.length ? `
    <h2 style="margin-top:28px">Games</h2>
    <div class="table-wrap">
      <table class="stats">
        <thead><tr><th>Date</th><th>League</th><th>Opponent</th><th>Field</th><th>Score</th><th>Result</th></tr></thead>
        <tbody>${games.map(gameRow).join("")}</tbody>
      </table>
    </div>` : `<div class="card center" style="margin-top:20px"><p class="muted">No games recorded for this season.</p></div>`;

  app.innerHTML = `
    <div class="season-hero">
      ${photo}
      <div style="flex:1;min-width:240px">
        <h1>${esc(s.name || "Season")}</h1>
        <p><span class="stat-tile" style="display:inline-block;padding:8px 14px">
          <span class="value" style="font-size:1.4rem">${recordLine(data.record)}</span>
        </span>${playoff}</p>
        <p><a href="/stats.html">Team stats</a> · <a href="/schedule.html">Full schedule</a></p>
      </div>
    </div>
    ${recap}
    ${gamesTable}`;
}

const id = new URLSearchParams(location.search).get("id");
if (!id) {
  app.innerHTML = `<div class="card center"><h3>No season specified</h3>
    <p class="muted">Back to <a href="/history.html">History</a>.</p></div>`;
} else {
  try {
    const data = await api(`/api/seasons/${encodeURIComponent(id)}`);
    render(data || {});
  } catch (err) {
    app.innerHTML = `<div class="card center"><h3>Couldn't load this season</h3>
      <p class="muted">${esc(err.message || "Temporarily unavailable.")}</p></div>`;
  }
}
