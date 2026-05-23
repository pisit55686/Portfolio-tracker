/**
 * sync.js — Offline-first Google Sheets sync
 * Vanilla JS, no frameworks, works on iPhone Safari
 *
 * Usage:
 *   import Sync from './sync.js'   (or load as <script>)
 *   Sync.init({ scriptUrl, token })
 *   await Sync.saveTransaction(tx)
 *   const txs = await Sync.loadTransactions()
 *   await Sync.push()   // local → cloud
 *   await Sync.pull()   // cloud → local
 */

const Sync = (() => {
  // ─── Private state ──────────────────────────────────────────────────────────
  const LS_KEY       = "dca_transactions";
  const QUEUE_KEY    = "dca_sync_queue";
  const META_KEY     = "dca_sync_meta";
  const MAX_RETRIES  = 3;
  const RETRY_DELAY  = 2000; // ms

  let _scriptUrl = "";
  let _token     = "";
  let _syncing   = false;

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init({ scriptUrl, token }) {
    if (!scriptUrl || !token) throw new Error("scriptUrl and token are required");
    _scriptUrl = scriptUrl;
    _token     = token;

    // Auto-flush queue when coming back online
    window.addEventListener("online", () => {
      console.log("[Sync] Back online — flushing queue");
      push().catch(console.warn);
    });

    console.log("[Sync] Initialized. Online:", navigator.onLine);
  }

  // ─── Local Storage helpers ───────────────────────────────────────────────────
  function lsGet(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.error("[Sync] localStorage write failed:", e); return false; }
  }

  function getTransactions()          { return lsGet(LS_KEY, []); }
  function setTransactions(txs)       { return lsSet(LS_KEY, txs); }
  function getQueue()                 { return lsGet(QUEUE_KEY, []); }
  function setQueue(q)                { return lsSet(QUEUE_KEY, q); }
  function getMeta()                  { return lsGet(META_KEY, {}); }
  function setMeta(meta)              { return lsSet(META_KEY, meta); }

  // ─── Queue management ────────────────────────────────────────────────────────
  function enqueue(tx) {
    const q = getQueue();
    // Replace if same id already in queue (latest wins)
    const idx = q.findIndex(t => t.id === tx.id);
    if (idx >= 0) q[idx] = tx; else q.push(tx);
    setQueue(q);
  }

  function clearQueue() { setQueue([]); }

  // ─── API call with retry ─────────────────────────────────────────────────────
  async function apiCall(action, body = {}, attempt = 1) {
    const url = `${_scriptUrl}?action=${action}&token=${encodeURIComponent(_token)}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        // Apps Script requires no-cors for some deployments;
        // using mode: "cors" works when deployed as "Anyone" access
        headers: { "Content-Type": "text/plain" }, // text/plain avoids CORS preflight
        body: JSON.stringify({ action, token: _token, ...body }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.ok && data.error === "Unauthorized") throw new Error("Unauthorized — check your token");
      return data;

    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.warn(`[Sync] Attempt ${attempt} failed (${err.message}), retrying...`);
        await sleep(RETRY_DELAY * attempt);
        return apiCall(action, body, attempt + 1);
      }
      throw err;
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Save a transaction locally + enqueue for cloud sync
   * @param {Object} tx - { id, ticker, type, price, qty, date, note, currency }
   */
  async function saveTransaction(tx) {
    if (!tx.id)        tx.id = `tx_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    if (!tx.updatedAt) tx.updatedAt = new Date().toISOString();

    // 1. Write to localStorage immediately (offline-first)
    const all = getTransactions();
    const idx = all.findIndex(t => t.id === tx.id);
    if (idx >= 0) all[idx] = tx; else all.push(tx);
    setTransactions(all);

    // 2. Enqueue for sync
    enqueue(tx);

    // 3. Try immediate sync if online
    if (navigator.onLine) {
      try { await push(); } catch (e) { console.warn("[Sync] Immediate sync failed, queued:", e.message); }
    }

    return tx;
  }

  /**
   * Load transactions (always from localStorage, optionally refresh from cloud)
   * @param {boolean} fromCloud - force a cloud pull first
   */
  async function loadTransactions(fromCloud = false) {
    if (fromCloud && navigator.onLine) {
      try { await pull(); } catch (e) { console.warn("[Sync] Pull failed, using local:", e.message); }
    }
    return getTransactions();
  }

  /**
   * Push: flush local sync queue → Google Sheets
   * Sends all pending transactions in one batch
   */
  async function push() {
    if (_syncing) return { ok: false, reason: "already syncing" };
    const queue = getQueue();
    if (!queue.length) return { ok: true, synced: 0 };

    _syncing = true;
    dispatchEvent("syncStart", { pending: queue.length });

    try {
      const result = await apiCall("sync", { transactions: queue });
      if (result.ok) {
        clearQueue();
        // Merge cloud state back to localStorage
        // Cloud is authoritative for syncedAt timestamps
        _mergeIntoLocal(result.transactions || []);
        const meta = getMeta();
        setMeta({ ...meta, lastPushed: new Date().toISOString() });
        dispatchEvent("syncSuccess", { synced: queue.length });
        console.log(`[Sync] Pushed ${queue.length} transactions`);
      }
      return result;
    } catch (err) {
      dispatchEvent("syncError", { error: err.message });
      throw err;
    } finally {
      _syncing = false;
    }
  }

  /**
   * Pull: overwrite localStorage with Google Sheets data
   * Use when restoring to a new device
   */
  async function pull() {
    dispatchEvent("syncStart", { direction: "pull" });
    try {
      const result = await apiCall("restore");
      if (result.ok && Array.isArray(result.transactions)) {
        setTransactions(result.transactions);
        clearQueue(); // local is now in sync
        const meta = getMeta();
        setMeta({ ...meta, lastPulled: new Date().toISOString() });
        dispatchEvent("syncSuccess", { pulled: result.transactions.length });
        console.log(`[Sync] Pulled ${result.transactions.length} transactions`);
      }
      return result;
    } catch (err) {
      dispatchEvent("syncError", { error: err.message });
      throw err;
    }
  }

  /**
   * Ping the backend to verify connectivity + token
   */
  async function ping() {
    try {
      const res = await apiCall("ping");
      return res.ok === true;
    } catch { return false; }
  }

  /**
   * Get sync status summary
   */
  function getStatus() {
    const meta  = getMeta();
    const queue = getQueue();
    return {
      online:      navigator.onLine,
      pendingSync: queue.length,
      lastPushed:  meta.lastPushed  || null,
      lastPulled:  meta.lastPulled  || null,
      isSyncing:   _syncing,
    };
  }

  /**
   * Delete a transaction locally + sync deletion
   * Soft-delete: marks as deleted=true so cloud stays consistent
   */
  async function deleteTransaction(id) {
    const all = getTransactions().map(tx =>
      tx.id === id ? { ...tx, deleted: true, updatedAt: new Date().toISOString() } : tx
    );
    setTransactions(all);
    const deleted = all.find(tx => tx.id === id);
    if (deleted) enqueue(deleted);
    if (navigator.onLine) push().catch(console.warn);
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  // Merge cloud transactions into local, last-write-wins by updatedAt
  function _mergeIntoLocal(cloudTxs) {
    const local  = getTransactions();
    const merged = { ...Object.fromEntries(local.map(t => [t.id, t])) };
    cloudTxs.forEach(ct => {
      const local = merged[ct.id];
      if (!local || _isNewer(ct.syncedAt, local.updatedAt)) {
        merged[ct.id] = ct;
      }
    });
    setTransactions(Object.values(merged));
  }

  function _isNewer(a, b) {
    if (!b) return true;
    if (!a) return false;
    return new Date(a) > new Date(b);
  }

  function dispatchEvent(name, detail = {}) {
    try { window.dispatchEvent(new CustomEvent(`sync:${name}`, { detail })); }
    catch {}
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  return { init, saveTransaction, loadTransactions, push, pull, ping, getStatus, deleteTransaction };
})();

// Support both ES module and script tag
if (typeof module !== "undefined") module.exports = Sync;
