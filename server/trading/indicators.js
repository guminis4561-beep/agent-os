// ═══════════════════════════════════════════════════
// SERVER: Trading indicators + backtest engine (pure math)
// ═══════════════════════════════════════════════════
//
// No I/O, no network — just deterministic functions over OHLC candle arrays.
// A "candle" is { time, open, high, low, close, volume }. Used by the klines
// endpoint (support/resistance, moving averages) and the backtest endpoint.

// ─── Moving averages ──────────────────────────────
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prev === null) {
      // seed with SMA of the first `period` values
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += values[j];
      prev = s / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

// ─── RSI (Wilder's smoothing) ─────────────────────
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ─── MACD ─────────────────────────────────────────
export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    (emaFast[i] == null || emaSlow[i] == null) ? null : emaFast[i] - emaSlow[i]);
  // signal = EMA of the (non-null) macd line, kept index-aligned
  const compact = [], idxMap = [];
  macdLine.forEach((v, i) => { if (v != null) { compact.push(v); idxMap.push(i); } });
  const sigCompact = ema(compact, signalPeriod);
  const signal = new Array(values.length).fill(null);
  sigCompact.forEach((v, k) => { if (v != null) signal[idxMap[k]] = v; });
  const hist = values.map((_, i) =>
    (macdLine[i] == null || signal[i] == null) ? null : macdLine[i] - signal[i]);
  return { macd: macdLine, signal, hist };
}

// ─── Bollinger Bands ──────────────────────────────
export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

// ─── Support / Resistance ─────────────────────────
// Detect pivot highs/lows (local extrema over ±window candles), then cluster
// nearby pivots into levels. Returns the strongest levels (most touches) split
// into support (below current price) and resistance (above).
export function supportResistance(candles, { window = 3, tolerance = 0.012, maxLevels = 6 } = {}) {
  if (!Array.isArray(candles) || candles.length < window * 2 + 1) {
    return { support: [], resistance: [], pivots: [] };
  }
  const pivots = [];
  for (let i = window; i < candles.length - window; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ price: candles[i].high, type: 'high', time: candles[i].time });
    if (isLow) pivots.push({ price: candles[i].low, type: 'low', time: candles[i].time });
  }

  // Cluster pivots whose prices are within `tolerance` of each other.
  const clusters = [];
  for (const p of pivots.sort((a, b) => a.price - b.price)) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p.price - last.avg) / last.avg <= tolerance) {
      last.prices.push(p.price);
      last.avg = last.prices.reduce((s, v) => s + v, 0) / last.prices.length;
      last.touches++;
    } else {
      clusters.push({ avg: p.price, prices: [p.price], touches: 1 });
    }
  }

  const last = candles[candles.length - 1].close;
  const levels = clusters
    .map((c) => ({ price: +c.avg.toFixed(8), strength: c.touches }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, maxLevels);

  return {
    pivots,
    support: levels.filter((l) => l.price < last).sort((a, b) => b.price - a.price),
    resistance: levels.filter((l) => l.price >= last).sort((a, b) => a.price - b.price),
  };
}

// ═══════════════════════════════════════════════════
// Backtest engine
// ═══════════════════════════════════════════════════
//
// Each strategy emits a directional BIAS per bar in {-1, 0, +1} (bearish / flat /
// bullish). The engine maps that bias to actual long/short positions according to
// the chosen `direction`, applying fees, slippage, stop-loss / take-profit and
// optional next-open fills, then computes a full risk/return metric set.

// Rolling max/min over the previous `n` values (O(n) amortized via a deque).
function rollingExtreme(arr, n, cmp) {
  const out = new Array(arr.length).fill(null);
  const dq = [];
  for (let i = 0; i < arr.length; i++) {
    while (dq.length && cmp(arr[i], arr[dq[dq.length - 1]])) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
    if (i >= n - 1) out[i] = arr[dq[0]];
  }
  return out;
}

const STRATEGIES = {
  // SMA crossover.
  sma_cross(c, p) {
    const closes = c.map((x) => x.close);
    const fast = sma(closes, p.fast || 9), slow = sma(closes, p.slow || 21);
    return closes.map((_, i) => (fast[i] == null || slow[i] == null) ? 0 : (fast[i] > slow[i] ? 1 : -1));
  },
  // EMA crossover (faster reacting).
  ema_cross(c, p) {
    const closes = c.map((x) => x.close);
    const fast = ema(closes, p.fast || 12), slow = ema(closes, p.slow || 26);
    return closes.map((_, i) => (fast[i] == null || slow[i] == null) ? 0 : (fast[i] > slow[i] ? 1 : -1));
  },
  // RSI mean-reversion.
  rsi(c, p) {
    const r = rsi(c.map((x) => x.close), p.period || 14);
    const lo = p.oversold || 30, hi = p.overbought || 70;
    let pos = 0;
    return r.map((v) => { if (v == null) return 0; if (v < lo) pos = 1; else if (v > hi) pos = -1; return pos; });
  },
  // Donchian breakout over highs/lows (not closes).
  breakout(c, p) {
    const n = p.lookback || 20;
    const hh = rollingExtreme(c.map((x) => x.high), n, (a, b) => a > b);
    const ll = rollingExtreme(c.map((x) => x.low), n, (a, b) => a < b);
    let pos = 0;
    return c.map((x, i) => {
      if (i < n || hh[i - 1] == null) return pos;
      if (x.close > hh[i - 1]) pos = 1;
      else if (x.close < ll[i - 1]) pos = -1;
      return pos;
    });
  },
  // MACD line vs signal line.
  macd(c, p) {
    const m = macd(c.map((x) => x.close), p.fast || 12, p.slow || 26, p.signal || 9);
    return c.map((_, i) => (m.macd[i] == null || m.signal[i] == null) ? 0 : (m.macd[i] > m.signal[i] ? 1 : -1));
  },
  // Bollinger Band mean-reversion: long below lower band, short above upper.
  bollinger(c, p) {
    const closes = c.map((x) => x.close);
    const b = bollinger(closes, p.period || 20, p.mult || 2);
    let pos = 0;
    return closes.map((px, i) => {
      if (b.upper[i] == null) return 0;
      if (px < b.lower[i]) pos = 1;
      else if (px > b.upper[i]) pos = -1;
      else if (b.mid[i] != null && ((pos === 1 && px >= b.mid[i]) || (pos === -1 && px <= b.mid[i]))) pos = 0; // exit at mean
      return pos;
    });
  },
};

// Parameter ranges used by the optimizer + sensible defaults for the UI.
export const STRATEGY_PARAMS = {
  sma_cross: { fast: [5, 9, 13, 20], slow: [21, 30, 50, 100] },
  ema_cross: { fast: [8, 12, 20], slow: [26, 50, 100] },
  rsi: { period: [7, 14, 21], oversold: [20, 30], overbought: [70, 80] },
  breakout: { lookback: [10, 20, 30, 55] },
  macd: { fast: [8, 12], slow: [21, 26], signal: [9] },
  bollinger: { period: [14, 20], mult: [2, 2.5] },
};

export function listStrategies() {
  return Object.keys(STRATEGIES);
}

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/**
 * Run a backtest over candles.
 * @param opts.strategy   strategy key
 * @param opts.params     strategy params
 * @param opts.direction  'long' | 'short' | 'both'   (default 'long')
 * @param opts.stopLoss   fractional stop, e.g. 0.05 (0 = off)
 * @param opts.takeProfit fractional target, e.g. 0.1 (0 = off)
 * @param opts.slippage   fractional adverse fill, e.g. 0.0005 (0 = off)
 * @param opts.positionPct fraction of equity per trade (default 1 = all-in)
 * @param opts.fillAt     'close' | 'nextOpen'   (default 'close')
 * @param opts.fee        per-side fee fraction (default 0.001)
 */
export function runBacktest(candles, opts = {}) {
  if (!Array.isArray(candles) || candles.length < 30) {
    throw new Error('Per mažai duomenų backtest\'ui (reikia ≥30 žvakių).');
  }
  const {
    strategy = 'sma_cross', params = {}, direction = 'long',
    stopLoss = 0, takeProfit = 0, slippage = 0, positionPct = 1,
    fillAt = 'close', fee = 0.001, initial = 10000,
  } = opts;
  const fn = STRATEGIES[strategy];
  if (!fn) throw new Error(`Nežinoma strategija: ${strategy}`);

  const bias = fn(candles, params);
  const closes = candles.map((c) => c.close);
  const f = Math.min(Math.max(positionPct, 0.05), 1);

  const targetFor = (b) => direction === 'long' ? (b > 0 ? 1 : 0)
    : direction === 'short' ? (b < 0 ? -1 : 0) : b;

  const entryFill = (price, side) => side > 0 ? price * (1 + slippage) : price * (1 - slippage);
  const exitFill = (price, side) => side > 0 ? price * (1 - slippage) : price * (1 + slippage);

  let cash = initial, pos = null;
  let peak = initial, maxDD = 0, prevEq = initial, barsInPos = 0, suppressed = 0;
  const trades = [], equity = [], benchmark = [], returns = [];

  const enter = (side, price, i) => {
    const notional = cash * f;
    const fp = entryFill(price, side);
    cash -= notional * fee;
    pos = { side, units: notional / fp, entryPrice: fp, entryIndex: i, notional };
    trades.push({ side: side > 0 ? 'long' : 'short', entryTime: candles[i].time, entryPrice: +fp.toFixed(6), entryIndex: i });
  };
  const unreal = (price) => pos ? pos.side * pos.units * (price - pos.entryPrice) : 0;
  const close = (price, i, reason) => {
    const fp = exitFill(price, pos.side);
    const pnl = pos.side * pos.units * (fp - pos.entryPrice) - pos.units * fp * fee;
    cash += pnl;
    const t = trades[trades.length - 1];
    t.exitTime = candles[i].time; t.exitPrice = +fp.toFixed(6); t.exitIndex = i; t.reason = reason;
    t.pnlUsd = +pnl.toFixed(2); t.pnlPct = +(pnl / pos.notional * 100).toFixed(2); t.bars = i - pos.entryIndex;
    pos = null;
  };

  for (let i = 0; i < candles.length; i++) {
    // 1) Intrabar stop-loss / take-profit on an open position.
    if (pos && (stopLoss > 0 || takeProfit > 0)) {
      const ep = pos.entryPrice;
      let hit = null, hitPx = 0;
      if (pos.side > 0) {
        const sl = ep * (1 - stopLoss), tp = ep * (1 + takeProfit);
        if (stopLoss > 0 && candles[i].low <= sl) { hit = 'SL'; hitPx = sl; }
        else if (takeProfit > 0 && candles[i].high >= tp) { hit = 'TP'; hitPx = tp; }
      } else {
        const sl = ep * (1 + stopLoss), tp = ep * (1 - takeProfit);
        if (stopLoss > 0 && candles[i].high >= sl) { hit = 'SL'; hitPx = sl; }
        else if (takeProfit > 0 && candles[i].low <= tp) { hit = 'TP'; hitPx = tp; }
      }
      if (hit) { suppressed = pos.side; close(hitPx, i, hit); }
    }

    // 2) Signal-driven position change.
    let tgt = targetFor(bias[i]);
    if (suppressed !== 0 && tgt !== suppressed) suppressed = 0;     // re-arm
    if (tgt === suppressed && tgt !== 0) tgt = pos ? pos.side : 0;  // blocked right after SL/TP
    const cur = pos ? pos.side : 0;
    if (tgt !== cur) {
      const useNext = fillAt === 'nextOpen' && i < candles.length - 1;
      const fillPrice = useNext ? candles[i + 1].open : closes[i];
      const fillIdx = useNext ? i + 1 : i;
      if (pos) close(fillPrice, fillIdx, 'signal');
      if (tgt !== 0) enter(tgt, fillPrice, fillIdx);
    }

    // 3) Mark to market at this close.
    const eq = cash + unreal(closes[i]);
    equity.push({ time: candles[i].time, value: +eq.toFixed(2) });
    benchmark.push({ time: candles[i].time, value: +(initial * closes[i] / closes[0]).toFixed(2) });
    if (pos) barsInPos++;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) maxDD = dd;
    returns.push(prevEq > 0 ? (eq - prevEq) / prevEq : 0);
    prevEq = eq;
  }

  // Force-close any open position at the final close.
  if (pos) close(closes[closes.length - 1], candles.length - 1, 'eod');

  // ─── Metrics ───
  const closed = trades.filter((t) => t.pnlPct != null);
  const wins = closed.filter((t) => t.pnlUsd > 0);
  const losses = closed.filter((t) => t.pnlUsd < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));

  // Annualisation factor from median bar spacing.
  const dts = [];
  for (let i = 1; i < candles.length; i++) dts.push(candles[i].time - candles[i - 1].time);
  dts.sort((a, b) => a - b);
  const dt = dts[Math.floor(dts.length / 2)] || 3600;
  const barsPerYear = (365.25 * 86400) / dt;
  const years = (candles[candles.length - 1].time - candles[0].time) / (365.25 * 86400) || (candles.length / barsPerYear);

  const rMean = mean(returns), rStd = std(returns);
  const downside = returns.filter((r) => r < 0);
  const dStd = std(downside);
  const sharpe = rStd > 0 ? +((rMean / rStd) * Math.sqrt(barsPerYear)).toFixed(2) : 0;
  const sortino = dStd > 0 ? +((rMean / dStd) * Math.sqrt(barsPerYear)).toFixed(2) : 0;
  const finalEq = cash;
  const cagr = years > 0 && finalEq > 0 ? +((Math.pow(finalEq / initial, 1 / years) - 1) * 100).toFixed(2) : 0;

  // Max consecutive losses.
  let maxConsecLoss = 0, run = 0;
  for (const t of closed) { if (t.pnlUsd < 0) { run++; maxConsecLoss = Math.max(maxConsecLoss, run); } else run = 0; }

  const pcts = closed.map((t) => t.pnlPct);
  const buyHold = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;

  return {
    strategy, params, direction, initial,
    final: +finalEq.toFixed(2),
    totalReturnPct: +(((finalEq - initial) / initial) * 100).toFixed(2),
    buyHoldPct: +buyHold.toFixed(2),
    cagrPct: cagr,
    trades: closed.length,
    winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? Infinity : 0),
    expectancyPct: closed.length ? +mean(pcts).toFixed(2) : 0,
    maxDrawdownPct: +(maxDD * 100).toFixed(2),
    sharpe, sortino,
    exposurePct: +((barsInPos / candles.length) * 100).toFixed(1),
    avgWinPct: wins.length ? +mean(wins.map((t) => t.pnlPct)).toFixed(2) : 0,
    avgLossPct: losses.length ? +mean(losses.map((t) => t.pnlPct)).toFixed(2) : 0,
    bestPct: pcts.length ? +Math.max(...pcts).toFixed(2) : 0,
    worstPct: pcts.length ? +Math.min(...pcts).toFixed(2) : 0,
    avgBarsInTrade: closed.length ? Math.round(mean(closed.map((t) => t.bars || 0))) : 0,
    maxConsecLoss,
    equity, benchmark, tradeLog: trades,
  };
}

/** Cartesian product of a {param: values[]} spec → array of param objects. */
function paramCombos(spec) {
  const keys = Object.keys(spec);
  let combos = [{}];
  for (const k of keys) {
    const next = [];
    for (const c of combos) for (const v of spec[k]) next.push({ ...c, [k]: v });
    combos = next;
  }
  // Drop invalid fast>=slow combos.
  return combos.filter((c) => !(c.fast != null && c.slow != null && c.fast >= c.slow));
}

/**
 * Grid-search a strategy's parameters over candles. Returns the top results
 * ranked by `sortBy` (default totalReturnPct). Execution opts (direction, SL,
 * TP, slippage, fillAt…) are shared across every run.
 */
export function optimize(candles, { strategy = 'sma_cross', sortBy = 'totalReturnPct', exec = {}, maxCombos = 200, top = 15 } = {}) {
  const spec = STRATEGY_PARAMS[strategy];
  if (!spec) throw new Error(`Optimizacijai nėra parametrų: ${strategy}`);
  const combos = paramCombos(spec).slice(0, maxCombos);
  const results = [];
  for (const params of combos) {
    try {
      const r = runBacktest(candles, { ...exec, strategy, params });
      results.push({
        params,
        totalReturnPct: r.totalReturnPct, sharpe: r.sharpe, winRate: r.winRate,
        maxDrawdownPct: r.maxDrawdownPct, profitFactor: r.profitFactor === Infinity ? 999 : r.profitFactor,
        trades: r.trades,
      });
    } catch { /* skip invalid combo */ }
  }
  results.sort((a, b) => (b[sortBy] ?? -Infinity) - (a[sortBy] ?? -Infinity));
  return { strategy, sortBy, tested: results.length, results: results.slice(0, top) };
}
