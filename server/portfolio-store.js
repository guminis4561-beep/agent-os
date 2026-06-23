// ═══════════════════════════════════════════════════
// SERVER: Paper-trading portfolio (file-backed)
// ═══════════════════════════════════════════════════
//
// A virtual ("paper") trading account: a USDT cash balance, open positions and
// a trade history. Orders fill against live prices passed in by the caller (the
// market endpoint already proxies Binance) — this store never hits the network.
// Market orders fill immediately; limit orders are stored as pending and filled
// later by the scheduler when the price crosses the limit.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';

const FILE = join(DATA_DIR, 'portfolio.json');
const STARTING_BALANCE = 10000;

let cache = null;
let writeChain = Promise.resolve();

function blank() {
  return {
    cash: STARTING_BALANCE,
    startingBalance: STARTING_BALANCE,
    positions: {},      // SYMBOL -> { qty, avgPrice }
    pendingOrders: [],  // { id, symbol, side, type:'limit', qty, limitPrice, createdAt }
    trades: [],         // filled order history
    realizedPnl: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    cache = (parsed && typeof parsed === 'object' && typeof parsed.cash === 'number') ? parsed : blank();
  } catch {
    cache = blank();
  }
  return cache;
}

function flush() {
  const snapshot = JSON.stringify(cache, null, 2);
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(FILE, snapshot, 'utf8');
  }).catch((e) => console.error('[Portfolio] flush failed:', e.message));
  return writeChain;
}

const uid = () => 'ord_' + Math.random().toString(36).slice(2, 10);

/**
 * Execute a buy/sell. For market orders `price` (current market price) is
 * required and the fill is immediate. For limit orders the order is queued.
 * @returns { ok, order?, error? }
 */
export async function placeOrder({ symbol, side, type = 'market', qty, quoteAmount, limitPrice }, price) {
  const c = await load();
  symbol = String(symbol || '').toUpperCase().trim();
  side = String(side || '').toLowerCase();
  if (!symbol) return { ok: false, error: 'symbol privalomas' };
  if (!['buy', 'sell'].includes(side)) return { ok: false, error: 'side turi būti buy/sell' };

  if (type === 'limit') {
    const lp = Number(limitPrice);
    if (!(lp > 0)) return { ok: false, error: 'limitPrice privalomas limit orderiui' };
    let q = Number(qty);
    if (!(q > 0) && Number(quoteAmount) > 0) q = Number(quoteAmount) / lp;
    if (!(q > 0)) return { ok: false, error: 'qty arba quoteAmount privalomas' };
    const order = { id: uid(), symbol, side, type: 'limit', qty: q, limitPrice: lp, createdAt: Date.now() };
    c.pendingOrders.push(order);
    c.updatedAt = Date.now();
    flush();
    return { ok: true, order, pending: true };
  }

  // Market order — needs a live price.
  const px = Number(price);
  if (!(px > 0)) return { ok: false, error: 'Nepavyko gauti rinkos kainos' };
  return fill(c, { symbol, side, qty: Number(qty), quoteAmount: Number(quoteAmount), price: px, type: 'market' });
}

// Apply a fill at `price` to the in-memory portfolio. Mutates + flushes.
function fill(c, { symbol, side, qty, quoteAmount, price, type, orderId }) {
  let q = qty;
  if (!(q > 0) && quoteAmount > 0) q = quoteAmount / price;
  if (!(q > 0)) return { ok: false, error: 'qty arba quoteAmount privalomas' };

  const pos = c.positions[symbol] || { qty: 0, avgPrice: 0 };

  if (side === 'buy') {
    const cost = q * price;
    if (cost > c.cash + 1e-9) return { ok: false, error: `Nepakanka lėšų: reikia $${cost.toFixed(2)}, turima $${c.cash.toFixed(2)}` };
    const newQty = pos.qty + q;
    pos.avgPrice = newQty > 0 ? (pos.qty * pos.avgPrice + cost) / newQty : price;
    pos.qty = newQty;
    c.cash -= cost;
  } else { // sell
    if (q > pos.qty + 1e-9) return { ok: false, error: `Nepakanka pozicijos: turima ${pos.qty}, parduodama ${q}` };
    const proceeds = q * price;
    const realized = (price - pos.avgPrice) * q;
    c.realizedPnl += realized;
    pos.qty -= q;
    c.cash += proceeds;
    if (pos.qty <= 1e-9) { delete c.positions[symbol]; }
  }
  if (pos.qty > 1e-9) c.positions[symbol] = pos;

  const trade = {
    id: orderId || uid(), symbol, side, qty: +q.toFixed(8), price: +price.toFixed(8),
    value: +(q * price).toFixed(2), type, ts: Date.now(),
  };
  c.trades.push(trade);
  if (c.trades.length > 500) c.trades = c.trades.slice(-500);
  c.updatedAt = Date.now();
  flush();
  return { ok: true, trade };
}

/**
 * Try to fill pending limit orders against a price map { SYMBOL: price }.
 * Buy fills when price <= limit; sell fills when price >= limit.
 * @returns array of filled trades (for SSE notification).
 */
export async function fillPending(priceMap) {
  const c = await load();
  if (!c.pendingOrders.length) return [];
  const filled = [];
  const remaining = [];
  for (const o of c.pendingOrders) {
    const px = Number(priceMap[o.symbol]);
    const crosses = px > 0 && (o.side === 'buy' ? px <= o.limitPrice : px >= o.limitPrice);
    if (crosses) {
      const r = fill(c, { symbol: o.symbol, side: o.side, qty: o.qty, price: px, type: 'limit', orderId: o.id });
      if (r.ok) filled.push(r.trade);
      else remaining.push(o); // e.g. insufficient funds → keep pending
    } else {
      remaining.push(o);
    }
  }
  c.pendingOrders = remaining;
  if (filled.length) { c.updatedAt = Date.now(); flush(); }
  return filled;
}

export async function cancelOrder(orderId) {
  const c = await load();
  const before = c.pendingOrders.length;
  c.pendingOrders = c.pendingOrders.filter((o) => o.id !== orderId);
  if (c.pendingOrders.length !== before) { flush(); return { ok: true }; }
  return { ok: false, error: 'Orderis nerastas' };
}

/**
 * Portfolio snapshot. If a price map is supplied, computes mark-to-market value
 * and unrealized PnL per position.
 */
export async function getPortfolio(priceMap = {}) {
  const c = await load();
  let positionsValue = 0;
  const positions = Object.entries(c.positions).map(([symbol, p]) => {
    const px = Number(priceMap[symbol]) || p.avgPrice;
    const value = p.qty * px;
    positionsValue += value;
    const unrealizedPnl = (px - p.avgPrice) * p.qty;
    return {
      symbol, qty: p.qty, avgPrice: p.avgPrice, price: px,
      value: +value.toFixed(2),
      unrealizedPnl: +unrealizedPnl.toFixed(2),
      unrealizedPct: p.avgPrice > 0 ? +(((px - p.avgPrice) / p.avgPrice) * 100).toFixed(2) : 0,
    };
  });
  const equity = c.cash + positionsValue;
  return {
    cash: +c.cash.toFixed(2),
    startingBalance: c.startingBalance,
    positionsValue: +positionsValue.toFixed(2),
    equity: +equity.toFixed(2),
    realizedPnl: +c.realizedPnl.toFixed(2),
    unrealizedPnl: +positions.reduce((s, p) => s + p.unrealizedPnl, 0).toFixed(2),
    totalPnl: +(equity - c.startingBalance).toFixed(2),
    totalPnlPct: +(((equity - c.startingBalance) / c.startingBalance) * 100).toFixed(2),
    positions,
    pendingOrders: c.pendingOrders,
    trades: c.trades.slice(-50).reverse(),
    updatedAt: c.updatedAt,
  };
}

export async function reset() {
  cache = blank();
  flush();
  return cache;
}
