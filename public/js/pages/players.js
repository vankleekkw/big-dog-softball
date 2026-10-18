import { mountChrome, api, setLoading } from "../common.js";

mountChrome("players");

const app = document.getElementById("app");
setLoading(app, "Rounding up the roster…");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function avatar(p, size = 120) {
  if (p.photo_url) {
    return `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(p.photo_url)}" alt="${esc(p.name)}">`;
  }
  const initial = (p.name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<div class="avatar avatar-fallback" style="width:${size}px;height:${size}px">${esc(initial)}</div>`;
}

function metaLine(p) {
  const bits = [];
  if (p.number) bits.push(`#${esc(p.number)}`);
  if (p.position) bits.push(esc(p.position));
  return bits.join(" · ") || "&nbsp;";
}

function mainPlayerCard(p) {
  return `
    <a class="card player-card" href="/player.html?id=${encodeURIComponent(p.id)}">
      ${avatar(p, 140)}
      <div class="player-card-name">${esc(p.name)}</div>
      <div class="muted">${metaLine(p)}</div>
    </a>
  `;
}

function rosterTile(p) {
  return `
    <div class="photo-tile">
      ${avatar(p, 88)}
      <div class="player-card-name">${esc(p.name)}</div>
      <div class="muted">${metaLine(p)}</div>
    </div>
  `;
}

function render(players) {
  // Only players flagged for a bio card are shown. That flag is auto-seeded at
  // career AB >= 100 during migration and is a manual toggle in the admin panel.
  const mains = players.filter((p) => !!p.is_main_player);

  const mainsHtml = mains.length
    ? `<div class="card-grid">${mains.map(mainPlayerCard).join("")}</div>`
    : `<div class="card center"><p class="muted">No player bios yet. Flag players in the admin panel to feature them here.</p></div>`;

  app.innerHTML = `
    <h1>Players</h1>
    ${mainsHtml}
  `;
}

try {
  const players = await api("/api/players");
  const list = Array.isArray(players) ? players : [];
  if (!list.length) {
    app.innerHTML = `<h1>Players</h1><div class="card center"><p class="muted">No roster on file yet.</p></div>`;
  } else {
    render(list);
  }
} catch (err) {
  app.innerHTML = `
    <h1>Players</h1>
    <div class="card center">
      <h3>Couldn't load the roster</h3>
      <p class="muted">${esc(err.message || "The roster is temporarily unavailable.")}</p>
    </div>
  `;
}
