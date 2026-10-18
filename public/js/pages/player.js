import { mountChrome, api, setLoading } from "../common.js";
import { fmtRate } from "../stats.js";

mountChrome("players", { back: true });

const app = document.getElementById("app");
setLoading(app, "Pulling the card…");

const RATE_KEYS = new Set(["avg", "slg", "obp", "ops"]);
// Not tracked by our system — hidden from stat tables.
const HIDDEN = new Set(["rbi", "so", "sac", "sb"]);
const LABELS = {
  gp: "GP", ab: "AB", r: "R", h: "H", hr: "HR", bb: "BB",
  b1: "1B", b2: "2B", b3: "3B", tb: "TB",
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

function avatar(p, size = 180) {
  if (p.photo_url) {
    return `<img class="avatar bio-photo" style="width:${size}px;height:${size}px" src="${esc(p.photo_url)}" alt="${esc(p.name)}">`;
  }
  const initial = (p.name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<div class="avatar avatar-fallback bio-photo" style="width:${size}px;height:${size}px">${esc(initial)}</div>`;
}

function render(data) {
  const p = data.player || {};
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  const career = data.career || {};

  const metaBits = [];
  if (p.number) metaBits.push(`#${esc(p.number)}`);
  if (p.position) metaBits.push(esc(p.position));

  const bio = p.bio_text && p.bio_text.trim()
    ? `<p>${esc(p.bio_text)}</p>`
    : `<p class="muted edit-note">No bio on file yet. Editable: someone should ask this player three questions and a lie.</p>`;

  // Derive the stat column order from career totals (pure stat keys, no identifiers,
  // excluding stats our system doesn't track).
  const keys = Object.keys(career).filter((k) => !HIDDEN.has(k));

  const head = `<th>Season</th>` + keys.map((k) => `<th>${label(k)}</th>`).join("");
  const rows = seasons.map((s) => {
    const cells = keys.map((k) => `<td>${fmtVal(k, s[k])}</td>`).join("");
    return `<tr><td>${esc(s.season_name)}</td>${cells}</tr>`;
  }).join("");
  const careerCells = keys.map((k) => `<td>${fmtVal(k, career[k])}</td>`).join("");

  app.innerHTML = `
    <div class="bio-header">
      ${avatar(p)}
      <div class="bio-info">
        <h1>${esc(p.name || "Unknown Player")}</h1>
        <p class="muted">${metaBits.join(" · ") || "&nbsp;"}</p>
        ${bio}
      </div>
    </div>

    <h2 style="margin-top:28px">Career Stats</h2>
    ${seasons.length ? `
      <div class="table-wrap">
        <table class="stats">
          <thead><tr>${head}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>Career</td>${careerCells}</tr></tfoot>
        </table>
      </div>
    ` : `<div class="card center"><p class="muted">No recorded seasons for this player yet.</p></div>`}
  `;
}

const id = new URLSearchParams(location.search).get("id");

if (!id) {
  app.innerHTML = `
    <div class="card center">
      <h3>No player specified</h3>
      <p class="muted">Head back to the <a href="/players.html">roster</a> and pick someone.</p>
    </div>
  `;
} else {
  try {
    const data = await api(`/api/players/${encodeURIComponent(id)}`);
    render(data || {});
  } catch (err) {
    app.innerHTML = `
      <div class="card center">
        <h3>Couldn't load this player</h3>
        <p class="muted">${esc(err.message || "This player card is temporarily unavailable.")}</p>
      </div>
    `;
  }
}
