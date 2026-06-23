// ═══════════════════════════════════════════════════
// CORE: Event Bus (Cross-component communication)
// ═══════════════════════════════════════════════════

const EventBus = (() => {
  const listeners = new Map();

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Event handler
   * @returns {Function} Unsubscribe function
   */
  function on(event, callback) {
    if (!listeners.has(event)) {
      listeners.set(event, []);
    }
    listeners.get(event).push(callback);
    
    return () => off(event, callback);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {Function} callback - Event handler to remove
   */
  function off(event, callback) {
    const cbs = listeners.get(event);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx > -1) cbs.splice(idx, 1);
    }
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  function emit(event, data) {
    const cbs = listeners.get(event);
    if (cbs) {
      cbs.forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`[EventBus] Error in handler for "${event}":`, e);
        }
      });
    }
  }

  /**
   * Subscribe to an event once
   * @param {string} event - Event name
   * @param {Function} callback - Event handler
   */
  function once(event, callback) {
    const wrapper = (data) => {
      off(event, wrapper);
      callback(data);
    };
    on(event, wrapper);
  }

  return { on, off, emit, once };
})();

export default EventBus;
