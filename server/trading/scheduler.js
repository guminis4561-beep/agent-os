// ═══════════════════════════════════════════════════
// SERVER: Trading scheduler (background loop)
// ═══════════════════════════════════════════════════
//
// Wakes every INTERVAL ms to: (1) fill pending paper limit orders, and (2)
// evaluate automated bots — both against fresh Binance prices. Anything that
// fires is broadcast to the client over SSE (bot:triggered / portfolio:update).
// All trades are PAPER trades; nothing real is ever executed.

import EventBus from '../../core/events.js';
import { fillPending, getPortfolio } from '../portfolio-store.js';
import { evaluateBots, listBots, conditionNeedsKlines } from '../bots-store.js';

const INTERVAL = Number(process.env.TRADING_TICK_MS) || 60000;
let timer = null;
let running = false;

/** Fetch { SYMBOL: { price, change } } from Binance for the given symbols. */
export async function fetchPrices(symbols) {
  if (!symbols.length) return {};
  const param = JSON.stringify(symbols.map((s) => s.toUpperCase()));
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(param)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = await res.json();
  const map = {};
  for (const t of data) {
    map[t.symbol] = { price: parseFloat(t.lastPrice), change: parseFloat(t.priceChangePercent) };
  }
  return map;
}

/** Fetch recent candles for a symbol (for indicator-based bot conditions). */
export async function fetchKlines(symbol, interval = '1h', limit = 120) {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const raw = await res.json();
  return raw.map((d) => ({ time: Math.floor(d[0] / 1000), open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] }));
}

/** Fear & Greed index value (0..100) from alternative.me, or null on failure. */
export async function fetchSentiment() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = await res.json();
    const v = Number(json?.data?.[0]?.value);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const bots = await listBots();
    const pf = await getPortfolio();
    const symbols = new Set([
      ...bots.filter((b) => b.enabled).map((b) => b.symbol),
      ...pf.positions.map((p) => p.symbol),
      ...pf.pendingOrders.map((o) => o.symbol),
    ]);
    if (!symbols.size) return;

    const priceMap = await fetchPrices([...symbols]);

    // 1) Fill any crossed limit orders.
    const simple = Object.fromEntries(Object.entries(priceMap).map(([k, v]) => [k, v.price]));
    const filled = await fillPending(simple);
    for (const t of filled) {
      EventBus.emit('bot:triggered', { kind: 'limit_fill', trade: t, message: `Limit ${t.side} ${t.symbol} @ $${t.price} įvykdytas` });
    }

    // 2) Evaluate bots (fetch sentiment + indicator candles only when needed).
    const needsSentiment = bots.some((b) => b.enabled && (b.sentimentMin != null || b.sentimentMax != null));
    const sentiment = needsSentiment ? await fetchSentiment() : null;

    // Fetch candles for symbols that have an enabled indicator-based bot.
    const klineSymbols = [...new Set(
      bots.filter((b) => b.enabled && b.botType !== 'dca' && conditionNeedsKlines(b.conditionType)).map((b) => b.symbol),
    )];
    const klinesMap = {};
    await Promise.all(klineSymbols.map(async (s) => {
      try { klinesMap[s] = await fetchKlines(s); } catch { /* skip this symbol this tick */ }
    }));

    const fired = await evaluateBots(priceMap, sentiment, klinesMap);
    for (const f of fired) {
      const verb = f.kind === 'TP' || f.kind === 'SL' || f.kind === 'TRAIL' ? `${f.kind} išėjimas` : f.trade.side.toUpperCase();
      EventBus.emit('bot:triggered', {
        kind: 'bot', botId: f.bot.id, botName: f.bot.name, trade: f.trade,
        message: `🤖 ${f.bot.name}: ${verb} ${f.trade.symbol} @ $${f.trade.price}`,
      });
    }

    if (filled.length || fired.length) EventBus.emit('portfolio:update', { ts: Date.now() });
  } catch (err) {
    // Network hiccups are expected; log quietly and try again next tick.
    if (process.env.LOG_LEVEL === 'debug') console.error('[Scheduler] tick failed:', err.message);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => { tick(); }, INTERVAL);
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
