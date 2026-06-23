// ═══════════════════════════════════════════════════
// CORE: Storage Wrapper (localStorage)
// ═══════════════════════════════════════════════════

const Storage = (() => {
  const PREFIX = 'agentos_';

  // Isomorphic backend: real localStorage in the browser, an in-memory map
  // under Node (server-side FSM/orchestrator). Same key/value contract either way.
  const backend = (typeof globalThis !== 'undefined' && globalThis.localStorage)
    ? (() => {
        const ls = globalThis.localStorage;
        return {
          getItem: (k) => ls.getItem(k),
          setItem: (k, v) => ls.setItem(k, v),
          removeItem: (k) => ls.removeItem(k),
          keys: () => Object.keys(ls),
        };
      })()
    : (() => {
        const m = new Map();
        return {
          getItem: (k) => (m.has(k) ? m.get(k) : null),
          setItem: (k, v) => { m.set(k, String(v)); },
          removeItem: (k) => { m.delete(k); },
          keys: () => Array.from(m.keys()),
        };
      })();

  /**
   * Save data to the active storage backend
   * @param {string} key
   * @param {*} value
   */
  function set(key, value) {
    try {
      const serialized = JSON.stringify(value);
      backend.setItem(PREFIX + key, serialized);
    } catch (e) {
      console.error(`[Storage] Failed to save "${key}":`, e);
    }
  }

  /**
   * Load data from the active storage backend
   * @param {string} key
   * @param {*} defaultValue
   * @returns {*}
   */
  function get(key, defaultValue = null) {
    try {
      const item = backend.getItem(PREFIX + key);
      if (item === null) return defaultValue;
      return JSON.parse(item);
    } catch (e) {
      console.error(`[Storage] Failed to load "${key}":`, e);
      return defaultValue;
    }
  }

  /**
   * Remove data from the active storage backend
   * @param {string} key
   */
  function remove(key) {
    backend.removeItem(PREFIX + key);
  }

  /**
   * Clear all app data from the active storage backend
   */
  function clear() {
    backend.keys().filter(k => k.startsWith(PREFIX)).forEach(k => backend.removeItem(k));
  }

  /**
   * Check if key exists
   * @param {string} key
   * @returns {boolean}
   */
  function has(key) {
    return backend.getItem(PREFIX + key) !== null;
  }

  return { set, get, remove, clear, has };
})();

export default Storage;
