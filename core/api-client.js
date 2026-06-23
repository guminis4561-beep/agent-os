// ═══════════════════════════════════════════════════
// CORE: API Client (browser → server)
// ═══════════════════════════════════════════════════
//
// Thin fetch wrappers around the Fastify backend plus a single SSE subscriber
// for live task progress. Everything that talks to the server goes through here
// so the rest of the client never hard-codes endpoints.

const BASE = ''; // same origin (Fastify serves UI + API)
const TOKEN_KEY = 'agent_os_token';

/** Read the stored UI token. Falls back gracefully in non-browser environments. */
function storedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

/** Persist a UI token to localStorage so it survives page reloads. */
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

async function request(method, path, body) {
  const opts = { method, headers: {} };
  const token = storedToken();
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty/non-JSON body */ }
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  return data;
}

// ── Config / engine ──────────────────────────────────
export const getConfig = () => request('GET', '/api/config');
export const setConfig = (patch) => request('PUT', '/api/config', patch);
export const getHealth = () => request('GET', '/api/health');
export const getModels = () => request('GET', '/api/models');
export const getOpenRouterModels = () => request('GET', '/api/models/openrouter');
export const testEngine = (prompt) => request('POST', '/api/model/test', { prompt });

// ── Agents ───────────────────────────────────────────
export const getAgents = () => request('GET', '/api/agents');
export const createAgent = (body) => request('POST', '/api/agent', body);
export const updateAgent = (id, body) => request('PUT', `/api/agent/${encodeURIComponent(id)}`, body);
export const deleteAgent = (id) => request('DELETE', `/api/agent/${encodeURIComponent(id)}`);

// ── Tasks ────────────────────────────────────────────
export const startTask = (payload) => request('POST', '/api/task', payload);
export const getTasks = () => request('GET', '/api/tasks');
export const getTask = (id) => request('GET', `/api/task/${encodeURIComponent(id)}`);
export const cancelTask = (id) => request('POST', `/api/task/${encodeURIComponent(id)}/cancel`);
export const resumeTask = (id, body) => request('POST', `/api/task/${encodeURIComponent(id)}/resume`, body);

// ── Market ───────────────────────────────────────────
export const getMarketPrices = (symbols = 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT') =>
  request('GET', `/api/market/prices?symbols=${encodeURIComponent(symbols)}`);
export const getKlines = (symbol, interval = '1h', limit = 200) =>
  request('GET', `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
export const getSentiment = () => request('GET', '/api/market/sentiment');

// ── Paper trading ────────────────────────────────────
export const getPortfolio = () => request('GET', '/api/portfolio');
export const placeOrder = (body) => request('POST', '/api/portfolio/order', body);
export const cancelOrder = (id) => request('POST', `/api/portfolio/order/${encodeURIComponent(id)}/cancel`, {});
export const resetPortfolio = () => request('POST', '/api/portfolio/reset', {});

// ── Backtesting ──────────────────────────────────────
export const runBacktest = (body) => request('POST', '/api/backtest', body);
export const optimizeBacktest = (body) => request('POST', '/api/backtest/optimize', body);
export const getStrategies = () => request('GET', '/api/backtest/strategies');

// ── Bots ─────────────────────────────────────────────
export const getBots = () => request('GET', '/api/bots');
export const createBot = (body) => request('POST', '/api/bots', body);
export const updateBot = (id, patch) => request('PUT', `/api/bots/${encodeURIComponent(id)}`, patch);
export const setAllBots = (enabled) => request('POST', '/api/bots/all', { enabled });
export const deleteBot = (id) => request('DELETE', `/api/bots/${encodeURIComponent(id)}`);
export const parseBotSetup = (text, modelId) => request('POST', '/api/bots/parse', { text, modelId });

// ── Workspace ────────────────────────────────────────
export const getWorkspaceFiles = (root) =>
  request('GET', `/api/workspace/files?root=${encodeURIComponent(root)}`);
export const getWorkspaceFile = (root, path) =>
  request('GET', `/api/workspace/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`);
export const writeWorkspaceFile = (root, path, content) =>
  request('POST', '/api/workspace/file', { root, path, content });

// ── Memory Fabric ────────────────────────────────────
export const getMemory = (params = {}) => {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
  ).toString();
  return request('GET', `/api/memory${q ? `?${q}` : ''}`);
};
export const getMemorySummary = () => request('GET', '/api/memory/summary');
export const getUsage = () => request('GET', '/api/usage');
export const sendChat = (messages, modelId) => request('POST', '/api/chat', { messages, modelId: modelId || undefined });
export const resetUsage = () => request('POST', '/api/usage/reset');
export const getMemoryWorkspaceSummary = () => request('GET', '/api/memory/workspace-summary');

// ── Live event stream (SSE) ──────────────────────────
// Server emits named events; payload JSON carries { event, ...data }.
const STREAMED = [
  'task:created', 'task:stateChange', 'task:subStateChange',
  'task:log', 'task:error', 'task:done',
];

/**
 * Subscribe to the server event stream with exponential backoff reconnection.
 * @param {(name: string, data: object) => void} onEvent
 * @returns {() => void} unsubscribe
 */
export function subscribeEvents(onEvent) {
  let source = null;
  let retryDelay = 1000;   // ms — starts at 1s, caps at 30s
  let retryTimer = null;
  let stopped = false;

  function connect() {
    const token = storedToken();
    const url = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
    source = new EventSource(url);

    STREAMED.forEach((name) => {
      source.addEventListener(name, (ev) => {
        let data = {};
        try { data = JSON.parse(ev.data); } catch { /* ignore malformed frame */ }
        onEvent(name, data);
      });
    });

    source.addEventListener('ready', () => {
      retryDelay = 1000; // reset backoff on successful connection
      onEvent('sys:reconnected', {});
    });

    source.addEventListener('error', () => {
      source.close();
      if (stopped) return;
      retryTimer = setTimeout(() => {
        if (!stopped) connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    });
  }

  connect();

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    source?.close();
  };
}
