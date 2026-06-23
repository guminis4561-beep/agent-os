// ═══════════════════════════════════════════════════
// SERVER: Automated trading bots (file-backed rules)
// ═══════════════════════════════════════════════════
//
// A bot is a condition→action rule the scheduler evaluates each tick against live
// prices, the Fear & Greed index and (for indicator rules) recent candles. When a
// rule fires it places a PAPER order via the portfolio store — never a real trade.
//
// Capabilities:
//   • signal bots (price / 24h change / % from start / RSI / SMA-EMA crossover)
//   • edge-trigger ("once" — fire on crossing, re-arm when condition clears)
//   • DCA bots (buy a fixed amount every N minutes regardless of price)
//   • brackets: take-profit / stop-loss / trailing-stop auto-exit the position the
//     bot opened
//   • safety: max budget per bot, max triggers, expiry, % -of-cash sizing

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';
import { placeOrder, getPortfolio } from './portfolio-store.js';
import { sma, ema, rsi } from './trading/indicators.js';

const FILE = join(DATA_DIR, 'bots.json');

let cache = null;
let writeChain = Promise.resolve();

const PRICE_CONDS = new Set(['price_above', 'price_below', 'change_above', 'change_below', 'pct_from_start_above', 'pct_from_start_below']);
const KLINE_CONDS = new Set(['rsi_below', 'rsi_above', 'sma_cross_up', 'sma_cross_down', 'ema_cross_up', 'ema_cross_down']);
const ALL_CONDS = new Set([...PRICE_CONDS, ...KLINE_CONDS]);
const SIDES = new Set(['buy', 'sell']);

// Which condition types require recent candles (the scheduler fetches them).
export function conditionNeedsKlines(type) { return KLINE_CONDS.has(type); }

function blank() { return { bots: [] }; }

async function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    cache = (parsed && Array.isArray(parsed.bots)) ? parsed : blank();
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
  }).catch((e) => console.error('[Bots] flush failed:', e.message));
  return writeChain;
}

const uid = () => 'bot_' + Math.random().toString(36).slice(2, 10);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export async function listBots() {
  const c = await load();
  return c.bots;
}

function normalize(input, base = {}) {
  const botType = input.botType === 'dca' ? 'dca' : 'signal';
  const out = {
    ...base,
    botType,
    side: input.side != null ? String(input.side).toLowerCase() : base.side,
    // condition (signal type)
    conditionType: input.conditionType != null ? String(input.conditionType) : base.conditionType,
    conditionValue: input.conditionValue != null ? num(input.conditionValue, base.conditionValue) : base.conditionValue,
    fast: num(input.fast, base.fast ?? 9),
    slow: num(input.slow, base.slow ?? 21),
    rsiPeriod: num(input.rsiPeriod, base.rsiPeriod ?? 14),
    triggerMode: (input.triggerMode === 'always' || input.triggerMode === 'once') ? input.triggerMode : (base.triggerMode ?? 'once'),
    // sizing
    sizingMode: (input.sizingMode === 'pctCash') ? 'pctCash' : (base.sizingMode ?? 'fixed'),
    quoteAmount: num(input.quoteAmount, base.quoteAmount ?? 500),
    sellPct: num(input.sellPct, base.sellPct ?? 100),
    // brackets (buy bots)
    takeProfit: Math.max(0, num(input.takeProfit, base.takeProfit ?? 0)),
    stopLoss: Math.max(0, num(input.stopLoss, base.stopLoss ?? 0)),
    trailingStop: Math.max(0, num(input.trailingStop, base.trailingStop ?? 0)),
    maxAllocation: Math.max(0, num(input.maxAllocation, base.maxAllocation ?? 0)),
    // sentiment gate
    sentimentMin: input.sentimentMin != null && input.sentimentMin !== '' ? num(input.sentimentMin, null) : (base.sentimentMin ?? null),
    sentimentMax: input.sentimentMax != null && input.sentimentMax !== '' ? num(input.sentimentMax, null) : (base.sentimentMax ?? null),
    // lifecycle
    cooldownMin: Math.max(0, num(input.cooldownMin, base.cooldownMin ?? 15)),
    maxTriggers: Math.max(0, Math.floor(num(input.maxTriggers, base.maxTriggers ?? 0))),
    expiresAt: input.expiresAt != null && input.expiresAt !== '' ? num(input.expiresAt, base.expiresAt ?? null) : (base.expiresAt ?? null),
  };
  return out;
}

export async function createBot(input = {}) {
  const c = await load();
  const symbol = String(input.symbol || '').toUpperCase().trim();
  if (!symbol) throw new Error('symbol privalomas');
  const fields = normalize(input);
  if (fields.botType === 'signal') {
    if (!ALL_CONDS.has(fields.conditionType)) throw new Error(`conditionType turi būti vienas iš: ${[...ALL_CONDS].join(', ')}`);
    if (PRICE_CONDS.has(fields.conditionType) && !Number.isFinite(fields.conditionValue)) throw new Error('conditionValue privalo būti skaičius');
  }
  if (!SIDES.has(fields.side)) throw new Error('side turi būti buy/sell');

  const bot = {
    id: uid(),
    name: String(input.name || `${symbol} ${fields.botType === 'dca' ? 'DCA' : fields.conditionType}`).slice(0, 60),
    symbol,
    ...fields,
    enabled: input.enabled !== false,
    armed: true,            // edge-trigger state
    lastTriggered: null,
    triggerCount: 0,
    refPrice: num(input.refPrice, null),   // set by scheduler on first tick if null
    deployed: 0,            // cumulative $ spent on buys (for maxAllocation)
    managedPos: null,       // { qty, entryPrice, peakPrice } for bracket exits
    createdAt: Date.now(),
    log: [],
  };
  c.bots.push(bot);
  flush();
  return bot;
}

export async function updateBot(id, patch = {}) {
  const c = await load();
  const bot = c.bots.find((b) => b.id === id);
  if (!bot) return null;
  if (patch.enabled != null) bot.enabled = !!patch.enabled;
  if (patch.name != null) bot.name = String(patch.name).slice(0, 60);
  // Allow editing the full rule (re-normalize over current values).
  if (patch.edit) {
    Object.assign(bot, normalize(patch, bot));
    bot.armed = true; // reset edge state after an edit
  } else {
    // quick inline tweaks
    if (patch.conditionValue != null && Number.isFinite(Number(patch.conditionValue))) bot.conditionValue = Number(patch.conditionValue);
    if (patch.quoteAmount != null && Number(patch.quoteAmount) > 0) bot.quoteAmount = Number(patch.quoteAmount);
    if (patch.cooldownMin != null && Number(patch.cooldownMin) >= 0) bot.cooldownMin = Number(patch.cooldownMin);
  }
  flush();
  return bot;
}

export async function setAllEnabled(enabled) {
  const c = await load();
  c.bots.forEach((b) => { b.enabled = !!enabled; });
  flush();
  return c.bots;
}

export async function deleteBot(id) {
  const c = await load();
  const before = c.bots.length;
  c.bots = c.bots.filter((b) => b.id !== id);
  if (c.bots.length === before) return false;
  flush();
  return true;
}

function botLog(bot, message) {
  bot.log.unshift({ ts: Date.now(), message });
  if (bot.log.length > 25) bot.log = bot.log.slice(0, 25);
}

// Last two non-null values of an indicator series.
function lastTwo(arr) {
  let a = null, b = null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) { if (b == null) b = arr[i]; else { a = arr[i]; break; } }
  }
  return [a, b]; // [prev, current]
}

function conditionMet(bot, price, candles) {
  const px = price.price;
  switch (bot.conditionType) {
    case 'price_above':  return px > bot.conditionValue;
    case 'price_below':  return px < bot.conditionValue;
    case 'change_above': return price.change > bot.conditionValue;
    case 'change_below': return price.change < bot.conditionValue;
    case 'pct_from_start_above': return bot.refPrice > 0 && ((px - bot.refPrice) / bot.refPrice * 100) > bot.conditionValue;
    case 'pct_from_start_below': return bot.refPrice > 0 && ((px - bot.refPrice) / bot.refPrice * 100) < bot.conditionValue;
    default: break;
  }
  // Indicator conditions need candles.
  if (!candles || candles.length < 30) return false;
  const closes = candles.map((c) => c.close);
  if (bot.conditionType === 'rsi_below' || bot.conditionType === 'rsi_above') {
    const r = rsi(closes, bot.rsiPeriod || 14);
    const v = r[r.length - 1];
    if (v == null) return false;
    return bot.conditionType === 'rsi_below' ? v < bot.conditionValue : v > bot.conditionValue;
  }
  if (bot.conditionType.startsWith('sma_cross') || bot.conditionType.startsWith('ema_cross')) {
    const fn = bot.conditionType.startsWith('sma') ? sma : ema;
    const [pf, cf] = lastTwo(fn(closes, bot.fast || 9));
    const [ps, cs] = lastTwo(fn(closes, bot.slow || 21));
    if (pf == null || cf == null || ps == null || cs == null) return false;
    const up = pf <= ps && cf > cs;     // fast crossed above slow
    const down = pf >= ps && cf < cs;   // fast crossed below slow
    return bot.conditionType.endsWith('up') ? up : down;
  }
  return false;
}

// How close a bot is to firing — a 0..1 progress + human label (for the UI).
export function triggerProgress(bot, price) {
  if (!price) return null;
  const px = price.price;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  switch (bot.conditionType) {
    case 'price_below':  return { progress: clamp(bot.conditionValue / px), now: `$${px}`, target: `$${bot.conditionValue}` };
    case 'price_above':  return { progress: clamp(px / bot.conditionValue), now: `$${px}`, target: `$${bot.conditionValue}` };
    case 'change_below': return { progress: clamp(price.change <= bot.conditionValue ? 1 : 1 - (price.change - bot.conditionValue) / Math.max(Math.abs(bot.conditionValue), 1)), now: `${price.change.toFixed(2)}%`, target: `${bot.conditionValue}%` };
    case 'change_above': return { progress: clamp(price.change >= bot.conditionValue ? 1 : price.change / Math.max(bot.conditionValue, 0.1)), now: `${price.change.toFixed(2)}%`, target: `${bot.conditionValue}%` };
    default: return { progress: 0, now: `${px}`, target: '—' };
  }
}

async function sizing(bot, pf) {
  if (bot.sizingMode === 'pctCash') return Math.max(0, pf.cash * (bot.quoteAmount / 100));
  return bot.quoteAmount;
}

/**
 * Evaluate all enabled bots. `klinesMap[symbol]` (optional) holds recent candles
 * for indicator conditions; the scheduler provides it for symbols that need it.
 * @returns array of { bot, trade, kind } that fired (for SSE notification)
 */
export async function evaluateBots(priceMap, sentiment = null, klinesMap = {}) {
  const c = await load();
  const fired = [];
  const now = Date.now();
  const simplePrices = Object.fromEntries(Object.entries(priceMap).map(([k, v]) => [k, v.price]));
  let pf = await getPortfolio(simplePrices);
  const refreshPf = async () => { pf = await getPortfolio(simplePrices); };

  for (const bot of c.bots) {
    if (!bot.enabled) continue;
    const price = priceMap[bot.symbol];
    if (!price || !(price.price > 0)) continue;
    const px = price.price;
    if (bot.refPrice == null) bot.refPrice = px; // anchor for pct_from_start

    // Expiry / max-triggers auto-disable.
    if (bot.expiresAt && now > bot.expiresAt) { bot.enabled = false; botLog(bot, '⏰ Galiojimas baigėsi — išjungta'); continue; }
    if (bot.maxTriggers > 0 && bot.triggerCount >= bot.maxTriggers) { bot.enabled = false; botLog(bot, '🔁 Pasiektas max suveikimų — išjungta'); continue; }

    // 1) Bracket exits on a position this bot opened.
    if (bot.managedPos && bot.managedPos.qty > 0) {
      const mp = bot.managedPos;
      mp.peakPrice = Math.max(mp.peakPrice || mp.entryPrice, px);
      let reason = null, exitPx = px;
      if (bot.takeProfit > 0 && px >= mp.entryPrice * (1 + bot.takeProfit / 100)) reason = 'TP';
      else if (bot.stopLoss > 0 && px <= mp.entryPrice * (1 - bot.stopLoss / 100)) reason = 'SL';
      else if (bot.trailingStop > 0 && px <= mp.peakPrice * (1 - bot.trailingStop / 100)) reason = 'TRAIL';
      if (reason) {
        const held = pf.positions.find((p) => p.symbol === bot.symbol);
        const qty = held ? Math.min(held.qty, mp.qty) : 0;
        if (qty > 0) {
          const r = await placeOrder({ symbol: bot.symbol, side: 'sell', type: 'market', qty }, px);
          if (r.ok) {
            const icon = reason === 'TP' ? '🎯' : reason === 'SL' ? '🛑' : '📉';
            botLog(bot, `${icon} ${reason} išėjimas: SELL ${bot.symbol} @ $${px}`);
            bot.managedPos = null;
            fired.push({ bot: { id: bot.id, name: bot.name, symbol: bot.symbol }, trade: r.trade, kind: reason });
            await refreshPf();
          }
        } else { bot.managedPos = null; }
        continue; // don't also enter on the same tick
      }
    }

    // Cooldown gate for new entries.
    if (bot.lastTriggered && now - bot.lastTriggered < bot.cooldownMin * 60000) continue;

    // 2) DCA — periodic buy regardless of price.
    if (bot.botType === 'dca') {
      if (bot.maxAllocation > 0 && bot.deployed >= bot.maxAllocation) { bot.enabled = false; botLog(bot, '💰 Pasiektas max biudžetas — išjungta'); continue; }
      const amt = Math.min(await sizing(bot, pf), bot.maxAllocation > 0 ? bot.maxAllocation - bot.deployed : Infinity);
      if (amt <= 0) continue;
      const r = await placeOrder({ symbol: bot.symbol, side: 'buy', type: 'market', quoteAmount: amt }, px);
      if (r.ok) {
        bot.lastTriggered = now; bot.triggerCount++; bot.deployed += r.trade.value;
        botLog(bot, `🔁 DCA pirkimas: $${amt.toFixed(0)} ${bot.symbol} @ $${px}`);
        fired.push({ bot: { id: bot.id, name: bot.name, symbol: bot.symbol }, trade: r.trade, kind: 'dca' });
        await refreshPf();
      } else { botLog(bot, `Klaida: ${r.error}`); }
      continue;
    }

    // 3) Signal bots — evaluate condition with edge/level trigger.
    const candles = klinesMap[bot.symbol];
    const met = conditionMet(bot, price, candles);
    if (bot.triggerMode === 'once') {
      if (!met) { bot.armed = true; continue; }   // re-arm when condition clears
      if (!bot.armed) continue;                    // already fired this crossing
    } else if (!met) continue;

    // Sentiment gate.
    if (sentiment != null) {
      if (bot.sentimentMin != null && sentiment < bot.sentimentMin) continue;
      if (bot.sentimentMax != null && sentiment > bot.sentimentMax) continue;
    }

    let result;
    if (bot.side === 'buy') {
      if (bot.maxAllocation > 0 && bot.deployed >= bot.maxAllocation) { botLog(bot, '💰 Praleista: pasiektas max biudžetas'); bot.armed = false; continue; }
      let amt = await sizing(bot, pf);
      if (bot.maxAllocation > 0) amt = Math.min(amt, bot.maxAllocation - bot.deployed);
      if (amt <= 0) continue;
      result = await placeOrder({ symbol: bot.symbol, side: 'buy', type: 'market', quoteAmount: amt }, px);
      if (result.ok) {
        bot.deployed += result.trade.value;
        // If any bracket is set, track the opened position for auto-exit.
        if (bot.takeProfit > 0 || bot.stopLoss > 0 || bot.trailingStop > 0) {
          bot.managedPos = { qty: result.trade.qty, entryPrice: px, peakPrice: px };
        }
      }
    } else { // sell
      const held = pf.positions.find((p) => p.symbol === bot.symbol);
      const qty = held ? held.qty * Math.min(Math.max(bot.sellPct, 1), 100) / 100 : 0;
      if (qty <= 0) { botLog(bot, `Praleista: nėra ${bot.symbol} pozicijos`); bot.armed = false; continue; }
      result = await placeOrder({ symbol: bot.symbol, side: 'sell', type: 'market', qty }, px);
    }

    if (result && result.ok) {
      bot.lastTriggered = now; bot.triggerCount++; bot.armed = false;
      botLog(bot, `${bot.side.toUpperCase()} ${bot.symbol} @ $${px}`);
      fired.push({ bot: { id: bot.id, name: bot.name, symbol: bot.symbol }, trade: result.trade, kind: 'signal' });
      await refreshPf();
    } else if (result) {
      botLog(bot, `Klaida: ${result.error}`);
    }
  }

  if (fired.length || c.bots.some((b) => b.log.length)) flush();
  return fired;
}
