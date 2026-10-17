import { mountChrome, api, setLoading } from "../common.js";
import { fmtRate } from "../stats.js";

mountChrome("stats");

const app = document.getElementById("app");
setLoading(app, "Crunching the numbers…");

const RATE_KEYS = new Set(["avg", "slg", "obp", "ops"]);
const LABELS = {
  gp: "GP", ab: "AB", r: "R", h: "H", hr: "HR", rbi: "RBI", bb: "BB",
  sac: "SAC", b1: "1B", b2: "2B", b3: "3B", tb: "TB",
  avg: "AVG", slg: "SLG", obp: "OBP", ops: "OPS",
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function label(key) {
  return LABELS[key] || key.toUpperCase();
}

function fmtVal(key, val) {
  if (val == null) return "—";
  if (RATE_KEYS.has(key)) return fmtRate(val);
  return String(val);
}

// Which raw/derived stat keys to show, in order, excluding identifiers.
const NON_STAT_KEYS = new Set(["player_id", "name", "number", "position", "season_id", "season_name"]);
function statKeysOf(obj) {
  return Object.keys(obj).filter((k) => !NON_STAT_KEYS.has(k));
}

function teamTiles(team) {
  const order = ["gp", "ab", "r", "h", "hr", "avg", "obp", "slg", "ops"];
  const tiles = order
    .filter((k) => team[k] !== undefined)
    .map((k) => `
      <div class="stat-tile">
        <div class="value">${fmtVal(k, team[k])}</div>
        <div class="label">${label(k)}</div>
      </div>
    `).join("");
  return `<div class="stat-row">${tiles}</div>`;
}

function leaderTile(key, title, leader) {
  if (!leader) return "";
  const val = fmtVal(key, leader.value);
  return `
    <div class="stat-tile">
      <div class="value">${val}</div>
      <div class="label">${title}</div>
      <div class="muted" style="margin-top:4px">
        <a href="/player.html?id=${encodeURIComponent(leader.player_id)}">${esc(leader.name)}</a>
      </div>
    </div>
  `;
}

function leadersSection(leaders) {
  if (!leaders) return "";
  const tiles = [
    leaderTile("avg", "AVG Leader", leaders.avg),
    leaderTile("hr", "HR Leader", leaders.hr),
    leaderTile("rbi", "RBI Leader", leaders.rbi),
    leaderTile("h", "Hits Leader", leaders.h),
  ].filter(Boolean).join("");
  if (!tiles) return "";
  return `<h2>Leaders</h2><div class="stat-row">${tiles}</div>`;
}

function playersTable(players) {
  if (!players.length) {
    return `<div class="card center"><p class="muted">No batting stats recorded for this season yet.</p></div>`;
  }
  const keys = statKeysOf(players[0]);
  const head = `<th>Player</th>` + keys.map((k) => `<th>${label(k)}</th>`).join("");
  const rows = players.map((p) => {
    const cells = keys.map((k) => `<td>${fmtVal(k, p[k])}</td>`).join("");
    return `<tr><td><a href="/player.html?id=${encodeURIComponent(p.player_id)}">${esc(p.name)}</a></td>${cells}</tr>`;
  }).join("");
  return `
    <div class="table-wrap">
      <table class="stats">
        <thead><tr>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function render(data) {
  const team = data.team || {};
  const players = Array.isArray(data.players) ? data.players : [];

  app.innerHTML = `
    <h1>Team Stats</h1>
    <p class="muted">${data.season ? esc(data.season.name) : "Current season"}</p>
    ${teamTiles(team)}
    ${leadersSection(data.leaders)}
    <h2 style="margin-top:28px">Batting</h2>
    ${playersTable(players)}
  `;
}

try {
  const data = await api("/api/stats?season=active");
  render(data || {});
} catch (err) {
  app.innerHTML = `
    <h1>Team Stats</h1>
    <div class="card center">
      <h3>Couldn't load the stat sheet</h3>
      <p class="muted">${esc(err.message || "The numbers are temporarily unavailable.")}</p>
    </div>
  `;
}
