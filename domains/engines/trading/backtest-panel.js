// ═══════════════════════════════════════════════════
// DOMAIN: Trading — Backtesting panel
// ═══════════════════════════════════════════════════
//
// Runs a strategy over historical Binance candles (server-side, deterministic).
// Supports long/short, stop-loss / take-profit, slippage, position sizing and
// next-open fills. Reports a full risk/return metric set (Sharpe, Sortino, CAGR,
// exposure, expectancy …), an equity curve with drawdown shading + Buy&Hold
// overlay + trade markers, and a parameter grid-search optimizer.

import * as Api from '../../../core/api-client.js';
import { showToast } from '../../../components/toast.js';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const INTERVALS = ['15m', '1h', '4h', '1d'];
const STRATEGY_LABELS = {
  sma_cross: 'SMA Susikirtimas',
  ema_cross: 'EMA Susikirtimas',
  rsi: 'RSI Mean-Reversion',
  breakout: 'Breakout (Donchian)',
  macd: 'MACD',
  bollinger: 'Bollinger Bands',
};

// Default params + input labels per strategy.
const PARAM_DEFS = {
  sma_cross: [['fast', 'Greitas SMA', 9], ['slow', 'Lėtas SMA', 21]],
  ema_cross: [['fast', 'Greitas EMA', 12], ['slow', 'Lėtas EMA', 26]],
  rsi: [['period', 'RSI periodas', 14], ['oversold', 'Oversold', 30], ['overbought', 'Overbought', 70]],
  breakout: [['lookback', 'Lookback', 20]],
  macd: [['fast', 'Greitas EMA', 12], ['slow', 'Lėtas EMA', 26], ['signal', 'Signalas', 9]],
  bollinger: [['period', 'Periodas', 20], ['mult', 'σ daugiklis', 2]],
};

let _busy = false;
let _lastResult = null;

export function renderBacktestPanel() {
  const inp = (id, label, val, min) => `
    <div>
      <label style="display:block;font-size:10px;color:var(--text-muted);margin-bottom:2px;">${label}</label>
      <input id="${id}" type="number" value="${val}" ${min != null ? `min="${min}"` : ''}
        style="width:84px;padding:var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-family:var(--font-mono);font-size:var(--text-xs);">
    </div>`;
  return `
    <div style="padding:var(--space-4);max-width:1040px;margin:0 auto;">
      <h3 style="margin:0 0 2px;font-size:var(--text-lg);">Strategijų testavimas (Backtesting)</h3>
      <p style="margin:0 0 var(--space-4);font-size:var(--text-xs);color:var(--text-muted);">Istoriniai Binance duomenys, deterministiškai. Long/Short, SL/TP, slippage, pozicijos dydis ir realios rizikos metrikos.</p>

      <div class="card" style="padding:var(--space-4);margin-bottom:var(--space-4);">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-3);">
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Pora</label>
            <select id="bt-symbol" class="bt-sel">${PAIRS.map(s => `<option value="${s}">${s}</option>`).join('')}</select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Strategija</label>
            <select id="bt-strategy" class="bt-sel">${Object.entries(STRATEGY_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Intervalas</label>
            <select id="bt-interval" class="bt-sel">${INTERVALS.map(s => `<option value="${s}" ${s === '1h' ? 'selected' : ''}>${s}</option>`).join('')}</select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Žvakių sk.</label>
            <select id="bt-limit" class="bt-sel">${[200, 500, 1000].map(s => `<option value="${s}" ${s === 500 ? 'selected' : ''}>${s}</option>`).join('')}</select>
          </div>
        </div>

        <div id="bt-params" style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3);flex-wrap:wrap;"></div>

        <!-- Execution options -->
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;padding-top:var(--space-3);border-top:1px solid var(--border-default);">
          <div>
            <label style="display:block;font-size:10px;color:var(--text-muted);margin-bottom:2px;">Kryptis</label>
            <select id="bt-direction" class="bt-sel" style="width:120px;">
              <option value="long">Tik Long</option>
              <option value="short">Tik Short</option>
              <option value="both">Long + Short</option>
            </select>
          </div>
          ${inp('bt-sl', 'Stop-Loss %', 0, 0)}
          ${inp('bt-tp', 'Take-Profit %', 0, 0)}
          ${inp('bt-slip', 'Slippage %', 0.05, 0)}
          ${inp('bt-pos', 'Pozicija %', 100, 5)}
          <div>
            <label style="display:block;font-size:10px;color:var(--text-muted);margin-bottom:2px;">Užpildymas</label>
            <select id="bt-fill" class="bt-sel" style="width:130px;">
              <option value="close">Close (greita)</option>
              <option value="nextOpen">Kitas Open (realu)</option>
            </select>
          </div>
        </div>

        <div style="display:flex;gap:var(--space-2);margin-top:var(--space-4);">
          <button class="btn btn--primary" id="bt-run" style="flex:1;">▶ Paleisti backtest</button>
          <button class="btn btn--secondary" id="bt-optimize" title="Grid-search geriausiems parametrams" style="flex:1;">🔍 Optimizuoti parametrus</button>
        </div>
      </div>

      <div id="bt-results"></div>

      <style>
        .bt-sel{width:100%;padding:var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);}
      </style>
    </div>
  `;
}

export function initBacktestPanel() {
  document.getElementById('bt-strategy')?.addEventListener('change', _renderParams);
  document.getElementById('bt-run')?.addEventListener('click', _run);
  document.getElementById('bt-optimize')?.addEventListener('click', _optimize);
  _renderParams();
}

function _renderParams() {
  const strat = document.getElementById('bt-strategy')?.value || 'sma_cross';
  const el = document.getElementById('bt-params');
  if (!el) return;
  el.innerHTML = (PARAM_DEFS[strat] || []).map(([id, label, val]) => `
    <div>
      <label style="display:block;font-size:10px;color:var(--text-muted);margin-bottom:2px;">${label}</label>
      <input id="bt-p-${id}" type="number" step="any" value="${val}"
        style="width:96px;padding:var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-family:var(--font-mono);font-size:var(--text-xs);">
    </div>`).join('');
}

function _collectParams(strat) {
  const out = {};
  for (const [id] of (PARAM_DEFS[strat] || [])) {
    const e = document.getElementById(`bt-p-${id}`);
    if (e) out[id] = Number(e.value);
  }
  return out;
}

function _baseBody() {
  const num = (id) => Number(document.getElementById(id)?.value);
  return {
    symbol: document.getElementById('bt-symbol').value,
    strategy: document.getElementById('bt-strategy').value,
    interval: document.getElementById('bt-interval').value,
    limit: Number(document.getElementById('bt-limit').value),
    direction: document.getElementById('bt-direction').value,
    stopLoss: num('bt-sl'), takeProfit: num('bt-tp'),
    slippage: num('bt-slip'), positionPct: num('bt-pos'),
    fillAt: document.getElementById('bt-fill').value,
  };
}

async function _run() {
  if (_busy) return;
  const strategy = document.getElementById('bt-strategy').value;
  const body = { ..._baseBody(), params: _collectParams(strategy) };
  _busy = true;
  const btn = document.getElementById('bt-run');
  if (btn) { btn.disabled = true; btn.textContent = '…Skaičiuojama'; }
  const out = document.getElementById('bt-results');
  if (out) out.innerHTML = `<div style="padding:var(--space-5);text-align:center;color:var(--text-muted);">Vykdoma simuliacija…</div>`;
  try {
    const res = await Api.runBacktest(body);
    _lastResult = res.result;
    _paintResults(res.result, res.symbol, res.interval);
  } catch (err) {
    if (out) out.innerHTML = `<div class="card" style="padding:var(--space-4);color:var(--error);">Klaida: ${_esc(err.message)}</div>`;
    showToast(err.message, 'error');
  } finally {
    _busy = false;
    if (btn) { btn.disabled = false; btn.textContent = '▶ Paleisti backtest'; }
  }
}

async function _optimize() {
  if (_busy) return;
  const body = { ..._baseBody(), sortBy: 'sharpe' };
  _busy = true;
  const btn = document.getElementById('bt-optimize');
  if (btn) { btn.disabled = true; btn.textContent = '…Ieškoma'; }
  const out = document.getElementById('bt-results');
  if (out) out.innerHTML = `<div style="padding:var(--space-5);text-align:center;color:var(--text-muted);">Tikrinami parametrų deriniai…</div>`;
  try {
    const res = await Api.optimizeBacktest(body);
    _paintOptimizer(res);
  } catch (err) {
    if (out) out.innerHTML = `<div class="card" style="padding:var(--space-4);color:var(--error);">Klaida: ${_esc(err.message)}</div>`;
    showToast(err.message, 'error');
  } finally {
    _busy = false;
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Optimizuoti parametrus'; }
  }
}

// ─── Results ──────────────────────────────────────
function _paintResults(r, symbol, interval) {
  const out = document.getElementById('bt-results');
  if (!out) return;
  const beat = r.totalReturnPct > r.buyHoldPct;
  const retC = r.totalReturnPct >= 0 ? 'var(--success)' : 'var(--error)';
  const pf = (r.profitFactor === null || !isFinite(r.profitFactor)) ? '∞' : r.profitFactor;
  const dirLabel = { long: 'Long', short: 'Short', both: 'Long+Short' }[r.direction] || r.direction;

  out.innerHTML = `
    <div class="card" style="padding:var(--space-4);margin-bottom:var(--space-3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3);flex-wrap:wrap;gap:var(--space-2);">
        <span style="font-weight:700;font-family:var(--font-mono);font-size:var(--text-sm);">${symbol} · ${interval} · ${STRATEGY_LABELS[r.strategy] || r.strategy} · ${dirLabel}</span>
        <span class="badge badge--${beat ? 'success' : 'error'}" style="font-size:10px;">${beat ? '✓ Geriau nei Buy&Hold' : '✕ Prasčiau nei Buy&Hold'}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:var(--space-2);margin-bottom:var(--space-3);">
        ${_metric('Grąža', (r.totalReturnPct >= 0 ? '+' : '') + r.totalReturnPct + '%', retC)}
        ${_metric('Buy & Hold', (r.buyHoldPct >= 0 ? '+' : '') + r.buyHoldPct + '%', 'var(--text-secondary)')}
        ${_metric('CAGR', (r.cagrPct >= 0 ? '+' : '') + r.cagrPct + '%', r.cagrPct >= 0 ? 'var(--success)' : 'var(--error)')}
        ${_metric('Win Rate', r.winRate + '%', r.winRate >= 50 ? 'var(--success)' : 'var(--warning)')}
        ${_metric('Profit Factor', pf, Number(pf) >= 1 ? 'var(--success)' : 'var(--error)')}
        ${_metric('Max Drawdown', '-' + r.maxDrawdownPct + '%', 'var(--error)')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:var(--space-2);">
        ${_metric('Sharpe', r.sharpe, r.sharpe >= 1 ? 'var(--success)' : r.sharpe >= 0 ? 'var(--warning)' : 'var(--error)')}
        ${_metric('Sortino', r.sortino, r.sortino >= 1 ? 'var(--success)' : r.sortino >= 0 ? 'var(--warning)' : 'var(--error)')}
        ${_metric('Exposure', r.exposurePct + '%', 'var(--text-secondary)')}
        ${_metric('Expectancy', (r.expectancyPct >= 0 ? '+' : '') + r.expectancyPct + '%', r.expectancyPct >= 0 ? 'var(--success)' : 'var(--error)')}
        ${_metric('Nuost. serija', r.maxConsecLoss, 'var(--text-secondary)')}
        ${_metric('Sandoriai', r.trades, 'var(--text-primary)')}
      </div>
      <div style="margin-top:var(--space-3);font-size:10px;color:var(--text-muted);font-family:var(--font-mono);display:flex;gap:var(--space-4);flex-wrap:wrap;">
        <span>Vid. pelnas: <span style="color:var(--success)">+${r.avgWinPct}%</span></span>
        <span>Vid. nuostolis: <span style="color:var(--error)">${r.avgLossPct}%</span></span>
        <span>Geriausias: +${r.bestPct}%</span>
        <span>Blogiausias: ${r.worstPct}%</span>
        <span>Vid. trukmė: ${r.avgBarsInTrade} žv.</span>
      </div>
    </div>

    <div class="card" style="padding:var(--space-4);margin-bottom:var(--space-3);">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:var(--space-2);display:flex;gap:var(--space-3);">
        <span><span style="display:inline-block;width:18px;height:2px;background:${retC};vertical-align:middle;"></span> Strategija</span>
        <span><span style="display:inline-block;width:18px;height:2px;background:var(--text-muted);vertical-align:middle;"></span> Buy &amp; Hold</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:rgba(245,48,48,.18);vertical-align:middle;"></span> Drawdown</span>
      </div>
      ${_equitySvg(r)}
    </div>

    <div class="card" style="padding:0;">
      <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);">Sandoriai (${r.tradeLog.filter(t => t.pnlPct != null).length})</div>
      <div style="max-height:240px;overflow-y:auto;">
        ${r.tradeLog.filter(t => t.pnlPct != null).map(t => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px var(--space-4);border-bottom:1px solid var(--border-default);font-size:11px;font-family:var(--font-mono);">
            <span style="display:flex;gap:8px;align-items:center;">
              <span class="badge badge--${t.side === 'long' ? 'success' : 'error'}" style="font-size:8px;">${t.side === 'long' ? 'LONG' : 'SHORT'}</span>
              <span>$${_fmt(t.entryPrice)} → $${_fmt(t.exitPrice)}</span>
              <span style="color:var(--text-muted);opacity:.8;">${_reason(t.reason)} · ${t.bars}žv.</span>
            </span>
            <span style="color:${t.pnlPct >= 0 ? 'var(--success)' : 'var(--error)'};font-weight:700;">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}%</span>
          </div>`).join('') || `<div style="padding:var(--space-4);text-align:center;color:var(--text-muted);font-size:11px;">Strategija neatliko nė vieno sandorio</div>`}
      </div>
    </div>
  `;
}

function _reason(r) {
  return { SL: '🛑SL', TP: '🎯TP', signal: 'signalas', eod: 'pabaiga' }[r] || r || '';
}

// Equity curve with drawdown shading, Buy&Hold overlay and trade markers.
function _equitySvg(r) {
  const eq = r.equity, bh = r.benchmark;
  if (!eq || eq.length < 2) return '<div style="color:var(--text-muted);font-size:11px;">Nepakanka duomenų</div>';
  const W = 920, H = 160, pad = 4;
  const all = eq.map(e => e.value).concat(bh ? bh.map(e => e.value) : []);
  const min = Math.min(...all), max = Math.max(...all), range = (max - min) || 1;
  const n = eq.length;
  const X = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const Y = (v) => pad + (1 - (v - min) / range) * (H - pad * 2);

  // Running peak for the underwater (drawdown) region.
  let peak = -Infinity;
  const peakY = [], eqY = [];
  for (let i = 0; i < n; i++) { peak = Math.max(peak, eq[i].value); peakY.push(Y(peak)); eqY.push(Y(eq[i].value)); }
  const ddPath = `M ${eq.map((_, i) => `${X(i).toFixed(1)},${peakY[i].toFixed(1)}`).join(' L ')} L ${[...eq].map((_, i) => `${X(n - 1 - i).toFixed(1)},${eqY[n - 1 - i].toFixed(1)}`).join(' L ')} Z`;

  const eqPts = eq.map((e, i) => `${X(i).toFixed(1)},${Y(e.value).toFixed(1)}`).join(' ');
  const bhPts = bh ? bh.map((e, i) => `${X(i).toFixed(1)},${Y(e.value).toFixed(1)}`).join(' ') : '';
  const last = eq[n - 1].value, first = eq[0].value;
  const color = last >= first ? 'var(--success)' : 'var(--error)';
  const baseY = Y(r.initial);

  // Trade markers (entry ▲/▼, exit ✕) at the equity value of their index.
  const markers = (r.tradeLog || []).filter(t => t.exitIndex != null).map(t => {
    const ex = X(t.exitIndex), ey = Y(eq[Math.min(t.exitIndex, n - 1)]?.value ?? last);
    const en = X(t.entryIndex), ny = Y(eq[Math.min(t.entryIndex, n - 1)]?.value ?? first);
    const up = t.side === 'long';
    const tri = up
      ? `<path d="M${en - 3},${ny + 4} L${en + 3},${ny + 4} L${en},${ny - 2} Z" fill="var(--success)" opacity=".8"/>`
      : `<path d="M${en - 3},${ny - 4} L${en + 3},${ny - 4} L${en},${ny + 2} Z" fill="var(--error)" opacity=".8"/>`;
    const exitMark = `<path d="M${ex - 2.5},${ey - 2.5} L${ex + 2.5},${ey + 2.5} M${ex + 2.5},${ey - 2.5} L${ex - 2.5},${ey + 2.5}" stroke="${t.pnlPct >= 0 ? 'var(--success)' : 'var(--error)'}" stroke-width="1.2"/>`;
    return tri + exitMark;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:160px;display:block;">
      <path d="${ddPath}" fill="rgba(245,48,48,.16)" stroke="none"/>
      <line x1="0" y1="${baseY.toFixed(1)}" x2="${W}" y2="${baseY.toFixed(1)}" stroke="var(--border-default)" stroke-width="1" stroke-dasharray="4 4"/>
      ${bhPts ? `<polyline points="${bhPts}" fill="none" stroke="var(--text-muted)" stroke-width="1" opacity=".6" stroke-dasharray="3 3"/>` : ''}
      <polyline points="${eqPts}" fill="none" stroke="${color}" stroke-width="1.6"/>
      ${markers}
    </svg>`;
}

// ─── Optimizer ────────────────────────────────────
function _paintOptimizer(res) {
  const out = document.getElementById('bt-results');
  if (!out) return;
  if (!res.results?.length) {
    out.innerHTML = `<div class="card" style="padding:var(--space-4);color:var(--text-muted);">Nerasta tinkamų derinių.</div>`;
    return;
  }
  out.innerHTML = `
    <div class="card" style="padding:0;">
      <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);">Optimizacija · ${STRATEGY_LABELS[res.strategy] || res.strategy} · ${res.tested} deriniai (pagal Sharpe)</span>
        <span style="font-size:10px;color:var(--text-muted);">Spustelėk eilutę → užkrauti parametrus</span>
      </div>
      <div style="display:grid;grid-template-columns:40px 1.6fr 1fr 1fr 1fr 1fr 0.8fr;gap:0;font-size:10px;color:var(--text-muted);text-transform:uppercase;padding:6px var(--space-4);border-bottom:1px solid var(--border-default);">
        <span>#</span><span>Parametrai</span><span style="text-align:right;">Grąža</span><span style="text-align:right;">Sharpe</span><span style="text-align:right;">Win</span><span style="text-align:right;">DD</span><span style="text-align:right;">Sand.</span>
      </div>
      <div style="max-height:300px;overflow-y:auto;">
        ${res.results.map((row, i) => `
          <div class="bt-opt-row" data-params='${_esc(JSON.stringify(row.params))}'
            style="display:grid;grid-template-columns:40px 1.6fr 1fr 1fr 1fr 1fr 0.8fr;gap:0;align-items:center;padding:7px var(--space-4);border-bottom:1px solid var(--border-default);font-size:11px;font-family:var(--font-mono);cursor:pointer;${i === 0 ? 'background:rgba(34,166,25,.06);' : ''}">
            <span style="color:var(--text-muted);">${i + 1}</span>
            <span>${Object.entries(row.params).map(([k, v]) => `${k}=${v}`).join(' ')}</span>
            <span style="text-align:right;color:${row.totalReturnPct >= 0 ? 'var(--success)' : 'var(--error)'};">${row.totalReturnPct >= 0 ? '+' : ''}${row.totalReturnPct}%</span>
            <span style="text-align:right;color:${row.sharpe >= 1 ? 'var(--success)' : 'var(--text-primary)'};">${row.sharpe}</span>
            <span style="text-align:right;">${row.winRate}%</span>
            <span style="text-align:right;color:var(--error);">-${row.maxDrawdownPct}%</span>
            <span style="text-align:right;color:var(--text-muted);">${row.trades}</span>
          </div>`).join('')}
      </div>
    </div>
  `;
  out.querySelectorAll('.bt-opt-row').forEach(row => row.addEventListener('click', () => {
    try {
      const params = JSON.parse(row.dataset.params);
      const strat = document.getElementById('bt-strategy').value;
      for (const [k, v] of Object.entries(params)) {
        const e = document.getElementById(`bt-p-${k}`);
        if (e) e.value = v;
      }
      showToast('Parametrai užkrauti — paleidžiamas backtest', 'info');
      _run();
    } catch { /* ignore */ }
  }));
}

// ─── Helpers ──────────────────────────────────────
function _metric(label, value, color) {
  return `<div style="text-align:center;">
    <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;">${label}</div>
    <div style="font-size:var(--text-md);font-weight:700;font-family:var(--font-mono);color:${color};margin-top:2px;">${value}</div>
  </div>`;
}
function _fmt(n) { n = Number(n) || 0; return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toFixed(6); }
function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;'); }
