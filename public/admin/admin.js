// Big Dog Gotta Eat — admin panel logic. Vanilla JS, no build step.
// Talks to /api/admin/* (gated by Cloudflare Access in production; in local
// dev the API falls back to ADMIN_DEV_BYPASS=1, set in .dev.vars).

// ---- tiny helpers -----------------------------------------------------------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

let statusTimer;
function showStatus(msg, ok = false) {
  const el = document.getElementById("admin-status");
  el.textContent = msg;
  el.hidden = false;
  el.className = "admin-banner" + (ok ? " ok" : "");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// ---- tab wiring --------------------------------------------------------------

const tabLoaded = new Set();
const loaders = { players: initPlayers, rosters: initRosters, seasons: initSeasons, games: initGames, stats: initStats };

function switchTab(name) {
  document.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".admin-panel").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  if (!tabLoaded.has(name)) {
    tabLoaded.add(name);
    loaders[name]().catch((err) => showStatus(err.message));
  }
}

document.querySelectorAll(".admin-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

// ---- shared caches ------------------------------------------------------------

let playersCache = [];
let seasonsCache = [];

async function loadPlayersCache() {
  playersCache = await api("/api/admin/players");
  return playersCache;
}
async function loadSeasonsCache() {
  seasonsCache = await api("/api/admin/seasons");
  return seasonsCache;
}

function populateSeasonSelect(select) {
  select.innerHTML = seasonsCache
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}${s.is_active ? " (active)" : ""}</option>`)
    .join("");
  const active = seasonsCache.find((s) => s.is_active);
  if (active) select.value = String(active.id);
}

// ---- Players tab --------------------------------------------------------------

async function initPlayers() {
  await reloadPlayers();
  document.getElementById("player-form").addEventListener("submit", onPlayerFormSubmit);
  document.getElementById("player-form-cancel").addEventListener("click", resetPlayerForm);
  document.getElementById("player-photo-upload").addEventListener("click", onPhotoUpload);
}

async function reloadPlayers() {
  const list = document.getElementById("players-list");
  list.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await loadPlayersCache();
    renderPlayersList();
  } catch (err) {
    showStatus(err.message);
    list.innerHTML = '<p class="muted">Failed to load players.</p>';
  }
}

function renderPlayersList() {
  const list = document.getElementById("players-list");
  if (playersCache.length === 0) {
    list.innerHTML = '<p class="muted">No players yet.</p>';
    return;
  }
  list.innerHTML = playersCache
    .map(
      (p) => `
    <div class="admin-row" data-id="${p.id}">
      <div class="admin-row-main">
        <strong>${escapeHtml(p.name)}</strong>
        <span class="muted">#${escapeHtml(p.number || "—")} · ${escapeHtml(p.position || "—")}${p.is_main_player ? " · Featured" : ""}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn secondary sm" type="button" data-action="edit">Edit</button>
        <button class="btn secondary sm" type="button" data-action="delete">Delete</button>
      </div>
    </div>`
    )
    .join("");
  list.querySelectorAll(".admin-row").forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-action="edit"]').addEventListener("click", () => editPlayer(id));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deletePlayer(id));
  });
}

function editPlayer(id) {
  const p = playersCache.find((x) => x.id === id);
  if (!p) return;
  const form = document.getElementById("player-form");
  form.id.value = p.id;
  form.name.value = p.name || "";
  form.number.value = p.number || "";
  form.position.value = p.position || "";
  form.bio_text.value = p.bio_text || "";
  form.photo_url.value = p.photo_url || "";
  form.is_main_player.checked = !!p.is_main_player;
  document.getElementById("player-form-title").textContent = `Edit ${p.name}`;
  document.getElementById("player-photo-card").hidden = false;
  document.getElementById("player-photo-result").textContent = "";
}

function resetPlayerForm() {
  const form = document.getElementById("player-form");
  form.reset();
  form.id.value = "";
  document.getElementById("player-form-title").textContent = "Add Player";
  document.getElementById("player-photo-card").hidden = true;
}

async function onPlayerFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.id.value;
  const payload = {
    name: form.name.value.trim(),
    number: form.number.value.trim() || null,
    position: form.position.value.trim() || null,
    bio_text: form.bio_text.value.trim() || null,
    photo_url: form.photo_url.value.trim() || null,
    is_main_player: form.is_main_player.checked,
  };
  try {
    if (id) {
      await api(`/api/admin/players/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      showStatus("Player updated.", true);
    } else {
      const created = await api("/api/admin/players", { method: "POST", body: JSON.stringify(payload) });
      form.id.value = created.id;
      document.getElementById("player-form-title").textContent = `Edit ${created.name}`;
      document.getElementById("player-photo-card").hidden = false;
      showStatus("Player created.", true);
    }
    await reloadPlayers();
  } catch (err) {
    showStatus(err.message);
  }
}

async function deletePlayer(id) {
  const p = playersCache.find((x) => x.id === id);
  if (!confirm(`Delete ${p ? p.name : "this player"}? This also removes their roster membership and game-stat history.`)) return;
  try {
    await api(`/api/admin/players/${id}`, { method: "DELETE" });
    showStatus("Player deleted.", true);
    resetPlayerForm();
    await reloadPlayers();
  } catch (err) {
    showStatus(err.message);
  }
}

async function onPhotoUpload() {
  const form = document.getElementById("player-form");
  const id = form.id.value;
  const fileInput = document.getElementById("player-photo-file");
  const resultEl = document.getElementById("player-photo-result");
  if (!id) { resultEl.textContent = "Save the player first."; return; }
  if (!fileInput.files[0]) { resultEl.textContent = "Choose a file first."; return; }

  const fd = new FormData();
  fd.append("photo", fileInput.files[0]);
  resultEl.textContent = "Uploading…";
  try {
    const res = await fetch(`/api/admin/players/${id}/photo`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    form.photo_url.value = data.photo_url;
    resultEl.textContent = `Uploaded: ${data.photo_url}`;
    await reloadPlayers();
  } catch (err) {
    resultEl.textContent = `Failed: ${err.message}`;
  }
}

// ---- Rosters tab ----------------------------------------------------------------

async function initRosters() {
  await loadSeasonsCache();
  if (playersCache.length === 0) await loadPlayersCache();
  populateSeasonSelect(document.getElementById("roster-season-select"));
  document.getElementById("roster-season-select").addEventListener("change", renderRosterList);
  await renderRosterList();
}

async function renderRosterList() {
  const seasonId = document.getElementById("roster-season-select").value;
  const list = document.getElementById("roster-list");
  if (!seasonId) { list.innerHTML = '<p class="muted">No seasons yet — add one under Seasons &amp; Leagues.</p>'; return; }
  list.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const memberIds = new Set(await api(`/api/admin/rosters?season_id=${seasonId}`));
    if (playersCache.length === 0) { list.innerHTML = '<p class="muted">No players yet — add some under Players.</p>'; return; }
    list.innerHTML = playersCache
      .map(
        (p) => `
      <label class="admin-row">
        <span class="admin-row-main"><strong>${escapeHtml(p.name)}</strong> <span class="muted">#${escapeHtml(p.number || "—")}</span></span>
        <input type="checkbox" data-player-id="${p.id}" ${memberIds.has(p.id) ? "checked" : ""}>
      </label>`
      )
      .join("");
    list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => onRosterToggle(seasonId, Number(cb.dataset.playerId), cb.checked));
    });
  } catch (err) {
    showStatus(err.message);
    list.innerHTML = '<p class="muted">Failed to load roster.</p>';
  }
}

async function onRosterToggle(seasonId, playerId, add) {
  try {
    await api("/api/admin/rosters", {
      method: add ? "POST" : "DELETE",
      body: JSON.stringify({ season_id: Number(seasonId), player_id: playerId }),
    });
    showStatus(add ? "Added to roster." : "Removed from roster.", true);
  } catch (err) {
    showStatus(err.message);
  }
}

// ---- Seasons & Leagues tab -----------------------------------------------------

let selectedSeasonId = null;
let leaguesCache = [];

async function initSeasons() {
  await loadSeasonsCache();
  renderSeasonsList();
  const active = seasonsCache.find((s) => s.is_active) || seasonsCache[0];
  if (active) await selectSeasonForLeagues(active.id);

  document.getElementById("season-form").addEventListener("submit", onSeasonFormSubmit);
  document.getElementById("season-form-cancel").addEventListener("click", resetSeasonForm);
  document.getElementById("league-form").addEventListener("submit", onLeagueFormSubmit);
  document.getElementById("league-form-cancel").addEventListener("click", resetLeagueForm);
  document.getElementById("league-add-btn").addEventListener("click", showLeagueForm);
  document.getElementById("snapshot-run").addEventListener("click", onSnapshotRun);
  document.getElementById("sync-run").addEventListener("click", onSyncRun);
}

async function reloadSeasons() {
  await loadSeasonsCache();
  renderSeasonsList();
}

function renderSeasonsList() {
  const list = document.getElementById("seasons-list");
  if (seasonsCache.length === 0) { list.innerHTML = '<p class="muted">No seasons yet.</p>'; return; }
  list.innerHTML = seasonsCache
    .map(
      (s) => `
    <div class="admin-row" data-id="${s.id}">
      <div class="admin-row-main">
        <strong>${escapeHtml(s.name)}${s.is_active ? ' <span class="pill w">ACTIVE</span>' : ""}</strong>
        <span class="muted">${s.final_wins != null ? `${s.final_wins}-${s.final_losses}-${s.final_ties || 0}` : "in progress"}${s.playoff_result ? " · " + escapeHtml(s.playoff_result) : ""}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn secondary sm" type="button" data-action="select">Manage</button>
        <button class="btn secondary sm" type="button" data-action="edit">Edit</button>
        ${s.is_active ? "" : '<button class="btn secondary sm" type="button" data-action="activate">Set Active</button>'}
        <button class="btn secondary sm" type="button" data-action="delete">Delete</button>
      </div>
    </div>`
    )
    .join("");
  list.querySelectorAll(".admin-row").forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-action="select"]').addEventListener("click", () => selectSeasonForLeagues(id));
    row.querySelector('[data-action="edit"]').addEventListener("click", () => editSeason(id));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteSeason(id));
    const act = row.querySelector('[data-action="activate"]');
    if (act) act.addEventListener("click", () => activateSeason(id));
  });
}

function editSeason(id) {
  const s = seasonsCache.find((x) => x.id === id);
  if (!s) return;
  const form = document.getElementById("season-form");
  form.id.value = s.id;
  form.name.value = s.name || "";
  form.start_date.value = s.start_date || "";
  form.end_date.value = s.end_date || "";
  form.sort_order.value = s.sort_order ?? "";
  form.final_wins.value = s.final_wins ?? "";
  form.final_losses.value = s.final_losses ?? "";
  form.final_ties.value = s.final_ties ?? "";
  form.playoff_result.value = s.playoff_result || "";
  document.getElementById("season-form-title").textContent = `Edit ${s.name}`;
}

function resetSeasonForm() {
  const form = document.getElementById("season-form");
  form.reset();
  form.id.value = "";
  document.getElementById("season-form-title").textContent = "Add Season";
}

async function onSeasonFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.id.value;
  const payload = {
    name: form.name.value.trim(),
    start_date: form.start_date.value || null,
    end_date: form.end_date.value || null,
    sort_order: numOrNull(form.sort_order.value),
    final_wins: numOrNull(form.final_wins.value),
    final_losses: numOrNull(form.final_losses.value),
    final_ties: numOrNull(form.final_ties.value),
    playoff_result: form.playoff_result.value.trim() || null,
  };
  try {
    if (id) await api(`/api/admin/seasons/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    else await api("/api/admin/seasons", { method: "POST", body: JSON.stringify(payload) });
    showStatus("Season saved.", true);
    resetSeasonForm();
    await reloadSeasons();
  } catch (err) {
    showStatus(err.message);
  }
}

async function deleteSeason(id) {
  if (!confirm("Delete this season? This also deletes its leagues, games, roster, and historical batting rows for it.")) return;
  try {
    await api(`/api/admin/seasons/${id}`, { method: "DELETE" });
    showStatus("Season deleted.", true);
    if (selectedSeasonId === id) selectedSeasonId = null;
    await reloadSeasons();
  } catch (err) {
    showStatus(err.message);
  }
}

async function activateSeason(id) {
  if (!confirm("Make this the active season? Any other active season will be cleared.")) return;
  try {
    await api(`/api/admin/seasons/${id}`, { method: "PATCH", body: JSON.stringify({ is_active: true }) });
    showStatus("Active season updated.", true);
    await reloadSeasons();
  } catch (err) {
    showStatus(err.message);
  }
}

async function selectSeasonForLeagues(id) {
  selectedSeasonId = id;
  const season = seasonsCache.find((s) => s.id === id);
  document.getElementById("leagues-title").textContent = `Leagues for ${season ? season.name : "season"}`;
  document.getElementById("league-add-btn").hidden = false;
  document.getElementById("snapshot-card").hidden = false;
  document.getElementById("snapshot-result").innerHTML = "";
  document.getElementById("sync-run").disabled = false;
  document.getElementById("sync-result").innerHTML = "";
  resetLeagueForm();
  await reloadLeagues();
}

async function reloadLeagues() {
  const list = document.getElementById("leagues-list");
  list.innerHTML = '<div class="loading">Loading…</div>';
  try {
    leaguesCache = await api(`/api/admin/leagues?season_id=${selectedSeasonId}`);
    renderLeaguesList();
  } catch (err) {
    showStatus(err.message);
    list.innerHTML = '<p class="muted">Failed to load leagues.</p>';
  }
}

function renderLeaguesList() {
  const list = document.getElementById("leagues-list");
  if (leaguesCache.length === 0) { list.innerHTML = '<p class="muted">No leagues yet for this season.</p>'; return; }
  list.innerHTML = leaguesCache
    .map(
      (l) => `
    <div class="admin-row" data-id="${l.id}">
      <div class="admin-row-main">
        <strong>${escapeHtml(l.league_label)}</strong>
        <span class="muted">${l.quickscores_org_dir ? `OrgDir ${escapeHtml(l.quickscores_org_dir)} / League ${escapeHtml(String(l.quickscores_league_id || ""))}` : "No QuickScores link"}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn secondary sm" type="button" data-action="edit">Edit</button>
        <button class="btn secondary sm" type="button" data-action="delete">Delete</button>
      </div>
    </div>`
    )
    .join("");
  list.querySelectorAll(".admin-row").forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-action="edit"]').addEventListener("click", () => editLeague(id));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteLeague(id));
  });
}

function showLeagueForm() {
  const form = document.getElementById("league-form");
  form.hidden = false;
  form.id.value = "";
  form.season_id.value = selectedSeasonId;
  form.league_label.value = "";
  form.quickscores_org_dir.value = "";
  form.quickscores_league_id.value = "";
  form.quickscores_team_id.value = "";
}

function resetLeagueForm() {
  document.getElementById("league-form").hidden = true;
}

function editLeague(id) {
  const l = leaguesCache.find((x) => x.id === id);
  if (!l) return;
  const form = document.getElementById("league-form");
  form.hidden = false;
  form.id.value = l.id;
  form.season_id.value = l.season_id;
  form.league_label.value = l.league_label || "";
  form.quickscores_org_dir.value = l.quickscores_org_dir || "";
  form.quickscores_league_id.value = l.quickscores_league_id || "";
  form.quickscores_team_id.value = l.quickscores_team_id || "";
}

async function onLeagueFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.id.value;
  const payload = {
    season_id: Number(form.season_id.value),
    league_label: form.league_label.value.trim(),
    quickscores_org_dir: form.quickscores_org_dir.value.trim() || null,
    quickscores_league_id: form.quickscores_league_id.value.trim() || null,
    quickscores_team_id: form.quickscores_team_id.value.trim() || null,
  };
  try {
    if (id) await api(`/api/admin/leagues/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    else await api("/api/admin/leagues", { method: "POST", body: JSON.stringify(payload) });
    showStatus("League saved.", true);
    resetLeagueForm();
    await reloadLeagues();
  } catch (err) {
    showStatus(err.message);
  }
}

async function deleteLeague(id) {
  if (!confirm("Delete this league? Its games will also be deleted.")) return;
  try {
    await api(`/api/admin/leagues/${id}`, { method: "DELETE" });
    showStatus("League deleted.", true);
    await reloadLeagues();
  } catch (err) {
    showStatus(err.message);
  }
}

async function onSnapshotRun() {
  const resultEl = document.getElementById("snapshot-result");
  resultEl.innerHTML = '<p class="muted">Scraping…</p>';
  try {
    const data = await api(`/api/admin/seasons/${selectedSeasonId}/snapshot`, { method: "POST" });
    resultEl.innerHTML = `
      <div class="admin-form-row">
        <label>Wins<input type="number" id="snap-wins" value="${data.final_wins ?? ""}"></label>
        <label>Losses<input type="number" id="snap-losses" value="${data.final_losses ?? ""}"></label>
        <label>Ties<input type="number" id="snap-ties" value="${data.final_ties ?? ""}"></label>
      </div>
      <label>Playoff result<input type="text" id="snap-playoff" value="${escapeHtml(data.playoff_result || "")}"></label>
      ${data.notes && data.notes.length ? `<div class="sync-errors">${data.notes.map(escapeHtml).join("\n")}</div>` : ""}
      <button class="btn sm" type="button" id="snap-confirm">Confirm &amp; Save to Season</button>
    `;
    document.getElementById("snap-confirm").addEventListener("click", async () => {
      const payload = {
        final_wins: numOrNull(document.getElementById("snap-wins").value),
        final_losses: numOrNull(document.getElementById("snap-losses").value),
        final_ties: numOrNull(document.getElementById("snap-ties").value),
        playoff_result: document.getElementById("snap-playoff").value.trim() || null,
      };
      try {
        await api(`/api/admin/seasons/${selectedSeasonId}`, { method: "PATCH", body: JSON.stringify(payload) });
        showStatus("Season snapshot saved.", true);
        await reloadSeasons();
      } catch (err) {
        showStatus(err.message);
      }
    });
  } catch (err) {
    resultEl.innerHTML = `<p class="muted">Scrape failed: ${escapeHtml(err.message)}</p>`;
  }
}

async function onSyncRun() {
  const resultEl = document.getElementById("sync-result");
  resultEl.innerHTML = '<p class="muted">Syncing…</p>';
  try {
    const data = await api("/api/admin/sync", { method: "POST", body: JSON.stringify({ season_id: selectedSeasonId }) });
    resultEl.innerHTML =
      `<p>Inserted ${data.inserted}, updated ${data.updated}.</p>` +
      (data.errors && data.errors.length ? `<div class="sync-errors">${data.errors.map(escapeHtml).join("\n")}</div>` : "");
  } catch (err) {
    resultEl.innerHTML = `<p class="muted">Sync failed: ${escapeHtml(err.message)}</p>`;
  }
}

// ---- Games tab ------------------------------------------------------------------

let gamesCache = [];
let gamesLeaguesCache = [];

async function initGames() {
  if (seasonsCache.length === 0) await loadSeasonsCache();
  populateSeasonSelect(document.getElementById("games-season-select"));
  document.getElementById("games-season-select").addEventListener("change", onGamesSeasonChange);
  document.getElementById("game-form").addEventListener("submit", onGameFormSubmit);
  document.getElementById("game-form-cancel").addEventListener("click", resetGameForm);
  await onGamesSeasonChange();
}

async function onGamesSeasonChange() {
  const seasonId = document.getElementById("games-season-select").value;
  gamesLeaguesCache = seasonId ? await api(`/api/admin/leagues?season_id=${seasonId}`) : [];
  const leagueSelect = document.getElementById("game-form").season_league_id;
  leagueSelect.innerHTML = gamesLeaguesCache.map((l) => `<option value="${l.id}">${escapeHtml(l.league_label)}</option>`).join("");
  await reloadGames();
}

async function reloadGames() {
  const seasonId = document.getElementById("games-season-select").value;
  const list = document.getElementById("games-list");
  if (!seasonId) { list.innerHTML = '<p class="muted">No seasons yet.</p>'; return; }
  list.innerHTML = '<div class="loading">Loading…</div>';
  try {
    gamesCache = await api(`/api/admin/games?season_id=${seasonId}`);
    renderGamesList();
  } catch (err) {
    showStatus(err.message);
    list.innerHTML = '<p class="muted">Failed to load games.</p>';
  }
}

function renderGamesList() {
  const list = document.getElementById("games-list");
  if (gamesCache.length === 0) { list.innerHTML = '<p class="muted">No games yet.</p>'; return; }
  list.innerHTML = gamesCache
    .map(
      (g) => `
    <div class="admin-row" data-id="${g.id}">
      <div class="admin-row-main">
        <strong>${g.date || "—"} vs ${escapeHtml(g.opponent || "TBD")}</strong>
        <span class="muted">${escapeHtml(g.time || "")} ${escapeHtml(g.field || "")} · ${g.status}${g.status === "final" ? ` · ${g.our_score}-${g.opp_score}` : ""}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn secondary sm" type="button" data-action="edit">Edit</button>
        <button class="btn secondary sm" type="button" data-action="delete">Delete</button>
      </div>
    </div>`
    )
    .join("");
  list.querySelectorAll(".admin-row").forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-action="edit"]').addEventListener("click", () => editGame(id));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteGame(id));
  });
}

function editGame(id) {
  const g = gamesCache.find((x) => x.id === id);
  if (!g) return;
  const form = document.getElementById("game-form");
  form.id.value = g.id;
  form.season_league_id.value = g.season_league_id;
  form.date.value = g.date || "";
  form.time.value = g.time || "";
  form.field.value = g.field || "";
  form.opponent.value = g.opponent || "";
  form.our_score.value = g.our_score ?? "";
  form.opp_score.value = g.opp_score ?? "";
  form.status.value = g.status || "scheduled";
  document.getElementById("game-form-title").textContent = "Edit Game";
}

function resetGameForm() {
  const form = document.getElementById("game-form");
  form.reset();
  form.id.value = "";
  document.getElementById("game-form-title").textContent = "Add Game";
}

async function onGameFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.id.value;
  const payload = {
    season_league_id: Number(form.season_league_id.value),
    date: form.date.value || null,
    time: form.time.value.trim() || null,
    field: form.field.value.trim() || null,
    opponent: form.opponent.value.trim() || null,
    our_score: numOrNull(form.our_score.value),
    opp_score: numOrNull(form.opp_score.value),
    status: form.status.value,
  };
  try {
    if (id) await api(`/api/admin/games/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    else await api("/api/admin/games", { method: "POST", body: JSON.stringify(payload) });
    showStatus("Game saved.", true);
    resetGameForm();
    await reloadGames();
  } catch (err) {
    showStatus(err.message);
  }
}

async function deleteGame(id) {
  if (!confirm("Delete this game? Its stat entries will also be deleted.")) return;
  try {
    await api(`/api/admin/games/${id}`, { method: "DELETE" });
    showStatus("Game deleted.", true);
    await reloadGames();
  } catch (err) {
    showStatus(err.message);
  }
}

// ---- Enter Game Stats tab --------------------------------------------------------

const STAT_COLS = ["gp", "ab", "r", "h", "b1", "b2", "b3", "hr", "bb", "rbi", "so", "sac", "sb"];
let statsRosterIds = new Set();

async function initStats() {
  if (seasonsCache.length === 0) await loadSeasonsCache();
  if (playersCache.length === 0) await loadPlayersCache();
  populateSeasonSelect(document.getElementById("stats-season-select"));
  document.getElementById("stats-season-select").addEventListener("change", onStatsSeasonChange);
  document.getElementById("stats-game-select").addEventListener("change", onStatsGameChange);
  await onStatsSeasonChange();
}

async function onStatsSeasonChange() {
  const seasonId = document.getElementById("stats-season-select").value;
  const gameSelect = document.getElementById("stats-game-select");
  document.getElementById("stats-grid-wrap").innerHTML = '<p class="muted">Pick a game.</p>';
  if (!seasonId) { gameSelect.innerHTML = ""; return; }

  const [games, rosterIds] = await Promise.all([
    api(`/api/admin/games?season_id=${seasonId}`),
    api(`/api/admin/rosters?season_id=${seasonId}`),
  ]);
  statsRosterIds = new Set(rosterIds);
  gameSelect.innerHTML =
    '<option value="">Select a game…</option>' +
    games.map((g) => `<option value="${g.id}">${g.date || "—"} vs ${escapeHtml(g.opponent || "TBD")}</option>`).join("");
}

async function onStatsGameChange() {
  const gameId = document.getElementById("stats-game-select").value;
  const wrap = document.getElementById("stats-grid-wrap");
  if (!gameId) { wrap.innerHTML = '<p class="muted">Pick a game.</p>'; return; }
  wrap.innerHTML = '<div class="loading">Loading…</div>';

  const rosterPlayers = playersCache.filter((p) => statsRosterIds.has(p.id));
  if (rosterPlayers.length === 0) {
    wrap.innerHTML = '<p class="muted">No players on this season\'s roster yet — add them under Rosters.</p>';
    return;
  }

  let existingStats = [];
  try {
    existingStats = await api(`/api/admin/game-stats?game_id=${gameId}`);
  } catch {
    existingStats = [];
  }
  const statsByPlayer = new Map(existingStats.map((s) => [s.player_id, s]));

  wrap.innerHTML = `
    <div class="admin-grid-table">
      <table class="stats-entry">
        <thead><tr><th>Player</th>${STAT_COLS.map((c) => `<th>${c.toUpperCase()}</th>`).join("")}<th>Save</th></tr></thead>
        <tbody>
          ${rosterPlayers
            .map((p) => {
              const s = statsByPlayer.get(p.id) || {};
              return `<tr data-player-id="${p.id}">
                <td>${escapeHtml(p.name)}</td>
                ${STAT_COLS.map((c) => `<td><input type="number" min="0" data-col="${c}" value="${s[c] ?? 0}"></td>`).join("")}
                <td><button class="btn sm" type="button" data-action="save">Save</button></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <div id="stats-save-result" class="admin-toast"></div>
  `;
  wrap.querySelectorAll("tr[data-player-id]").forEach((row) => {
    const playerId = Number(row.dataset.playerId);
    row.querySelector('[data-action="save"]').addEventListener("click", () => saveGameStatsRow(gameId, playerId, row));
  });
}

async function saveGameStatsRow(gameId, playerId, row) {
  const payload = { game_id: Number(gameId), player_id: playerId };
  row.querySelectorAll("input[data-col]").forEach((inp) => {
    payload[inp.dataset.col] = Number(inp.value) || 0;
  });
  const resultEl = document.getElementById("stats-save-result");
  try {
    await api("/api/admin/game-stats", { method: "POST", body: JSON.stringify(payload) });
    resultEl.textContent = "Saved.";
    resultEl.className = "admin-toast ok";
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.className = "admin-toast err";
  }
}

// ---- boot --------------------------------------------------------------------

switchTab("players");
