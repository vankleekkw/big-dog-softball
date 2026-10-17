import { mountChrome, api, setLoading } from "../common.js";

mountChrome("");

const app = document.getElementById("app");
setLoading(app, "Loading the latest…");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtRecord(r) {
  if (!r) return "—";
  const w = r.wins ?? 0, l = r.losses ?? 0, t = r.ties ?? 0;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function render(data) {
  const { record, nextGame, lastGame, career } = data;

  const nextGameHtml = nextGame
    ? `<div class="next-game">
         <div class="label">Next Up${nextGame.league_label ? ` · ${esc(nextGame.league_label)}` : ""}</div>
         <div class="matchup">vs ${esc(nextGame.opponent)}</div>
         <div class="muted">${fmtDate(nextGame.date)}${nextGame.time ? ` · ${esc(nextGame.time)}` : ""}${nextGame.field ? ` · ${esc(nextGame.field)}` : ""}</div>
       </div>`
    : `<div class="next-game"><div class="label">Next Up</div><div class="muted">Nothing on the books yet. We'll show up eventually.</div></div>`;

  const lastGameHtml = lastGame
    ? `<div class="card">
         <h3>Last Time Out</h3>
         <p>
           <span class="pill ${(lastGame.result || "").toLowerCase()}">${esc(lastGame.result || "?")}</span>
           ${esc(lastGame.our_score)}&ndash;${esc(lastGame.opp_score)} vs ${esc(lastGame.opponent)}
         </p>
         <p class="muted">${fmtDate(lastGame.date)}</p>
       </div>`
    : `<div class="card"><h3>Last Time Out</h3><p class="muted">No games played yet this season. Bats are still in the trunk.</p></div>`;

  const careerHtml = `<div class="card">
      <h3>All-Time Record</h3>
      <p class="hero-record"><span class="num">${fmtRecord(career)}</span></p>
      <p class="muted">46 seasons deep at Arlington Heights Park District. We keep showing up.</p>
    </div>`;

  const blurbHtml = `<div class="card">
      <h3>Who We Are</h3>
      <p>Big Dog Gotta Eat: a men's slow-pitch softball team that takes the softball very seriously
         and basically nothing else. 12&Prime; softball, played with zero shame and occasional
         defense.</p>
      <p class="edit-note">Editable: swap this blurb for the real team bio / mission statement / inside joke of choice.</p>
    </div>`;

  app.innerHTML = `
    <section class="hero">
      <img class="hero-logo" src="/assets/logo.jpg" alt="Big Dog Gotta Eat logo">
      <div class="hero-main">
        <div class="hero-season muted">${data.season ? esc(data.season.name) : "Current Season"}</div>
        <p class="hero-record"><span class="num">${fmtRecord(record)}</span><span class="label">This Season</span></p>
        ${nextGameHtml}
      </div>
    </section>
    <section class="card-grid" style="margin-top:var(--gap)">
      ${lastGameHtml}
      ${careerHtml}
      ${blurbHtml}
    </section>
  `;
}

try {
  const data = await api("/api/overview");
  render(data);
} catch (err) {
  app.innerHTML = `<div class="card center">
      <h3>Couldn't load the latest</h3>
      <p class="muted">${esc(err.message || "Something went sideways fetching the scoreboard.")}</p>
    </div>`;
}
