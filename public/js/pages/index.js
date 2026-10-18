import { mountChrome, api, setLoading, esc, resultPill } from "../common.js";

mountChrome("");

const app = document.getElementById("app");
setLoading(app, "Loading the latest…");

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

function heroSection(data) {
  const { record, nextGame } = data;
  const nextGameHtml = nextGame
    ? `<div class="next-game">
         <div class="label">Next Up${nextGame.league_label ? ` · ${esc(nextGame.league_label)}` : ""}</div>
         <div class="matchup">vs ${esc(nextGame.opponent)}</div>
         <div class="muted">${fmtDate(nextGame.date)}${nextGame.time ? ` · ${esc(nextGame.time)}` : ""}${nextGame.field ? ` · ${esc(nextGame.field)}` : ""}</div>
       </div>`
    : `<div class="next-game"><div class="label">Next Up</div><div class="muted">Season's a wrap — see you next year.</div></div>`;
  return `
    <section class="hero">
      <span class="hero-logo logo-chip"><img src="/assets/logo.jpg" alt="Big Dog Gotta Eat logo"></span>
      <div class="hero-main">
        <div class="hero-season muted">${data.season ? esc(data.season.name) : "Current Season"}</div>
        <p class="hero-record"><span class="num">${fmtRecord(record)}</span><span class="label">This Season</span></p>
        ${data.season && data.season.playoff_result ? `<p class="champ-badge">🏆 ${esc(data.season.playoff_result)} &middot; ${esc(data.season.name)}</p>` : ""}
        ${nextGameHtml}
        <p style="margin-top:10px"><a class="btn sm" href="/schedule.html">Full schedule &rsaquo;</a></p>
      </div>
    </section>`;
}

function gameLine(g) {
  const score = g.status === "final" ? `${esc(g.our_score)}&ndash;${esc(g.opp_score)}` : fmtDate(g.date);
  const tag = g.status === "final" ? resultPill(g.result) : `<span class="muted">${esc(g.time || "")}</span>`;
  return `<li class="game-line">${tag} <span class="vs">vs ${esc(g.opponent)}</span> <span class="muted">${score}</span></li>`;
}

function thisSeason(games, seasonName) {
  if (!games.length) return "";
  const finals = games.filter((g) => g.status === "final");
  const recent = finals.slice(-4).reverse();
  const upcoming = games.filter((g) => g.status !== "final").slice(0, 3);
  const col = (title, list, emptyText) => `<div class="card"><h3>${title}</h3>${
    list.length
      ? `<ul class="game-list">${list.map(gameLine).join("")}</ul>`
      : `<p class="muted">${esc(emptyText)}</p>`
  }</div>`;
  return `
    <h2 style="margin-top:24px">This Season${seasonName ? ` · ${esc(seasonName)}` : ""}</h2>
    <section class="card-grid">
      ${col("Recent Results", recent, "No completed games yet.")}
      ${col("Upcoming", upcoming, "Season's a wrap — see you next year.")}
    </section>`;
}

function highlightSection(photo, seasonId) {
  if (!photo || !photo.photo_url) return "";
  const cap = photo.photo_caption || photo.playoff_round || "Season highlight";
  return `
    <section class="game-photos" style="margin-top:var(--gap);max-width:480px">
      <figure class="game-photo">
        <a href="/season.html?id=${encodeURIComponent(seasonId)}">
          <img src="${esc(photo.photo_url)}" alt="${esc(cap)}" loading="lazy">
        </a>
        <figcaption>${esc(cap)}</figcaption>
      </figure>
    </section>`;
}

function bottomCards(career) {
  return `
    <section class="card-grid" style="margin-top:var(--gap)">
      <div class="card">
        <h3>All-Time Record</h3>
        <p class="hero-record"><span class="num">${fmtRecord(career)}</span></p>
        <p class="muted">46 seasons deep across Chicagoland. We keep showing up.
          <a href="/hof.html">Hall of Fame &rsaquo;</a></p>
      </div>
      <div class="card">
        <h3>Who We Are</h3>
        <p>Big Dog Gotta Eat: a men's slow-pitch softball team that takes the softball very seriously
           and basically nothing else. 12&Prime; softball, played with zero shame and occasional defense.</p>
        <p class="edit-note">Editable: swap this blurb for the real team bio / inside joke of choice.</p>
      </div>
    </section>`;
}

function render(data, games) {
  app.innerHTML = `
    ${heroSection(data)}
    ${data.season ? highlightSection(data.highlightPhoto, data.season.id) : ""}
    ${thisSeason(games, data.season ? data.season.name : "")}
    ${bottomCards(data.career)}
  `;
}

try {
  const [data, sched] = await Promise.all([
    api("/api/overview"),
    api("/api/schedule?season=active").catch(() => ({ games: [] })),
  ]);
  render(data, Array.isArray(sched.games) ? sched.games : []);
} catch (err) {
  app.innerHTML = `<div class="card center">
      <h3>Couldn't load the latest</h3>
      <p class="muted">${esc(err.message || "Something went sideways fetching the scoreboard.")}</p>
    </div>`;
}
