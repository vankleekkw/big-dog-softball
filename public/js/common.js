// Shared site chrome + fetch helpers. ES module.
// Usage in a page:  import { mountChrome, api } from './js/common.js';
//                   mountChrome('history');

const LOGO = "/assets/logo.jpg";
const NAV = [
  ["", "Home"],
  ["history", "History"],
  ["schedule", "Schedule"],
  ["stats", "Team Stats"],
  ["players", "Players"],
];

// Inject the sticky header + footer. `active` is a nav key ("" for home).
export function mountChrome(active = "") {
  const links = NAV.map(([key, label]) => {
    const href = key === "" ? "/" : `/${key}.html`;
    const cls = key === active ? ' class="active"' : "";
    return `<a href="${href}"${cls}>${label}</a>`;
  }).join("");

  document.body.insertAdjacentHTML("afterbegin", `
    <header class="site-header">
      <nav class="nav">
        <a class="brand" href="/"><img src="${LOGO}" alt="Big Dog Gotta Eat logo">Big Dog Gotta Eat</a>
        <div class="links">${links}</div>
      </nav>
    </header>`);

  document.body.insertAdjacentHTML("beforeend", `
    <footer class="site-footer">
      <div class="container">Big Dog Gotta Eat · 12&Prime; softball, Arlington Heights ·
        <a href="/admin/">Admin</a></div>
    </footer>`);
}

// JSON fetch helper. Throws on non-2xx with the server's error message.
export async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

// Replace a container's contents with a loading spinner / message.
export function setLoading(el, msg = "Loading…") {
  el.innerHTML = `<div class="loading">${msg}</div>`;
}

export function resultPill(result) {
  if (!result) return "";
  const k = result.toLowerCase();
  return `<span class="pill ${k}">${result}</span>`;
}
