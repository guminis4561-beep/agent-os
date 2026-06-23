// ═══════════════════════════════════════════════════
// CORE: State Management (Pub/Sub Pattern)
// ═══════════════════════════════════════════════════

import { WORKSPACES, AGENTS, WORKFLOWS, MEMORY_LAYERS } from '../data/mock-data.js';
import Storage from './storage.js';

const AppState = (() => {
  // Internal state
  let state = {
    activeView: 'dashboard',
    activeWorkspace: Storage.get('activeWorkspace', 'ws-1'),
    selectedItem: null,
    inspectorOpen: true,
    sidebarCollapsed: false,
    commandPaletteOpen: false,
    theme: Storage.get('theme', 'dark'),
    notifications: [],
    toasts: [],
    workspaces: Storage.get('workspaces', WORKSPACES),
    agents: Storage.get('agents', AGENTS),
    workflows: Storage.get('workflows', WORKFLOWS),
    memoryLayers: Storage.get('memoryLayers', MEMORY_LAYERS),
    // FSM Task Execution state
    taskExecution: null,          // Current active task's public context (or null)
    taskHistory: Storage.get('taskHistory', []),  // Completed tasks history
  };

  // Subscribers map: { key: [callback, ...] }
  const subscribers = new Map();

  /**
   * Get current state or a specific key
   * @param {string} [key] - Optional state key
   * @returns {*} Full state or specific value
   */
  function getState(key) {
    if (key) return state[key];
    return { ...state };
  }

  /**
   * Update state and notify subscribers
   * @param {string} key - State key to update
   * @param {*} value - New value
   */
  function setState(key, value) {
    const oldValue = state[key];
    if (oldValue === value) return;
    
    state[key] = value;
    
    // Notify key-specific subscribers
    if (subscribers.has(key)) {
      subscribers.get(key).forEach(cb => {
        try {
          cb(value, oldValue, key);
        } catch (e) {
          console.error(`[State] Error in subscriber for "${key}":`, e);
        }
      });
    }
    
    // Notify wildcard subscribers
    if (subscribers.has('*')) {
      subscribers.get('*').forEach(cb => {
        try {
          cb(value, oldValue, key);
        } catch (e) {
          console.error(`[State] Error in wildcard subscriber:`, e);
        }
      });
    }
  }

  /**
   * Subscribe to state changes
   * @param {string} key - State key to watch ('*' for all)
   * @param {Function} callback - (newValue, oldValue, key) => void
   * @returns {Function} Unsubscribe function
   */
  function subscribe(key, callback) {
    if (!subscribers.has(key)) {
      subscribers.set(key, []);
    }
    subscribers.get(key).push(callback);
    
    // Return unsubscribe function
    return () => {
      const subs = subscribers.get(key);
      if (subs) {
        const idx = subs.indexOf(callback);
        if (idx > -1) subs.splice(idx, 1);
      }
    };
  }

  /**
   * Batch update multiple state keys
   * @param {Object} updates - { key: value, ... }
   */
  function batchUpdate(updates) {
    Object.entries(updates).forEach(([key, value]) => {
      setState(key, value);
    });
  }

  // Auto-save to Storage
  subscribe('*', (value, oldValue, key) => {
    const persistKeys = ['workspaces', 'agents', 'activeWorkspace', 'theme', 'workflows', 'memoryLayers', 'taskHistory'];
    if (persistKeys.includes(key)) {
      Storage.set(key, value);
    }
  });

  return {
    getState,
    setState,
    subscribe,
    batchUpdate,
  };
})();

export default AppState;
