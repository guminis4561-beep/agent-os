// ═══════════════════════════════════════════════════
// SERVER: Fastify entrypoint
// ═══════════════════════════════════════════════════
//
// Serves the existing vanilla-JS client AND the platform API. Task execution is
// real (GLM 5.2 via the orchestrator); live progress streams to the browser over
// Server-Sent Events. The GLM key stays server-side and is never served.

import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';

import EventBus from '../core/events.js';
import { PUBLIC_ROOT } from './paths.js';
import { getPublicConfig, setConfig, getUiToken, getAvailableModels } from './config-store.js';
import { callModel, callChatModel, ModelError } from './model-adapter.js';
import { runTask, getTask, listTasks, cancelTask, resumeTask } from './orchestrator.js';
import { listProfiles } from './agent-registry.js';
import { listEngineNames, getConfig } from './config-store.js';
import * as Memory from './memory-store.js';
import * as Usage from './usage-store.js';
import * as AgentStore from './agent-store.js';
import * as Portfolio from './portfolio-store.js';
import * as Bots from './bots-store.js';
import { runBacktest, optimize, listStrategies, STRATEGY_PARAMS, supportResistance, sma, ema, rsi } from './trading/indicators.js';
import { startScheduler, fetchPrices, fetchSentiment } from './trading/scheduler.js';
import { listFiles, readFiles, writeFiles as wsWriteFiles, assertWorkspace, WorkspaceError } from './tools/workspace.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

// ── Rate limiting ─────────────────────────────────────
await app.register(fastifyRateLimit, {
  global: false, // only routes that opt-in via { config: { rateLimit: ... } }
  keyGenerator: (req) => req.ip,
  errorResponseBuilder: (_req, ctx) => ({
    ok: false,
    code: 'RATE_LIMITED',
    message: `Per daug užklausų — palaukite ${Math.ceil(ctx.ttl / 1000)}s.`,
    retryAfter: Math.ceil(ctx.ttl / 1000),
  }),
});

// ── Block any request to server-owned paths before static serving sees it. ──
const BLOCKED = /^\/(\.data|server|node_modules)(\/|$)/;
app.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (BLOCKED.test(path) || path === '/package.json' || path === '/package-lock.json') {
    reply.code(404).send({ error: 'Not found' });
  }
});

// ── Authentication ────────────────────────────────────
// Constant-time token comparison to prevent timing attacks.
function safeTokenCompare(a, b) {
  try {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    const len = Math.max(aBuf.length, bBuf.length);
    const aFull = Buffer.concat([aBuf, Buffer.alloc(len - aBuf.length)]);
    const bFull = Buffer.concat([bBuf, Buffer.alloc(len - bBuf.length)]);
    return timingSafeEqual(aFull, bFull) && aBuf.length === bBuf.length;
  } catch {
    return false;
  }
}

// Protects all /api/* routes except /api/health (kept public for status checks).
// SSE (/api/events) accepts a ?token= query param because EventSource cannot
// send custom headers from the browser.
app.addHook('preHandler', async (req, reply) => {
  const urlPath = req.url.split('?')[0];
  if (!urlPath.startsWith('/api/')) return;
  if (urlPath === '/api/health') return;

  const token = await getUiToken();
  // No token configured → local open mode (this is a single-user local tool).
  // Auth only kicks in once a uiToken / API_KEY is actually set.
  if (!token) return;

  const provided =
    req.query?.token ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  if (!provided) {
    return reply.code(401).send({ ok: false, code: 'UNAUTHORIZED', message: 'Authentication required. Token missing.' });
  }
  if (!safeTokenCompare(provided, token)) {
    return reply.code(403).send({ ok: false, code: 'FORBIDDEN', message: 'Invalid token.' });
  }
});

// ── API ──────────────────────────────────────────────

app.get('/api/health', async () => {
  const cfg = await getPublicConfig();
  return { ok: true, service: 'agent-os', model: cfg.glmModel, hasApiKey: cfg.hasApiKey, hasUiToken: cfg.hasUiToken, time: Date.now() };
});

app.get('/api/config', async () => getPublicConfig());

app.put('/api/config', async (req) => setConfig(req.body || {}));

// Selectable model ids for the per-task picker and the Hermes per-agent override.
app.get('/api/models', async () => {
  const cfg = await getPublicConfig();
  return { models: await getAvailableModels(), defaultModel: cfg.glmModel, judgeModel: cfg.judgeModel };
});

// Live OpenRouter catalogue — every model id available to the configured key.
// Used by the Hermes "Sync from OpenRouter" button to populate availableModels.
// Limit: 10 req / 60s — the list rarely changes.
app.get('/api/models/openrouter', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return reply.code(502).send({ ok: false, error: `OpenRouter ${res.status}` });
    const data = await res.json();
    const models = [...new Set((data.data || []).map((m) => m.id).filter(Boolean))].sort();
    return { ok: true, models, count: models.length };
  } catch (err) {
    return reply.code(502).send({ ok: false, error: err.message });
  }
});

// One-shot engine smoke test — confirms the OpenRouter key/endpoint work.
// Limit: 5 req / 60s — prevents accidental token burn.
app.post('/api/model/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const prompt = (req.body && req.body.prompt) || 'Reply with the single word: ok';
  try {
    const { text, usage, model } = await callModel({
      messages: [{ role: 'user', content: String(prompt) }],
      maxTokens: 64,
    });
    return { ok: true, model, text, usage };
  } catch (err) {
    app.log.error({ code: err.code, detail: err.detail }, 'model/test failed');
    return reply.code(err instanceof ModelError && err.code === 'NO_API_KEY' ? 400 : 502)
      .send({ ok: false, code: err.code || 'ERROR', message: err.message, detail: err.detail });
  }
});

// Start a real task. Returns the id immediately; progress arrives via /api/events.
// Limit: 20 req / 60s — prevents runaway task loops.
const taskSchema = {
  body: {
    type: 'object',
    required: ['intent'],
    properties: {
      intent: { type: 'string', minLength: 1 },
      domainEngine: { type: 'string' },
      agentName: { type: 'string' },
      workspaceId: { type: 'string' },
      modelId: { type: 'string' }
    }
  }
};
app.post('/api/task', { schema: taskSchema, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
  try {
    const { intent, domainEngine, agentName, workspaceId, modelId } = req.body || {};
    const { taskId } = await runTask({ intent, domainEngine, agentName, workspaceId, modelId });
    return { ok: true, taskId };
  } catch (err) {
    return reply.code(400).send({ ok: false, message: err.message });
  }
});

app.get('/api/tasks', async () => ({ tasks: listTasks() }));

app.get('/api/task/:id', async (req, reply) => {
  const task = getTask(req.params.id);
  if (!task) return reply.code(404).send({ error: 'Unknown task' });
  return task;
});

// Abort a running (or review-paused) task → CANCELLED.
app.post('/api/task/:id/cancel', async (req, reply) => {
  const result = cancelTask(req.params.id);
  if (!result.ok) return reply.code(result.error === 'Unknown task' ? 404 : 409).send(result);
  return result;
});

const VALID_RESUME_ACTIONS = new Set(['approve', 'rework']);

// Resume a REVIEW_REQUIRED task: { action: 'approve' | 'rework', feedback? }.
const resumeSchema = {
  body: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['approve', 'rework'] },
      feedback: { type: 'string' }
    }
  }
};
app.post('/api/task/:id/resume', { schema: resumeSchema }, async (req, reply) => {
  const { action, feedback } = req.body || {};
  if (!VALID_RESUME_ACTIONS.has(action)) {
    return reply.code(400).send({ ok: false, code: 'INVALID_ACTION', message: `action must be one of: ${[...VALID_RESUME_ACTIONS].join(', ')}` });
  }
  const result = await resumeTask(req.params.id, { action, feedback });
  if (!result.ok) return reply.code(result.error === 'Unknown task' ? 404 : 409).send(result);
  return result;
});

// Hermes agent registry — built-in profiles + user-created custom agents.
app.get('/api/agents', async () => {
  const cfg = await getConfig();
  const overrides = cfg.agentEngines || {};
  const builtIn = listProfiles().map((p) => ({
    ...p,
    defaultEngine: p.engine,
    engine: overrides[p.id] || p.engine,
    custom: false,
  }));
  const custom = await AgentStore.listCustom();
  return { agents: [...builtIn, ...custom], engines: await listEngineNames() };
});

// Create a new custom agent.
app.post('/api/agent', async (req, reply) => {
  try {
    const agent = await AgentStore.createAgent(req.body || {});
    return { ok: true, agent };
  } catch (err) {
    return reply.code(400).send({ ok: false, message: err.message });
  }
});

// Update a custom agent.
app.put('/api/agent/:id', async (req, reply) => {
  const updated = await AgentStore.updateAgent(req.params.id, req.body || {});
  if (!updated) return reply.code(404).send({ ok: false, error: 'Not found or built-in agent' });
  return { ok: true, agent: updated };
});

// Delete a custom agent.
app.delete('/api/agent/:id', async (req, reply) => {
  const removed = await AgentStore.deleteAgent(req.params.id);
  if (!removed) return reply.code(404).send({ ok: false, error: 'Not found or built-in agent' });
  return { ok: true };
});

// ── Market data proxy (Binance public API) ───────────

// Limit: 30 req / 60s — Binance public API allows ~1200/min per IP, but 30 is plenty for one user.
app.get('/api/market/prices', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
  const raw = (req.query.symbols || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT').toUpperCase();
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
  const param = JSON.stringify(symbols);
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(param)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return reply.code(502).send({ error: `Binance ${res.status}` });
    const data = await res.json();
    const prices = data.map(t => ({
      symbol:   t.symbol,
      price:    parseFloat(t.lastPrice),
      change:   parseFloat(t.priceChangePercent),
      high:     parseFloat(t.highPrice),
      low:      parseFloat(t.lowPrice),
      volume:   parseFloat(t.volume),
      quoteVol: parseFloat(t.quoteVolume),
    }));
    return { prices, ts: Date.now() };
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

// Historical candles + computed support/resistance and moving averages.
// Binance intervals: lowercase m = minutes, uppercase M = month.
const VALID_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w', '1M']);
app.get('/api/market/klines', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
  const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase().trim();
  const interval = VALID_INTERVALS.has(req.query.interval) ? req.query.interval : '1h';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 10), 1000);
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return reply.code(502).send({ error: `Binance ${res.status}` });
    const raw = await res.json();
    let vwapD = [];
    let vwapW = [];
    let vwapM = [];
    let cvd = [];
    let cumDelta = 0;
    
    let sumPVD = 0, sumVD = 0, currentAnchorD = null;
    let sumPVW = 0, sumVW = 0, currentAnchorW = null;
    let sumPVM = 0, sumVM = 0, currentAnchorM = null;

    const candles = raw.map((d) => {
      const time = Math.floor(d[0] / 1000);
      const open = parseFloat(d[1]);
      const high = parseFloat(d[2]);
      const low = parseFloat(d[3]);
      const close = parseFloat(d[4]);
      const volume = parseFloat(d[5]);
      const takerBuyVol = parseFloat(d[9]);
      
      const sellVol = volume - takerBuyVol;
      const delta = takerBuyVol - sellVol;
      cumDelta += delta;
      cvd.push(cumDelta);

      const date = new Date(time * 1000);
      
      // Daily Anchor
      const anchorD = date.getUTCFullYear() + '-' + date.getUTCMonth() + '-' + date.getUTCDate();
      if (currentAnchorD !== anchorD) { currentAnchorD = anchorD; sumPVD = 0; sumVD = 0; }
      
      // Weekly Anchor (Monday start)
      const day = date.getUTCDay();
      const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(date.getTime());
      weekStart.setUTCDate(diff);
      const anchorW = weekStart.getUTCFullYear() + '-' + weekStart.getUTCMonth() + '-' + weekStart.getUTCDate();
      if (currentAnchorW !== anchorW) { currentAnchorW = anchorW; sumPVW = 0; sumVW = 0; }
      
      // Monthly Anchor
      const anchorM = date.getUTCFullYear() + '-' + date.getUTCMonth();
      if (currentAnchorM !== anchorM) { currentAnchorM = anchorM; sumPVM = 0; sumVM = 0; }
      
      const typicalPrice = (high + low + close) / 3;
      
      sumPVD += typicalPrice * volume; sumVD += volume; vwapD.push(sumPVD / sumVD);
      sumPVW += typicalPrice * volume; sumVW += volume; vwapW.push(sumPVW / sumVW);
      sumPVM += typicalPrice * volume; sumVM += volume; vwapM.push(sumPVM / sumVM);

      return { time, open, high, low, close, volume, delta };
    });
    
    const closes = candles.map((c) => c.close);
    const levels = supportResistance(candles);
    return {
      symbol, interval, candles,
      indicators: {
        sma20: sma(closes, 20), sma50: sma(closes, 50), ema9: ema(closes, 9),
        rsi14: rsi(closes, 14), vwapD, vwapW, vwapM, cvd
      },
      levels: { support: levels.support, resistance: levels.resistance },
    };
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

// Fear & Greed market sentiment (alternative.me, free, no key).
app.get('/api/market/sentiment', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (_req, reply) => {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=2', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return reply.code(502).send({ error: `FNG ${res.status}` });
    const json = await res.json();
    const cur = json?.data?.[0];
    const prev = json?.data?.[1];
    if (!cur) return reply.code(502).send({ error: 'No sentiment data' });
    return {
      value: Number(cur.value),
      classification: cur.value_classification,
      previous: prev ? Number(prev.value) : null,
      ts: Number(cur.timestamp) * 1000,
    };
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

// ── Paper-trading portfolio ──────────────────────────

// Portfolio snapshot — marked to market against live prices for held symbols.
app.get('/api/portfolio', async (_req, reply) => {
  try {
    const pf0 = await Portfolio.getPortfolio();
    const symbols = [...new Set([...pf0.positions.map((p) => p.symbol), ...pf0.pendingOrders.map((o) => o.symbol)])];
    let priceMap = {};
    if (symbols.length) {
      try {
        const live = await fetchPrices(symbols);
        priceMap = Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.price]));
      } catch { /* fall back to avg cost */ }
    }
    return await Portfolio.getPortfolio(priceMap);
  } catch (err) {
    return reply.code(500).send({ ok: false, message: err.message });
  }
});

const orderSchema = {
  body: {
    type: 'object',
    required: ['symbol', 'side'],
    properties: {
      symbol: { type: 'string', minLength: 3 },
      side: { type: 'string', enum: ['buy', 'sell'] },
      type: { type: 'string', enum: ['market', 'limit'] },
      qty: { type: 'number' },
      quoteAmount: { type: 'number' },
      limitPrice: { type: 'number' },
    },
  },
};
app.post('/api/portfolio/order', { schema: orderSchema, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
  const body = req.body || {};
  try {
    let price = null;
    if ((body.type || 'market') === 'market') {
      const live = await fetchPrices([body.symbol]);
      price = live[String(body.symbol).toUpperCase()]?.price ?? null;
    }
    const result = await Portfolio.placeOrder(body, price);
    if (!result.ok) return reply.code(400).send({ ok: false, message: result.error });
    EventBus.emit('portfolio:update', { ts: Date.now() });
    return { ok: true, ...result };
  } catch (err) {
    return reply.code(502).send({ ok: false, message: err.message });
  }
});

app.post('/api/portfolio/order/:id/cancel', async (req, reply) => {
  const r = await Portfolio.cancelOrder(req.params.id);
  if (!r.ok) return reply.code(404).send(r);
  EventBus.emit('portfolio:update', { ts: Date.now() });
  return r;
});

app.post('/api/portfolio/reset', async () => ({ ok: true, portfolio: await Portfolio.reset() }));

// ── Backtesting ──────────────────────────────────────

app.get('/api/backtest/strategies', async () => ({ strategies: listStrategies(), params: STRATEGY_PARAMS }));

// Fetch + normalize candles for a symbol/interval (shared by backtest + optimize).
async function fetchCandles(symbol, interval, limit) {
  const iv = VALID_INTERVALS.has(interval) ? interval : '1h';
  const lim = Math.min(Math.max(parseInt(limit, 10) || 500, 50), 1000);
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${String(symbol).toUpperCase()}&interval=${iv}&limit=${lim}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const raw = await res.json();
  return {
    interval: iv,
    candles: raw.map((d) => ({ time: Math.floor(d[0] / 1000), open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] })),
  };
}

// Pull execution options (shared by backtest + optimize) from a request body.
function execOpts(b = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    direction: ['long', 'short', 'both'].includes(b.direction) ? b.direction : 'long',
    stopLoss: Math.max(0, num(b.stopLoss, 0)) / 100,      // UI sends %, engine wants fraction
    takeProfit: Math.max(0, num(b.takeProfit, 0)) / 100,
    slippage: Math.max(0, num(b.slippage, 0)) / 100,
    positionPct: Math.min(Math.max(num(b.positionPct, 100), 5), 100) / 100,
    fillAt: b.fillAt === 'nextOpen' ? 'nextOpen' : 'close',
  };
}

const backtestSchema = {
  body: {
    type: 'object',
    required: ['symbol', 'strategy'],
    properties: {
      symbol: { type: 'string', minLength: 3 },
      strategy: { type: 'string' },
      interval: { type: 'string' },
      limit: { type: 'number' },
      params: { type: 'object', additionalProperties: true },
      direction: { type: 'string' },
      stopLoss: { type: 'number' }, takeProfit: { type: 'number' },
      slippage: { type: 'number' }, positionPct: { type: 'number' },
      fillAt: { type: 'string' },
    },
  },
};
app.post('/api/backtest', { schema: backtestSchema, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
  const { symbol, strategy, interval = '1h', limit = 500, params = {} } = req.body || {};
  try {
    const { interval: iv, candles } = await fetchCandles(symbol, interval, limit);
    const result = runBacktest(candles, { strategy, params, ...execOpts(req.body) });
    return { ok: true, symbol: String(symbol).toUpperCase(), interval: iv, result };
  } catch (err) {
    return reply.code(err.message?.startsWith('Binance') ? 502 : 400).send({ ok: false, message: err.message });
  }
});

// Grid-search a strategy's parameters.
app.post('/api/backtest/optimize', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
  const { symbol, strategy, interval = '1h', limit = 500, sortBy = 'totalReturnPct' } = req.body || {};
  try {
    const { interval: iv, candles } = await fetchCandles(symbol, interval, limit);
    const result = optimize(candles, { strategy, sortBy, exec: execOpts(req.body) });
    return { ok: true, symbol: String(symbol).toUpperCase(), interval: iv, ...result };
  } catch (err) {
    return reply.code(err.message?.startsWith('Binance') ? 502 : 400).send({ ok: false, message: err.message });
  }
});

// ── Automated bots ───────────────────────────────────

app.post('/api/bots/parse', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
  const { text, modelId } = req.body || {};
  if (!text || typeof text !== 'string') return reply.code(400).send({ ok: false, message: 'Missing text' });

  const systemPrompt = {
    role: 'system',
    content: `You are an AI assistant for a trading bot platform. Your job is to parse the user's Python code, JSON setup, or natural language strategy into a structured bot configuration JSON.
The platform supports the following bot options:
- botType: "signal" or "dca"
- triggerMode: "once" (edge) or "always" (level)
- conditionType: "price_below", "price_above", "change_below", "change_above", "pct_from_start_below", "pct_from_start_above", "rsi_below", "rsi_above", "sma_cross_up", "sma_cross_down", "ema_cross_up", "ema_cross_down"
- side: "buy" or "sell"
- sizingMode: "fixed" or "pctCash"

Return ONLY a valid JSON object matching this schema (do not include markdown block formatting like \`\`\`json, just the raw JSON object string):
{
  "name": "Generated Bot Name",
  "symbol": "e.g., BTCUSDT",
  "botType": "signal",
  "triggerMode": "once",
  "conditionType": "price_below",
  "conditionValue": number (or null),
  "rsiPeriod": 14,
  "fast": 9,
  "slow": 21,
  "side": "buy",
  "sizingMode": "fixed",
  "quoteAmount": 500,
  "takeProfit": 0,
  "stopLoss": 0,
  "trailingStop": 0,
  "cooldownMin": 30,
  "maxAllocation": 0
}
Infer missing fields based on standard defaults. If the pair is missing, default to "BTCUSDT".`
  };

  try {
    const responseText = await callChatModel([systemPrompt, { role: 'user', content: text }], { model: modelId });
    
    // Clean markdown if present
    let cleaned = responseText.trim();
    if (cleaned.startsWith('\`\`\`json')) cleaned = cleaned.substring(7);
    else if (cleaned.startsWith('\`\`\`')) cleaned = cleaned.substring(3);
    if (cleaned.endsWith('\`\`\`')) cleaned = cleaned.slice(0, -3);
    
    const parsed = JSON.parse(cleaned.trim());
    return { ok: true, setup: parsed };
  } catch (err) {
    app.log.error(err);
    return reply.code(500).send({ ok: false, message: 'Nepavyko iškoduoti logikos: ' + err.message });
  }
});

// Bots + live prices for their symbols (frontend shows distance-to-trigger).
app.get('/api/bots', async () => {
  const bots = await Bots.listBots();
  const symbols = [...new Set(bots.map((b) => b.symbol))];
  let prices = {};
  if (symbols.length) { try { prices = await fetchPrices(symbols); } catch { /* offline */ } }
  return { bots, prices };
});

app.post('/api/bots', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
  try {
    // Anchor the reference price now (for % -from-start conditions).
    const body = { ...(req.body || {}) };
    if (body.symbol && body.refPrice == null) {
      try { const p = await fetchPrices([body.symbol]); body.refPrice = p[String(body.symbol).toUpperCase()]?.price ?? null; } catch { /* ok */ }
    }
    const bot = await Bots.createBot(body);
    return { ok: true, bot };
  } catch (err) {
    return reply.code(400).send({ ok: false, message: err.message });
  }
});

// Bulk enable/disable all bots.
app.post('/api/bots/all', async (req, reply) => {
  const enabled = !!(req.body && req.body.enabled);
  const bots = await Bots.setAllEnabled(enabled);
  return { ok: true, bots };
});

app.put('/api/bots/:id', async (req, reply) => {
  const bot = await Bots.updateBot(req.params.id, req.body || {});
  if (!bot) return reply.code(404).send({ ok: false, message: 'Botas nerastas' });
  return { ok: true, bot };
});

app.delete('/api/bots/:id', async (req, reply) => {
  const ok = await Bots.deleteBot(req.params.id);
  if (!ok) return reply.code(404).send({ ok: false, message: 'Botas nerastas' });
  return { ok: true };
});

// ── Workspace file I/O ───────────────────────────────

app.get('/api/workspace/files', async (req, reply) => {
  const root = (req.query.root || '').trim();
  if (!root) return reply.code(400).send({ error: 'root required' });
  try {
    await assertWorkspace(root);
    const files = await listFiles(root);
    return { root, files };
  } catch (err) {
    const status = err instanceof WorkspaceError
      ? (err.code === 'NOT_FOUND' ? 404 : err.code === 'BLOCKED_ROOT' ? 403 : 400)
      : 400;
    return reply.code(status).send({ error: err.message, code: err.code });
  }
});

app.get('/api/workspace/file', async (req, reply) => {
  const root = (req.query.root || '').trim();
  const path = (req.query.path || '').trim();
  if (!root || !path) return reply.code(400).send({ error: 'root and path required' });
  try {
    const contents = await readFiles(root, [path]);
    if (!contents[path] && contents[path] !== '') {
      return reply.code(404).send({ error: 'File not found or not readable' });
    }
    return { path, content: contents[path] };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

app.post('/api/workspace/file', async (req, reply) => {
  const { root, path, content } = req.body || {};
  if (!root || !path || typeof content !== 'string') {
    return reply.code(400).send({ error: 'root, path, content required' });
  }
  try {
    const summary = await wsWriteFiles(root, [{ path, content }]);
    return { ok: true, summary };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

// ── Standalone memory-aware Chatbot (no FSM/orchestrator) ──────────────
// Injects the Memory Fabric (identity + global + recent workspace records) as
// system context, then runs a plain chat completion on the default model.
function _formatMemoryContext({ identity, global, workspace }) {
  const fmt = (recs) => recs.map((r) => {
    const v = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
    const when = r.ts ? new Date(r.ts).toISOString().slice(0, 10) : '';
    return `- [${r.key || 'įrašas'}${when ? ` · ${when}` : ''}] ${v.slice(0, 400)}`;
  }).join('\n');

  const parts = [];
  if (identity.length)  parts.push(`## Identity (kas yra vartotojas)\n${fmt(identity)}`);
  if (global.length)    parts.push(`## Global (bendros žinios)\n${fmt(global)}`);
  if (workspace.length) parts.push(`## Workspace (paskutinės užduotys/rezultatai)\n${fmt(workspace)}`);
  const block = parts.join('\n\n');
  return block ? block.slice(0, 9000) : '(Atmintis kol kas tuščia.)';
}

app.post('/api/chat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
  const { messages, modelId } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return reply.code(400).send({ ok: false, message: 'messages array is required' });
  }
  // Sanitize: keep only valid turns, cap length, keep the last 20.
  const clean = messages
    .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) }))
    .slice(-20);
  if (!clean.length) return reply.code(400).send({ ok: false, message: 'no valid messages' });

  const [identity, global, workspace] = await Promise.all([
    Memory.query({ layer: 'identity', limit: 100 }),
    Memory.query({ layer: 'global', limit: 100 }),
    Memory.query({ layer: 'workspace', limit: 50 }),
  ]);

  const system = {
    role: 'system',
    content:
      "You are a helpful AI assistant integrated into the AntiGravyti Agent OS. " +
      "Here is the context of the user and previous tasks from the system's long-term memory:\n\n" +
      _formatMemoryContext({ identity, global, workspace }) +
      "\n\nUse this memory to answer the user's questions or continue the conversation. " +
      "Reply in the user's language.",
  };

  try {
    const model = typeof modelId === 'string' && modelId.trim() ? modelId.trim() : undefined;
    const text = await callChatModel([system, ...clean], { model });
    return { ok: true, reply: text, memoryUsed: identity.length + global.length + workspace.length };
  } catch (err) {
    app.log.error({ code: err.code }, 'chat failed');
    return reply.code(err instanceof ModelError && err.code === 'NO_API_KEY' ? 400 : 502)
      .send({ ok: false, code: err.code || 'ERROR', message: err.message });
  }
});

// Token + credit accounting (total, per domain engine, per model, per agent).
app.get('/api/usage', async () => Usage.getSummary());
app.post('/api/usage/reset', async () => ({ ok: true, usage: await Usage.reset() }));

app.get('/api/memory', async (req) => {
  const { layer, workspaceId, limit } = req.query || {};
  return { items: await Memory.query({ layer, workspaceId, limit: limit ? Number(limit) : 50 }) };
});

app.get('/api/memory/summary', async () => {
  const byLayer = await Memory.summary();
  const total = Object.values(byLayer).reduce((s, n) => s + n, 0);
  return { total, byLayer };
});

app.get('/api/memory/workspace-summary', async () => {
  return Memory.workspaceSummary();
});

// ── Live event stream (SSE) ──────────────────────────
const STREAMED = ['task:created', 'task:stateChange', 'task:subStateChange', 'task:log', 'task:error', 'task:done', 'bot:triggered', 'portfolio:update'];

app.get('/api/events', (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: ready\ndata: {}\n\n');

  const unsubscribe = STREAMED.map((name) =>
    EventBus.on(name, (data) => {
      try { res.write(`event: ${name}\ndata: ${JSON.stringify({ event: name, ...data })}\n\n`); }
      catch { /* client gone; cleaned up on close */ }
    }),
  );
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 25000);

  req.raw.on('close', () => {
    clearInterval(ping);
    unsubscribe.forEach((off) => off());
  });
});

// ── Static client (registered last so /api/* wins) ──
await app.register(fastifyStatic, { root: PUBLIC_ROOT, index: ['index.html'] });

// ── Boot ──
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Agent OS running at http://${HOST}:${PORT}`);
  startScheduler(); // background loop: paper limit-order fills + bot evaluation
  app.log.info('Trading scheduler started');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
