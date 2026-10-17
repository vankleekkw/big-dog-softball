import { mountChrome, api, setLoading } from "../common.js";

mountChrome("history");

const app = document.getElementById("app");
setLoading(app, "Pulling up the archives…");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function winPct(s) {
  const w = s.final_wins || 0, l = s.final_losses || 0, t = s.final_ties || 0;
  const gp = w + l + t;
  return gp ? w / gp : 0;
}

function fmtRecordRow(s) {
  const t = s.final_ties || 0;
  return t ? `${s.final_wins}-${s.final_losses}-${t}` : `${s.final_wins}-${s.final_losses}`;
}

function buildHallOfFame(seasons) {
  if (!seasons.length) return "";

  const withPct = seasons.map((s) => ({ ...s, pct: winPct(s) }));
  const best = withPct.reduce((a, b) => (b.pct > a.pct ? b : a));
  const worst = withPct.reduce((a, b) => (b.pct < a.pct ? b : a));
  const mostWins = withPct.reduce((a, b) => ((b.final_wins || 0) > (a.final_wins || 0) ? b : a));
  const totals = seasons.reduce(
    (acc, s) => ({
      w: acc.w + (s.final_wins || 0),
      l: acc.l + (s.final_losses || 0),
      t: acc.t + (s.final_ties || 0),
    }),
    { w: 0, l: 0, t: 0 }
  );

  return `
    <h2>Hall of Fame &amp; Dubious Records</h2>
    <p class="muted">Not officially sanctioned by anyone. We just added it up.</p>
    <div class="stat-row">
      <div class="stat-tile">
        <div class="value">${fmtRecordRow(best)}</div>
        <div class="label">Best Season (${esc(best.name)})</div>
      </div>
      <div class="stat-tile">
        <div class="value">${fmtRecordRow(worst)}</div>
        <div class="label">Worst Season (${esc(worst.name)})</div>
      </div>
      <div class="stat-tile">
        <div class="value">${mostWins.final_wins}</div>
        <div class="label">Most Wins, One Season (${esc(mostWins.name)})</div>
      </div>
      <div class="stat-tile">
        <div class="value">${totals.t ? `${totals.w}-${totals.l}-${totals.t}` : `${totals.w}-${totals.l}`}</div>
        <div class="label">All-Time Record</div>
      </div>
    </div>
    <div class="card-grid" style="margin-top:var(--gap)">
      <div class="card">
        <h3>Longest Tenure</h3>
        <p class="edit-note">Editable: this needs per-player season history beyond what this page pulls — fill in the names once someone does the math (or just picks the obvious answer).</p>
      </div>
      <div class="card">
        <h3>Most Nachos Consumed, Single Rain Delay</h3>
        <p class="edit-note">Editable: team in-joke slot. Insert name, number of nachos, and a lie about how it happened.</p>
      </div>
      <div class="card">
        <h3>Best Excuse For A Loss</h3>
        <p class="edit-note">Editable: team in-joke slot. "The sun was in my eyes" is already taken.</p>
      </div>
    </div>
  `;
}

function render(seasons) {
  const rows = seasons.map((s) => `
    <tr>
      <td>${esc(s.name)}</td>
      <td>${fmtRecordRow(s)}</td>
      <td>${esc(s.playoff_result || "—")}</td>
    </tr>
  `).join("");

  app.innerHTML = `
    <h1>History</h1>
    <p>46 seasons of Big Dog Gotta Eat, dating back to roughly 2008, when 12&Prime; softball
       still felt like a good idea. A lot of wins, a lot of losses, and at least one tie
       nobody can fully explain.</p>
    <p class="edit-note">Editable: swap this intro for the real origin story / team legend / why the name is what it is.</p>

    ${seasons.length ? `<div class="table-wrap" style="margin:20px 0">
      <table class="stats">
        <thead><tr><th>Season</th><th>Record</th><th>Playoff Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : `<div class="card center"><p class="muted">No completed seasons on file yet.</p></div>`}

    ${buildHallOfFame(seasons)}
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
