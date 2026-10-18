// Shared site chrome + fetch helpers. ES module.
// Usage:  import { mountChrome, api } from './js/common.js';
//         mountChrome('history');                 // section page
//         mountChrome('players', { back: true }); // detail page (adds a Back button)

const LOGO = "/assets/logo.jpg";
const NAV = [
  ["", "Home"],
  ["history", "History"],
  ["hof", "Hall of Fame"],
  ["schedule", "Schedule"],
  ["stats", "Team Stats"],
  ["players", "Players"],
];

export function mountChrome(active = "", opts = {}) {
  const links = NAV.map(([key, label]) => {
    const href = key === "" ? "/" : `/${key}.html`;
    const cls = key === active ? ' class="active"' : "";
    return `<a href="${href}"${cls}>${label}</a>`;
  }).join("");

  const back = opts.back
    ? `<button class="back-btn" type="button" aria-label="Go back">&lsaquo; Back</button>`
    : "";

  document.body.insertAdjacentHTML("afterbegin", `
    <header class="site-header">
      <nav class="nav">
        <a class="brand" href="/"><span class="logo-chip"><img src="${LOGO}" alt="Big Dog Gotta Eat logo"></span>Big Dog Gotta Eat</a>
        <div class="links">${links}</div>
      </nav>
    </header>
    ${back ? `<div class="subnav container">${back}</div>` : ""}`);

  if (opts.back) {
    const btn = document.querySelector(".back-btn");
    btn.addEventListener("click", () => {
      if (history.length > 1) history.back();
      else location.href = "/";
    });
  }

  document.body.insertAdjacentHTML("beforeend", `
    <footer class="site-footer">
      <div class="container">
        <div class="flags" aria-hidden="true">
          <img src="/assets/chicago-flag.svg" alt="" class="flag">
          <img src="/assets/blackout-usa.svg" alt="" class="flag">
        </div>
        <div>Big Dog Gotta Eat &middot; Chicagoland 12&Prime; softball &middot;
          <a href="/admin/">Admin</a></div>
      </div>
    </footer>`);

  registerSW();
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}

// JSON fetch helper. Throws on non-2xx with the server's error message.
export async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

export function setLoading(el, msg = "Loading…") {
  el.innerHTML = `<div class="loading">${msg}</div>`;
}

export function resultPill(result) {
  if (!result) return "";
  const k = result.toLowerCase();
  return `<span class="pill ${k}">${result}</span>`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Render a season dropdown into `container`, auto-selecting the active season.
// Calls onPick(seasonId) on change. Returns the initially-selected season id
// (or null if none). Lets schedule/stats navigate to any past season.
export async function mountSeasonPicker(container, onPick, opts = {}) {
  let seasons = [];
  try { seasons = await api("/api/season-list"); } catch { return null; }
  if (!seasons.length) return null;
  const active = seasons.find((s) => s.is_active) || seasons[0];
  const careerOpt = opts.includeCareer
    ? `<option value="career">Career · All-Time</option>` : "";
  container.innerHTML = `
    <div class="season-picker">
      <label for="seasonSel">Season</label>
      <select id="seasonSel">
        ${careerOpt}
        ${seasons.map((s) => `<option value="${s.id}"${s.id === active.id ? " selected" : ""}>${esc(s.name)}${s.is_active ? " (current)" : ""}</option>`).join("")}
      </select>
    </div>`;
  container.querySelector("#seasonSel").addEventListener("change", (e) => {
    const v = e.target.value;
    onPick(v === "career" ? "career" : Number(v));
  });
  return active.id;
}
