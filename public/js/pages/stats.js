import { mountChrome, api, setLoading, esc, mountSeasonPicker } from "../common.js";
import { fmtRate } from "../stats.js";

mountChrome("stats");

const app = document.getElementById("app");
app.innerHTML = `<h1>Team Stats</h1><div id="picker"></div><div id="body"></div>`;
const picker = document.getElementById("picker");
const body = document.getElementById("body");
setLoading(body, "Crunching the numbers…");

const RATE_KEYS = new Set(["avg", "slg", "obp", "ops"]);
// Not tracked by our system — hidden everywhere.
const HIDDEN = new Set(["rbi", "so", "sac", "sb"]);
const NON_STAT = new Set(["player_id", "name", "number", "position", "season_id", "season_name"]);
const LABELS = {
  gp: "GP", ab: "AB", r: "R", h: "H", hr: "HR", bb: "BB",
  b1: "1B", b2: "2B", b3: "3B", tb: "TB",
  avg: "AVG", slg: "SLG", obp: "OBP", ops: "OPS",
};

const label = (k) => LABELS[k] || k.toUpperCase();
const fmtVal = (k, v) => (v == null ? "—" : RATE_KEYS.has(k) ? fmtRate(v) : String(v));
const statKeysOf = (o) => Object.keys(o).filter((k) => !NON_STAT.has(k) && !HIDDEN.has(k));

function teamTiles(team) {
  const order = ["gp", "r", "h", "avg", "obp", "slg", "ops"];
  return `<div class="stat-row">${order.filter((k) => team[k] !== undefined).map((k) => `
    <div class="stat-tile"><div class="value">${fmtVal(k, team[k])}</div><div class="label">${label(k)}</div></div>
  `).join("")}</div>`;
}

function leaderTile(key, title, leader) {
  if (!leader) return "";
  return `<div class="stat-tile"><div class="value">${fmtVal(key, leader.value)}</div>
    <div class="label">${title}</div>
    <div class="muted" style="margin-top:4px"><a href="/player.html?id=${encodeURIComponent(leader.player_id)}">${esc(leader.name)}</a></div></div>`;
}

function leadersSection(leaders) {
  if (!leaders) return "";
  const tiles = [
    leaderTile("avg", "AVG Leader", leaders.avg),
    leaderTile("slg", "SLG Leader", leaders.slg),
    leaderTile("obp", "OBP Leader", leaders.obp),
  ].filter(Boolean).join("");
  return tiles ? `<h2>Leaders</h2><div class="stat-row">${tiles}</div>` : "";
}

let state = { players: [], keys: [], sort: { key: "ab", dir: -1 } };

function sortPlayers() {
  const { key, dir } = state.sort;
  state.players.sort((a, b) => {
    const av = key === "name" ? (a.name || "") : (a[key] || 0);
    const bv = key === "name" ? (b.name || "") : (b[key] || 0);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function renderTable() {
  if (!state.players.length) {
    return `<div class="card center"><p class="muted">No batting stats recorded for this season yet.</p></div>`;
  }
  sortPlayers();
  const th = (k, text) => {
    const cls = ["sortable"];
    if (state.sort.key === k) cls.push(state.sort.dir === 1 ? "sort-asc" : "sort-desc");
    return `<th class="${cls.join(" ")}" data-key="${k}">${text}</th>`;
  };
  const head = th("name", "Player") + state.keys.map((k) => th(k, label(k))).join("");
  const rows = state.players.map((p) => {
    const cells = state.keys.map((k) => `<td>${fmtVal(k, p[k])}</td>`).join("");
    return `<tr><td><a href="/player.html?id=${encodeURIComponent(p.player_id)}">${esc(p.name)}</a></td>${cells}</tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="stats"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function wireSort() {
  body.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (state.sort.key === k) state.sort.dir *= -1;
      else state.sort = { key: k, dir: k === "name" ? 1 : -1 };
      drawTable();
    });
  });
}

let lastData = null;
function drawTable() {
  const tableHost = document.getElementById("tablehost");
  tableHost.innerHTML = renderTable();
  wireSort();
}

function render(data) {
  lastData = data;
  const team = data.team || {};
  state.players = Array.isArray(data.players) ? data.players.slice() : [];
  state.keys = state.players.length ? statKeysOf(state.players[0]) : [];
  body.innerHTML = `
    <p class="muted">${data.season ? esc(data.season.name) : "Current season"}</p>
    ${teamTiles(team)}
    ${leadersSection(data.leaders)}
    <h2 style="margin-top:28px">Batting</h2>
    <p class="muted" style="font-size:.8rem">Tap a column to sort.</p>
    <div id="tablehost"></div>`;
  drawTable();
}

async function load(seasonId) {
  setLoading(body, "Crunching the numbers…");
  try {
    const data = await api(`/api/stats?season=${encodeURIComponent(seasonId)}`);
    render(data || {});
  } catch (err) {
    body.innerHTML = `<div class="card center"><h3>Couldn't load the stat sheet</h3>
      <p class="muted">${esc(err.message || "The numbers are temporarily unavailable.")}</p></div>`;
  }
}

const initialId = await mountSeasonPicker(picker, load, { includeCareer: true });
await load(initialId ?? "active");
