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

function gameRow(g, withRound) {
  const score = g.status === "final" ? `${esc(g.our_score)}&ndash;${esc(g.opp_score)}` : `<span class="muted">—</span>`;
  const result = g.status === "final" ? resultPill(g.result) : `<span class="muted">Scheduled</span>`;
  const roundCell = withRound ? `<td>${esc(g.playoff_round || "Playoff")}</td>` : "";
  return `<tr><td>${fmtDate(g.date)}</td>${roundCell}<td>${esc(g.opponent || "—")}</td>
    <td>${esc(g.field || "—")}</td><td>${score}</td><td>${result}</td></tr>`;
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
    ? `<a href="${esc(league.quickscores_url)}" target="_blank" rel="noopener">${esc(league.label || "League")}</a>`
    : esc(league.label || "League");
  const finish = league.playoff_result
    ? `<span class="pill w" style="margin-left:8px">🏆 ${esc(league.playoff_result)}</span>` : "";
  let html = `<h2>${heading}${finish}</h2>`;
  if (regular.length) html += table(["Date", "Opponent", "Field", "Score", "Result"], regular.map((g) => gameRow(g, false)).join(""));
  if (playoff.length) html += `<h3 style="margin-top:4px">Playoffs</h3>` +
    table(["Date", "Round", "Opponent", "Field", "Score", "Result"], playoff.map((g) => gameRow(g, true)).join(""));
  const photos = playoff.filter((g) => g.photo_url);
  if (photos.length) {
    html += `<div class="game-photos">` + photos.map((g) => {
      const cap = g.photo_caption || `${g.playoff_round || "Playoff"} vs ${g.opponent}`;
      const score = g.status === "final" ? ` · ${esc(g.our_score)}–${esc(g.opp_score)} ${esc(g.result || "")}` : "";
      return `<figure class="game-photo">
        <img src="${esc(g.photo_url)}" alt="${esc(cap)}" loading="lazy">
        <figcaption>${esc(cap)}${score}</figcaption></figure>`;
    }).join("") + `</div>`;
  }
  return html;
}

function render(data) {
  const s = data.season || {};
  const games = Array.isArray(data.games) ? data.games : [];
  const leagues = Array.isArray(data.leagues) ? data.leagues : [];

  const photo = s.photo_url
    ? `<img class="season-photo" src="${esc(s.photo_url)}" alt="${esc(s.name)} team photo">`
    : "";
  const recap = s.recap && s.recap.trim()
    ? `<div class="card"><h2>Highlights</h2><p class="season-recap">${esc(s.recap)}</p></div>`
    : `<div class="card"><h2>Highlights</h2><p class="muted edit-note">No highlights written up yet — add them in the admin panel.</p></div>`;
  const playoff = s.playoff_result ? ` · <span class="muted">${esc(s.playoff_result)}</span>` : "";

  const gamesTable = games.length
    ? leagues.map((l) => leagueSection(l, games)).join("")
    : `<div class="card center" style="margin-top:20px"><p class="muted">No games recorded for this season.</p></div>`;

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
