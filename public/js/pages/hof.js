import { mountChrome, api, setLoading, esc } from "../common.js";
import { fmtRate } from "../stats.js";

mountChrome("hof");

const app = document.getElementById("app");
setLoading(app, "Dusting off the trophy case…");

// Career record book categories (what actually matters to this team).
const RECORD_CATS = [
  { key: "hr", label: "Home Runs", rate: false },
  { key: "ab", label: "At-Bats", rate: false },
  { key: "b2", label: "Doubles", rate: false },
  { key: "b3", label: "Triples", rate: false },
  { key: "obp", label: "On-Base %", rate: true },
  { key: "slg", label: "Slugging %", rate: true },
];

function leaderTile(cat, leader) {
  if (!leader) return "";
  const val = cat.rate ? fmtRate(leader.value) : leader.value;
  return `<div class="stat-tile">
      <div class="value">${val}</div>
      <div class="label">${cat.label}</div>
      <div class="muted" style="margin-top:4px">
        <a href="/player.html?id=${encodeURIComponent(leader.player_id)}">${esc(leader.name)}</a>
      </div>
    </div>`;
}

function winPct(s) {
  const w = s.final_wins || 0, l = s.final_losses || 0, t = s.final_ties || 0;
  const gp = w + l + t;
  return gp ? w / gp : 0;
}
function recRow(s) {
  const t = s.final_ties || 0;
  return t ? `${s.final_wins}-${s.final_losses}-${t}` : `${s.final_wins}-${s.final_losses}`;
}

function seasonHonors(seasons) {
  if (!seasons.length) return "";
  const withPct = seasons.map((s) => ({ ...s, pct: winPct(s) }));
  const best = withPct.reduce((a, b) => (b.pct > a.pct ? b : a));
  const worst = withPct.reduce((a, b) => (b.pct < a.pct ? b : a));
  const mostWins = withPct.reduce((a, b) => ((b.final_wins || 0) > (a.final_wins || 0) ? b : a));
  const totals = seasons.reduce((acc, s) => ({
    w: acc.w + (s.final_wins || 0), l: acc.l + (s.final_losses || 0), t: acc.t + (s.final_ties || 0),
  }), { w: 0, l: 0, t: 0 });
  return `
    <h2 style="margin-top:32px">Season Honors</h2>
    <div class="stat-row">
      <div class="stat-tile"><div class="value">${recRow(best)}</div><div class="label">Best Season (${esc(best.name)})</div></div>
      <div class="stat-tile"><div class="value">${recRow(worst)}</div><div class="label">Worst Season (${esc(worst.name)})</div></div>
      <div class="stat-tile"><div class="value">${mostWins.final_wins}</div><div class="label">Most Wins, One Season (${esc(mostWins.name)})</div></div>
      <div class="stat-tile"><div class="value">${totals.t ? `${totals.w}-${totals.l}-${totals.t}` : `${totals.w}-${totals.l}`}</div><div class="label">All-Time Record</div></div>
    </div>`;
}

function render(seasons, career) {
  const leaders = career && career.leaders ? career.leaders : {};
  const minAB = career ? career.qualifyMinAB : null;
  const recordBook = RECORD_CATS.map((c) => leaderTile(c, leaders[c.key])).filter(Boolean).join("");

  app.innerHTML = `
    <h1>Hall of Fame</h1>
    <p>The all-time record book. Career numbers across every season we have data for.</p>

    <h2 style="margin-top:24px">The Record Book</h2>
    ${minAB != null ? `<p class="muted" style="font-size:.8rem">Rate titles (OBP, SLG) require at least ${minAB} career at-bats to qualify — no cups of coffee on the leaderboard.</p>` : ""}
    ${recordBook ? `<div class="stat-row">${recordBook}</div>` : `<div class="card center"><p class="muted">No career stats yet.</p></div>`}

    ${seasonHonors(seasons)}

    <h2 style="margin-top:32px">Dubious Honors</h2>
    <p class="muted">Not officially sanctioned by anyone. Team in-joke slots — fill them in.</p>
    <div class="card-grid">
      <div class="card"><h3>Longest Tenure</h3><p class="edit-note">Editable: who has shown up the most seasons? Put the obvious answer here.</p></div>
      <div class="card"><h3>Most Nachos, Single Rain Delay</h3><p class="edit-note">Editable: name, nacho count, and a lie about how it happened.</p></div>
      <div class="card"><h3>Best Excuse For A Loss</h3><p class="edit-note">Editable: "the sun was in my eyes" is already taken.</p></div>
    </div>
  `;
}

try {
  const [seasons, career] = await Promise.all([
    api("/api/seasons").catch(() => []),
    api("/api/stats?season=career").catch(() => null),
  ]);
  render(Array.isArray(seasons) ? seasons : [], career);
} catch (err) {
  app.innerHTML = `<div class="card center"><h3>Couldn't open the trophy case</h3>
    <p class="muted">${esc(err.message || "Temporarily unavailable.")}</p></div>`;
}
