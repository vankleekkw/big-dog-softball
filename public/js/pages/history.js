import { mountChrome, api, setLoading, esc } from "../common.js";

mountChrome("history");

const app = document.getElementById("app");
setLoading(app, "Pulling up the archives…");

function fmtRecordRow(s) {
  const t = s.final_ties || 0;
  return t ? `${s.final_wins}-${s.final_losses}-${t}` : `${s.final_wins}-${s.final_losses}`;
}

function render(seasons) {
  const rows = seasons.map((s) => `
    <tr>
      <td><a href="/season.html?id=${encodeURIComponent(s.id)}">${esc(s.name)}</a></td>
      <td>${fmtRecordRow(s)}</td>
      <td>${esc(s.playoff_result || "—")}</td>
    </tr>
  `).join("");

  app.innerHTML = `
    <h1>History</h1>
    <p>46 seasons of Big Dog Gotta Eat, dating back to roughly 2008, when 12&Prime; softball
       still felt like a good idea. A lot of wins, a lot of losses, and at least one tie
       nobody can fully explain. Tap a season for its games, photo, and highlights.</p>
    <p class="edit-note">Editable: swap this intro for the real origin story / team legend / why the name is what it is.</p>
    <p class="muted">Looking for the record book and dubious honors? That lives on the
       <a href="/hof.html">Hall of Fame</a> now.</p>

    ${seasons.length ? `<div class="table-wrap" style="margin:20px 0">
      <table class="stats">
        <thead><tr><th>Season</th><th>Record</th><th>Playoff Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : `<div class="card center"><p class="muted">No completed seasons on file yet.</p></div>`}
  `;
}

try {
  const seasons = await api("/api/seasons");
  render(Array.isArray(seasons) ? seasons : []);
} catch (err) {
  app.innerHTML = `<div class="card center">
      <h3>Couldn't load the history books</h3>
      <p class="muted">${esc(err.message || "The archives are currently unavailable.")}</p>
    </div>`;
}
