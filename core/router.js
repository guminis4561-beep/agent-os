// ═══════════════════════════════════════════════════
// CORE: Hash-based SPA Router
// ═══════════════════════════════════════════════════

const Router = (() => {
  const routes = new Map();
  let currentRoute = null;
  let onNavigateCallback = null;

  /**
   * Register a route
   * @param {string} path - Route hash path (e.g., 'dashboard')
   * @param {Function} handler - View render function
   */
  function register(path, handler) {
    routes.set(path, handler);
  }

  /**
   * Navigate to a route
   * @param {string} path - Route to navigate to
   */
  function navigate(path) {
    window.location.hash = `#/${path}`;
  }

  /**
   * Set callback for navigation events
   * @param {Function} callback - (routePath, handler) => void
   */
  function onNavigate(callback) {
    onNavigateCallback = callback;
  }

  /**
   * Parse the current hash
   * @returns {string} Route path
   */
  function parseHash() {
    const hash = window.location.hash.slice(2) || 'dashboard';
    return hash;
  }

  /**
   * Handle hash change
   */
  function handleHashChange() {
    const path = parseHash();
    
    if (path === currentRoute) return;
    currentRoute = path;
    
    const handler = routes.get(path);
    if (handler && onNavigateCallback) {
      onNavigateCallback(path, handler);
    } else if (onNavigateCallback) {
      // Fallback to dashboard
      const fallback = routes.get('dashboard');
      if (fallback) {
        onNavigateCallback('dashboard', fallback);
      }
    }
  }

  /**
   * Initialize the router
   */
  function init() {
    window.addEventListener('hashchange', handleHashChange);
    // Trigger initial route
    handleHashChange();
  }

  /**
   * Get current route
   * @returns {string}
   */
  function getCurrentRoute() {
    return currentRoute || parseHash();
  }

  /**
   * Destroy the router
   */
  function destroy() {
    window.removeEventListener('hashchange', handleHashChange);
  }

  return {
    register,
    navigate,
    onNavigate,
    init,
    getCurrentRoute,
    destroy,
  };
})();

export default Router;
