/**
 * sync-ui.js — Drop-in sync status UI widget
 * Add <div id="sync-widget"></div> anywhere in your HTML
 * then call SyncUI.init() after Sync.init()
 */

const SyncUI = (() => {
  let _container = null;

  function init(containerId = "sync-widget") {
    _container = document.getElementById(containerId);
    if (!_container) { console.warn("[SyncUI] Container not found:", containerId); return; }

    _render();

    // Listen to sync events
    window.addEventListener("sync:syncStart",   () => _setState("syncing"));
    window.addEventListener("sync:syncSuccess", () => { _setState("ok"); _render(); });
    window.addEventListener("sync:syncError",   (e) => _setState("error", e.detail?.error));
    window.addEventListener("online",  _render);
    window.addEventListener("offline", _render);

    // Refresh status every 30s
    setInterval(_render, 30_000);
  }

  function _state(status, msg) {
    const map = {
      ok:      { icon: "☁️", label: "Synced",   color: "#4ade80" },
      syncing: { icon: "🔄", label: "Syncing…", color: "#fbbf24" },
      error:   { icon: "⚠️", label: msg || "Sync error", color: "#f87171" },
      offline: { icon: "📵", label: "Offline",  color: "#94a3b8" },
      pending: { icon: "⏳", label: "Pending",  color: "#fbbf24" },
    };
    return map[status] || map.ok;
  }

  let _currentStatus = "ok";
  let _currentMsg    = "";

  function _setState(status, msg = "") {
    _currentStatus = status;
    _currentMsg    = msg;
    _render();
  }

  function _render() {
    if (!_container) return;

    const s        = Sync.getStatus();
    const isOffline = !s.online;
    const hasPending = s.pendingSync > 0;

    let status = _currentStatus;
    if (isOffline)   status = "offline";
    else if (hasPending && !s.isSyncing) status = "pending";

    const state = _state(status, _currentMsg);
    const lastSync = s.lastPushed
      ? `Last sync: ${_timeAgo(s.lastPushed)}`
      : "Never synced";

    _container.innerHTML = `
      <div class="sync-widget" onclick="SyncUI.manualSync()" title="${lastSync}" style="
        display:inline-flex;align-items:center;gap:6px;
        background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
        border-radius:20px;padding:5px 12px;cursor:pointer;user-select:none;
        font-size:12px;font-weight:600;color:${state.color};
        transition:all .2s;
      ">
        <span style="font-size:14px;${s.isSyncing ? 'animation:spin 1s linear infinite;display:inline-block' : ''}">${state.icon}</span>
        <span>${state.label}${hasPending && !isOffline ? ` (${s.pendingSync})` : ''}</span>
      </div>
      <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
    `;
  }

  async function manualSync() {
    if (!navigator.onLine) { alert("You're offline — sync will resume when connected."); return; }
    _setState("syncing");
    try {
      await Sync.push();
      _setState("ok");
    } catch (err) {
      _setState("error", err.message);
      alert("Sync failed: " + err.message);
    }
  }

  function _timeAgo(iso) {
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60)   return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  }

  return { init, manualSync };
})();
