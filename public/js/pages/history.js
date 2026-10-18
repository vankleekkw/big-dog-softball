import { mountChrome, api, setLoading, esc, getSiteCopy } from "../common.js";

mountChrome("history");

const app = document.getElementById("app");
setLoading(app, "Pulling up the archives…");

const FALLBACK_INTRO = "46 seasons of Big Dog Gotta Eat, dating back to roughly 2008, when 12″ softball still felt like a good idea. A lot of wins, a lot of losses, and at least one tie nobody can fully explain. Tap a season for its games, photo, and highlights.";

function fmtRecordRow(s) {
  const t = s.final_ties || 0;
  return t ? `${s.final_wins}-${s.final_losses}-${t}` : `${s.final_wins}-${s.final_losses}`;
}

function render(seasons, copy) {
  const rows = seasons.map((s) => `
    <tr>
      <td><a href="/season.html?id=${encodeURIComponent(s.id)}">${esc(s.name)}</a></td>
      <td>${fmtRecordRow(s)}</td>
      <td>${esc(s.playoff_result || "—")}</td>
    </tr>
  `).join("");

  app.innerHTML = `
    <h1>History</h1>
    <p>${esc(copy.history_intro || FALLBACK_INTRO)}</p>

    ${seasons.length ? `<div class="table-wrap" style="margin:20px 0">
      <table class="stats">
        <thead><tr><th>Season</th><th>Record</th><th>Playoff Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : `<div class="card center"><p class="muted">No completed seasons on file yet.</p></div>`}
  `;
}

try {
  const [seasons, copy] = await Promise.all([api("/api/seasons"), getSiteCopy()]);
  render(Array.isArray(seasons) ? seasons : [], copy);
} catch (err) {
  app.innerHTML = `<div class="card center">
      <h3>Couldn't load the history books</h3>
      <p class="muted">${esc(err.message || "The archives are currently unavailable.")}</p>
    </div>`;
}
