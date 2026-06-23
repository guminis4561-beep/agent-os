// ═══════════════════════════════════════════════════
// DOMAIN: Trading Engine — Binance + AI analizė
// ═══════════════════════════════════════════════════
//
// Kairė  — Market Watch (realios Binance kainos, auto-refresh 30s)
// Centras — Analizės forma + intent → Task FSM (domainEngine:'trading')
// Dešinė — Task Terminal (SSE srautas)

import EventBus from '../../core/events.js';
import * as Api from '../../core/api-client.js';
import { showToast } from '../../components/toast.js';
import Storage from '../../core/storage.js';
import { modelSelectHtml, mountModelPicker, getSelectedModel } from './model-picker.js';
import { renderPortfolioPanel, initPortfolioPanel, loadPortfolio } from './trading/portfolio-panel.js';
import { renderBacktestPanel, initBacktestPanel } from './trading/backtest-panel.js';
import { renderBotsPanel, initBotsPanel, loadBots } from './trading/bots-panel.js';
import { createCandleChart } from './trading/candlestick-chart.js';

// ─── Module state ─────────────────────────────────
const SYMBOLS_DEFAULT = 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT';
let _prices     = [];
let _loadingPrices = true;
let _priceError = null;
let _refreshTimer = null;

let _taskLogs  = Storage.get('tradingTaskLogs') || [];
let _taskState = Storage.get('tradingTaskState') || null;
let _taskId    = Storage.get('tradingTaskId') || null;
let _sseUnsub  = null;

// Chart state
let _chart = null;        // canvas chart instance (createCandleChart)
let _levels = { support: [], resistance: [] }; // server-computed S/R
let _srVisible = true;    // S/R overlay toggle enabled by default
let _chartInterval = Storage.get('tradingChartInterval') || '1h';

// Selectable timeframes (1 minute → 1 month). Binance: lowercase m = min, M = month.
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

// Sentiment (Fear & Greed)
let _sentiment = null;

// Tabs
let _activeTab = 'analize';
const _initedTabs = new Set();

let _selectedSymbol = Storage.get('tradingSelectedSymbol') || 'BTCUSDT';
let _strategy = Storage.get('tradingStrategy') || 'trend';

function _saveState() {
  Storage.set('tradingTaskLogs', _taskLogs);
  Storage.set('tradingTaskState', _taskState);
  Storage.set('tradingTaskId', _taskId);
  Storage.set('tradingSelectedSymbol', _selectedSymbol);
  Storage.set('tradingStrategy', _strategy);
}

// ─── Render ───────────────────────────────────────

export function renderTradingEngine() {
  return `
    <div class="engine-view" style="height:100%;display:flex;flex-direction:column;">

      <!-- Header -->
      <div class="engine-view__header" style="flex-shrink:0;">
        <div class="engine-view__title">
          <div class="engine-view__title-icon" style="background:var(--trading-bg);color:var(--trading-accent);">◇</div>
          <span>Trading Engine</span>
        </div>
        <div class="engine-view__toolbar">
          <span id="trading-sentiment" title="Fear & Greed indeksas" style="font-size:10px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">…</span>
          <span class="badge badge--trading">MarketSense</span>
          <span style="font-size:10px;color:var(--text-muted);">Binance Public API</span>
          <button class="btn btn--ghost btn--sm" id="trading-refresh">⟳ Refresh</button>
        </div>
      </div>

      <!-- Tab bar -->
      <div style="flex-shrink:0;display:flex;gap:2px;padding:0 var(--space-4);border-bottom:1px solid var(--border-default);">
        ${[
          ['analize', '◇ Analizė'],
          ['portfelis', '💼 Portfelis'],
          ['backtest', '📊 Backtesting'],
          ['botai', '🤖 Botai'],
        ].map(([id, label]) => `
          <button class="trading-tab" data-tab="${id}" style="background:none;border:none;border-bottom:2px solid transparent;color:var(--text-muted);padding:var(--space-3) var(--space-3);font-size:var(--text-xs);font-weight:600;cursor:pointer;">${label}</button>
        `).join('')}
      </div>

      <!-- Tab content -->
      <div style="flex:1;min-height:0;overflow:hidden;position:relative;">

      <!-- TAB: Analizė (3-column layout) -->
      <div id="tab-analize" style="height:100%;display:grid;grid-template-columns:200px 1fr 280px;gap:0;overflow:hidden;">

        <!-- MARKET WATCH -->
        <div style="border-right:1px solid var(--border-default);overflow-y:auto;display:flex;flex-direction:column;">
          <div style="padding:var(--space-2) var(--space-3);font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid var(--border-default);display:flex;justify-content:space-between;align-items:center;">
            <span>Market Watch</span>
            ${_loadingPrices ? '<span style="opacity:.5;">…</span>' : `<span style="opacity:.5;">${new Date().toLocaleTimeString('lt-LT',{hour:'2-digit',minute:'2-digit'})}</span>`}
          </div>
          <div id="trading-market-list" style="flex:1;">
            ${_renderMarketList()}
          </div>
        </div>

        <!-- ANALYSIS FORM -->
        <div style="display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--border-default);">
          <div style="padding:var(--space-4);flex:1;overflow-y:auto;">

            <div style="margin-bottom:var(--space-5);">
              <div style="font-size:var(--text-xs);font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:var(--space-3);">Analizė</div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-3);">
                <div>
                  <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Pora</label>
                  <select id="trading-symbol-select" style="width:100%;padding:var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);font-family:var(--font-mono);">
                    ${SYMBOLS_DEFAULT.split(',').map(s => `<option value="${s}" ${s===_selectedSymbol?'selected':''}>${s}</option>`).join('')}
                    <option value="DOGEUSDT">DOGEUSDT</option>
                    <option value="ADAUSDT">ADAUSDT</option>
                    <option value="DOTUSDT">DOTUSDT</option>
                  </select>
                </div>
                <div>
                  <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Strategija</label>
                  <select id="trading-strategy-select" style="width:100%;padding:var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);">
                    <option value="trend" ${_strategy==='trend'?'selected':''}>Trend Following</option>
                    <option value="mean_reversion" ${_strategy==='mean_reversion'?'selected':''}>Mean Reversion</option>
                    <option value="breakout" ${_strategy==='breakout'?'selected':''}>Breakout</option>
                    <option value="sentiment" ${_strategy==='sentiment'?'selected':''}>Sentiment</option>
                    <option value="risk" ${_strategy==='risk'?'selected':''}>Risk Assessment</option>
                    <option value="custom" ${_strategy==='custom'?'selected':''}>Custom (be šablono)</option>
                  </select>
                </div>
              </div>

              <!-- Selected pair details -->
              <div id="trading-pair-info">
                ${_renderSelectedPair()}
              </div>

              <!-- Interaktyvus grafikas -->
              <div style="margin-top:var(--space-3);position:relative;">
                <div style="margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);flex-wrap:wrap;">
                  <div id="trading-tf-buttons" style="display:flex;gap:2px;flex-wrap:wrap;">
                    ${TIMEFRAMES.map(tf => `
                      <button class="trading-tf" data-tf="${tf}" style="background:none;border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-muted);padding:2px 7px;font-size:10px;font-family:var(--font-mono);cursor:pointer;line-height:1.4;">${tf}</button>
                    `).join('')}
                  </div>
                  <span id="trading-chart-tools" style="cursor:pointer;color:var(--trading-accent);font-size:10px;white-space:nowrap;">✕ Slėpti S/R ir Key Levels</span>
                </div>
                <div id="trading-chart-container" style="height:340px;border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--bg-body);overflow:hidden;position:relative;">
                  <div id="trading-chart-loader" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg-body);opacity:0.8;z-index:10;font-size:11px;color:var(--text-muted);">Kraunamas grafikas...</div>
                </div>
              </div>

              <div style="margin-top:var(--space-4);">
                <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Papildomas klausimas (neprivaloma)</label>
                <textarea id="trading-intent-extra" rows="3" placeholder="Pvz: Ar verta pirkti šiandien? Kokia rizika? Koks palaikymo lygis?"
                  style="width:100%;box-sizing:border-box;resize:vertical;padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border-default);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-xs);line-height:1.5;"></textarea>
              </div>

              <div style="margin-top:var(--space-3);display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);">
                <label style="font-size:11px;color:var(--text-muted);">Modelis</label>
                ${modelSelectHtml('trading-model-select', { compact: false })}
              </div>

              <button class="btn btn--primary" id="trading-analyze" style="margin-top:var(--space-3);width:100%;">
                ◇ Analizuoti su MarketSense AI
              </button>
            </div>

            <!-- Recent analyses -->
            <div>
              <div style="font-size:var(--text-xs);font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:var(--space-3);">Paskutinės analizės</div>
              <div id="trading-history">
                <div style="font-size:11px;color:var(--text-muted);">Dar nėra analizių. Spausk „Analizuoti".</div>
              </div>
            </div>
          </div>
        </div>

        <!-- TASK TERMINAL -->
        <div style="display:flex;flex-direction:column;overflow:hidden;background:var(--bg-body);">
          <div style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-default);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
            <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;">AI Terminal</span>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              ${_taskState ? `<span class="badge badge--${_tStateBadge(_taskState)}" style="font-size:9px;">${_taskState}</span>` : ''}
              ${_taskLogs.length ? `<button class="btn btn--ghost btn--sm" id="trading-clear-log" style="font-size:9px;padding:2px 6px;">✕</button>` : ''}
            </div>
          </div>
          <div id="trading-terminal" style="flex:1;overflow-y:auto;padding:var(--space-3);font-family:var(--font-mono);font-size:11px;line-height:1.6;">
            ${_renderTerminal()}
          </div>
        </div>

      </div><!-- /tab-analize -->

      <!-- TAB: Portfelis / Backtesting / Botai (lazy-rendered) -->
      <div id="tab-portfelis" style="height:100%;overflow-y:auto;display:none;"></div>
      <div id="tab-backtest" style="height:100%;overflow-y:auto;display:none;"></div>
      <div id="tab-botai" style="height:100%;overflow-y:auto;display:none;"></div>

      </div><!-- /tab content -->
    </div>
  `;
}

function _renderMarketList() {
  if (_loadingPrices) {
    return Array.from({length:5}, () => `
      <div style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-default);">
        <div style="height:30px;background:var(--bg-elevated);border-radius:3px;opacity:.4;"></div>
      </div>`).join('');
  }
  if (_priceError) {
    return `<div style="padding:var(--space-3);font-size:11px;color:var(--error);">Klaida: ${_escHtml(_priceError)}</div>`;
  }
  return _prices.map(p => {
    const isSelected = p.symbol === _selectedSymbol;
    const up = p.change >= 0;
    const vol = p.quoteVol >= 1e9 ? `$${(p.quoteVol/1e9).toFixed(1)}B` : `$${(p.quoteVol/1e6).toFixed(0)}M`;
    return `
      <div class="trading-market-item" data-symbol="${p.symbol}"
        style="padding:var(--space-2) var(--space-3);cursor:pointer;border-bottom:1px solid var(--border-default);
               background:${isSelected?'rgba(255,215,64,.06)':'transparent'};
               border-left:2px solid ${isSelected?'var(--trading-accent)':'transparent'};">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;font-weight:700;color:var(--text-primary);font-family:var(--font-mono);">${p.symbol.replace('USDT','')}</span>
          <span style="font-size:10px;font-weight:600;color:${up?'var(--success)':'var(--error)'};">${up?'▲':'▼'} ${Math.abs(p.change).toFixed(2)}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1px;">
          <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-primary);">$${_fmtPrice(p.price)}</span>
          <span style="font-size:9px;color:var(--text-muted);">${vol}</span>
        </div>
      </div>`;
  }).join('');
}

function _renderSelectedPair() {
  const p = _prices.find(x => x.symbol === _selectedSymbol);
  if (!p) return `<div style="padding:var(--space-3);font-size:11px;color:var(--text-muted);">Duomenys kraunami…</div>`;

  const up = p.change >= 0;
  const range = p.high - p.low;
  const pos = range > 0 ? ((p.price - p.low) / range) * 100 : 50;

  return `
    <div style="background:var(--bg-body);border-radius:var(--radius-md);border:1px solid var(--border-default);padding:var(--space-3);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-3);">
        <div>
          <div style="font-size:var(--text-xs);color:var(--text-muted);">${p.symbol}</div>
          <div style="font-size:var(--text-2xl);font-weight:700;font-family:var(--font-mono);">$${_fmtPrice(p.price)}</div>
        </div>
        <span style="font-size:var(--text-lg);font-weight:700;color:${up?'var(--success)':'var(--error)'};">${up?'+':''}${p.change.toFixed(2)}%</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);font-size:10px;">
        <div><span style="color:var(--text-muted);">High (24h): </span><span style="font-family:var(--font-mono);">$${_fmtPrice(p.high)}</span></div>
        <div><span style="color:var(--text-muted);">Low (24h): </span><span style="font-family:var(--font-mono);">$${_fmtPrice(p.low)}</span></div>
      </div>
    </div>`;
}

function _renderTerminal() {
  if (!_taskLogs.length) {
    return `<div style="color:var(--text-muted);opacity:.5;">$ Laukiama analizės…<br>Pasirink porą ir spausk „Analizuoti"</div>`;
  }
  return _taskLogs.map(e => {
    const c = e.type==='done'?'var(--success)':e.type==='error'?'var(--error)':e.type==='warn'?'var(--warning)':e.type==='state'?'var(--trading-accent)':'var(--text-secondary)';
    return `<div style="color:${c};margin-bottom:1px;"><span style="opacity:.5;">[${e.time}]</span> ${_escHtml(e.message)}</div>`;
  }).join('');
}

// ─── Events ───────────────────────────────────────

export function initTradingEvents() {
  document.getElementById('trading-refresh')?.addEventListener('click', () => _loadPrices());

  document.getElementById('trading-symbol-select')?.addEventListener('change', e => {
    _selectedSymbol = e.target.value;
    _saveState();
    _patchMarketList();
    _patchSelectedPair();
    _refreshChartData();
  });

  document.getElementById('trading-strategy-select')?.addEventListener('change', e => {
    _strategy = e.target.value;
    _saveState();
  });

  document.querySelectorAll('.trading-market-item[data-symbol]').forEach(el => {
    el.addEventListener('click', () => {
      _selectedSymbol = el.dataset.symbol;
      const sel = document.getElementById('trading-symbol-select');
      if (sel) {
        const exists = [...sel.options].some(o => o.value === _selectedSymbol);
        if (!exists) { const o = new Option(_selectedSymbol, _selectedSymbol); sel.add(o); }
        sel.value = _selectedSymbol;
      }
      _saveState();
      _patchMarketList();
      _patchSelectedPair();
      _refreshChartData();
    });
  });

  document.getElementById('trading-analyze')?.addEventListener('click', () => _runAnalysis());

  mountModelPicker('trading-model-select');

  document.getElementById('trading-clear-log')?.addEventListener('click', () => {
    _taskLogs = []; _taskState = null;
    _saveState();
    EventBus.emit('navigate', 'trading');
  });

  // Tab switching
  _activeTab = 'analize';
  _initedTabs.clear();
  _initedTabs.add('analize');
  document.querySelectorAll('.trading-tab').forEach(btn =>
    btn.addEventListener('click', () => _switchTab(btn.dataset.tab)));
  _paintTabStyles();

  _startSse();
  if (_loadingPrices) _loadPrices();
  _startAutoRefresh();
  _loadSentiment();

  // Initialize and load chart. init() already runs inside a requestAnimationFrame
  // (see app.js navigateTo), so the container is laid out — create the chart now
  // and populate it; no fragile setTimeout race window.
  _initChart();
  _refreshChartData();

  // Real Support/Resistance toggle (computed server-side from klines)
  document.getElementById('trading-chart-tools')?.addEventListener('click', () => _toggleSR());

  // Timeframe buttons (1m → 1M)
  document.querySelectorAll('.trading-tf').forEach(btn =>
    btn.addEventListener('click', () => _setInterval(btn.dataset.tf)));
  _paintTfButtons();
}

function _setInterval(tf) {
  if (!tf || tf === _chartInterval) return;
  _chartInterval = tf;
  Storage.set('tradingChartInterval', tf);
  _paintTfButtons();
  _refreshChartData();
}

function _paintTfButtons() {
  document.querySelectorAll('.trading-tf').forEach(btn => {
    const active = btn.dataset.tf === _chartInterval;
    btn.style.background = active ? 'var(--trading-accent)' : 'none';
    btn.style.color = active ? '#1a1a1a' : 'var(--text-muted)';
    btn.style.borderColor = active ? 'var(--trading-accent)' : 'var(--border-default)';
    btn.style.fontWeight = active ? '700' : '400';
  });
}

// ─── Tabs ─────────────────────────────────────────

function _switchTab(tab) {
  if (!tab || tab === _activeTab) return;
  // Cross-fade the content via the native View Transitions API when allowed.
  const run = () => _applyTab(tab);
  if (typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(run);
  } else { run(); }
}

function _applyTab(tab) {
  _activeTab = tab;
  ['analize', 'portfelis', 'backtest', 'botai'].forEach(id => {
    const el = document.getElementById(`tab-${id}`);
    if (el) el.style.display = id === tab ? (id === 'analize' ? 'grid' : 'block') : 'none';
  });
  _paintTabStyles();

  // Lazy-render + init each panel the first time it's shown; refresh on re-show.
  if (tab === 'portfelis') {
    if (!_initedTabs.has('portfelis')) {
      document.getElementById('tab-portfelis').innerHTML = renderPortfolioPanel();
      initPortfolioPanel();
      _initedTabs.add('portfelis');
    } else { loadPortfolio(); }
  } else if (tab === 'backtest') {
    if (!_initedTabs.has('backtest')) {
      document.getElementById('tab-backtest').innerHTML = renderBacktestPanel();
      initBacktestPanel();
      _initedTabs.add('backtest');
    }
  } else if (tab === 'botai') {
    if (!_initedTabs.has('botai')) {
      document.getElementById('tab-botai').innerHTML = renderBotsPanel();
      initBotsPanel();
      _initedTabs.add('botai');
    } else { loadBots(); }
  } else if (tab === 'analize') {
    // The chart was hidden (display:none collapses its size) — re-measure, and
    // recreate it if it was never built or got torn down.
    setTimeout(() => {
      if (!_chart || !document.querySelector('#trading-chart-container canvas')) _refreshChartData();
      else _chart.resize();
    }, 50);
  }
}

function _paintTabStyles() {
  document.querySelectorAll('.trading-tab').forEach(btn => {
    const active = btn.dataset.tab === _activeTab;
    btn.style.color = active ? 'var(--trading-accent)' : 'var(--text-muted)';
    btn.style.borderBottomColor = active ? 'var(--trading-accent)' : 'transparent';
  });
}

// ─── Sentiment (Fear & Greed) ─────────────────────

async function _loadSentiment() {
  try {
    _sentiment = await Api.getSentiment();
  } catch { _sentiment = null; }
  _renderSentimentWidget();
}

function _renderSentimentWidget() {
  const el = document.getElementById('trading-sentiment');
  if (!el) return;
  if (!_sentiment) { el.textContent = ''; return; }
  const v = _sentiment.value;
  const color = v < 25 ? 'var(--error)' : v < 45 ? 'var(--warning)' : v < 55 ? 'var(--text-secondary)' : v < 75 ? 'var(--success)' : 'var(--trading-accent)';
  const labelLt = v < 25 ? 'Ekstremali baimė' : v < 45 ? 'Baimė' : v < 55 ? 'Neutralu' : v < 75 ? 'Godumas' : 'Ekstremalus godumas';
  el.innerHTML = `Fear&amp;Greed: <strong style="color:${color};">${v}</strong> <span style="opacity:.7;">${labelLt}</span>`;
}

// ─── Data ─────────────────────────────────────────

async function _loadPrices() {
  _loadingPrices = true;
  _priceError = null;
  _patchMarketList();
  try {
    const res = await Api.getMarketPrices(SYMBOLS_DEFAULT);
    _prices = res.prices || [];
    _loadingPrices = false;
    _patchMarketList();
    _patchSelectedPair();
    // Atnaujinti laiko žymą
    const ts = document.querySelector('#trading-market-list')?.previousElementSibling?.querySelector('span:last-child');
    if (ts) ts.textContent = new Date().toLocaleTimeString('lt-LT',{hour:'2-digit',minute:'2-digit'});
  } catch (err) {
    _priceError = err.message;
    _loadingPrices = false;
    _patchMarketList();
    showToast(`Rinkos duomenys: ${err.message}`, 'error');
  }
}

function _startAutoRefresh() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    if (document.querySelector('#trading-market-list')) _loadPrices();
    else { clearInterval(_refreshTimer); _refreshTimer = null; }
  }, 30000);
}

async function _runAnalysis() {
  const p = _prices.find(x => x.symbol === _selectedSymbol);
  const extra = document.getElementById('trading-intent-extra')?.value.trim() || '';
  const strategyLabel = { trend:'Trend Following', mean_reversion:'Mean Reversion', breakout:'Breakout', sentiment:'Sentiment Analysis', risk:'Risk Assessment', custom:'Custom (Laisva forma)' }[_strategy] || _strategy;

  let marketContext = p
    ? `${p.symbol}: kaina $${_fmtPrice(p.price)}, 24h pokytis ${p.change>=0?'+':''}${p.change.toFixed(2)}%, High $${_fmtPrice(p.high)}, Low $${_fmtPrice(p.low)}, 24h apyvarta $${(p.quoteVol/1e6).toFixed(0)}M`
    : `${_selectedSymbol}: duomenys neprieinami`;

  // Enrich context with Fear & Greed sentiment + computed S/R levels (my additions).
  if (_sentiment) marketContext += `. Rinkos sentimentas (Fear&Greed): ${_sentiment.value}/100 (${_sentiment.classification})`;
  const srParts = [];
  if (_levels.resistance?.length) srParts.push(`pasipriešinimas: ${_levels.resistance.slice(0, 3).map(l => '$' + _fmtPrice(l.price)).join(', ')}`);
  if (_levels.support?.length) srParts.push(`palaikymas: ${_levels.support.slice(0, 3).map(l => '$' + _fmtPrice(l.price)).join(', ')}`);
  if (srParts.length) marketContext += `. Apskaičiuoti techniniai lygiai — ${srParts.join('; ')}`;

  let intent = '';
  if (_strategy === 'custom') {
    intent = `[Custom] ${_selectedSymbol} rinkos duomenys: ${marketContext}. ${extra ? `Vartotojo klausimas / instrukcija: ${extra}` : 'Įvertink šiuos duomenis.'}`;
  } else {
    intent = `[${strategyLabel}] Analizuok ${_selectedSymbol} kriptovaliutą. Dabartiniai rinkos duomenys: ${marketContext}. Atlik pilną ${strategyLabel} analizę: įvertink trenduą, palaikymo/pasipriešinimo lygius, riziką, galimą entry/exit strategiją.${extra ? ` Papildomas klausimas: ${extra}` : ''}`;
  }

  _taskLogs = [];
  _taskState = 'STARTING';
  _taskId = null;
  _saveState();
  _appendLog('state', `Paleidžiama analizė: ${_selectedSymbol} / ${strategyLabel}`);
  _patchTerminal();

  const btn = document.getElementById('trading-analyze');
  if (btn) { btn.disabled = true; btn.textContent = '…Analizuojama'; }

  try {
    const res = await Api.startTask({ intent, domainEngine: 'trading', modelId: getSelectedModel() || undefined });
    _taskId = res.taskId;
    _saveState();
    _appendLog('info', `Task: ${_taskId}`);
    _patchTerminal();
  } catch (err) {
    _appendLog('error', err.message);
    _taskState = 'FAILED';
    _patchTerminal();
    showToast(`Klaida: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '◇ Analizuoti su MarketSense AI'; }
  }
}

// ─── SSE ──────────────────────────────────────────

function _startSse() {
  if (_sseUnsub) return;
  _sseUnsub = Api.subscribeEvents((name, data) => {
    // Bot / portfolio events carry no taskId — handle before the task filter.
    if (name === 'bot:triggered') {
      showToast(data.message || 'Botas suveikė', 'success');
      if (_activeTab === 'portfelis' && _initedTabs.has('portfelis')) loadPortfolio();
      if (_activeTab === 'botai' && _initedTabs.has('botai')) loadBots();
      return;
    }
    if (name === 'portfolio:update') {
      if (_activeTab === 'portfelis' && _initedTabs.has('portfelis')) loadPortfolio();
      return;
    }
    if (data.taskId && _taskId && data.taskId !== _taskId) return;
    if (name === 'task:log') {
      const msg = data.message || data.preview || '';
      if (msg) { _appendLog(data.status==='error'?'error':data.status==='done'?'done':'info', `[${data.phase||''}] ${msg}`); _patchTerminal(); }
    } else if (name === 'task:stateChange') {
      _taskState = data.to || data.context?.state;
      _appendLog('state', `→ ${_taskState}`);
      _patchTerminal();
    } else if (name === 'task:done') {
      _taskState = data.state;
      _appendLog('done', `Baigta ✓`);
      if (data.output) _appendLog('done', data.output.slice(0, 600));
      _patchTerminal();
      const btn = document.getElementById('trading-analyze');
      if (btn) { btn.disabled = false; btn.textContent = '◇ Analizuoti su MarketSense AI'; }
      _loadHistory();
      if (data.output) _parseAndDrawSetup(data.output);
    } else if (name === 'task:error') {
      _appendLog('error', data.message || 'Klaida');
      _taskState = 'FAILED';
      _patchTerminal();
      const btn = document.getElementById('trading-analyze');
      if (btn) { btn.disabled = false; btn.textContent = '◇ Analizuoti su MarketSense AI'; }
    }
  });
}

// ─── History ──────────────────────────────────────

async function _loadHistory() {
  try {
    const res = await Api.getTasks();
    const tradingTasks = (res.tasks || []).filter(t => t.domainEngine === 'trading').slice(-5).reverse();
    const el = document.getElementById('trading-history');
    if (!el) return;
    if (!tradingTasks.length) { el.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">Dar nėra analizių.</div>'; return; }
    el.innerHTML = tradingTasks.map(t => {
      const sc = t.validationResult?.score;
      const up = t.state === 'COMPLETED';
      return `
        <div style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border-default);margin-bottom:var(--space-2);font-size:11px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;">${_escHtml(t.intent?.slice(0,60)||'—')}</span>
            <span class="badge badge--${up?'success':'error'}" style="font-size:9px;flex-shrink:0;">${up?'DONE':'ERR'}</span>
          </div>
          <div style="color:var(--text-muted);margin-top:2px;">${_ago(t.startedAt)}${sc!=null?` · ★${sc}`:''}</div>
        </div>`;
    }).join('');
  } catch { /* ignore */ }
}

// ─── DOM patches ──────────────────────────────────

function _appendLog(type, message) {
  const now = new Date().toLocaleTimeString('lt-LT',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  _taskLogs.push({ time: now, type, message });
  if (_taskLogs.length > 200) _taskLogs = _taskLogs.slice(-200);
  _saveState();
}
function _patchTerminal() {
  const el = document.getElementById('trading-terminal');
  if (!el) return;
  el.innerHTML = _renderTerminal();
  el.scrollTop = el.scrollHeight;
}
function _patchMarketList() {
  const el = document.getElementById('trading-market-list');
  if (el) {
    el.innerHTML = _renderMarketList();
    el.querySelectorAll('.trading-market-item[data-symbol]').forEach(item => {
      item.addEventListener('click', () => {
        _selectedSymbol = item.dataset.symbol;
        const sel = document.getElementById('trading-symbol-select');
        if (sel) { const exists=[...sel.options].some(o=>o.value===_selectedSymbol); if(!exists){const o=new Option(_selectedSymbol,_selectedSymbol);sel.add(o);} sel.value=_selectedSymbol; }
        _saveState();
        _patchMarketList();
        _patchSelectedPair();
      });
    });
  }
}
function _patchSelectedPair() {
  const container = document.getElementById('trading-pair-info');
  if (container) container.innerHTML = _renderSelectedPair();
}

EventBus.on('navigate', route => {
  if (route !== 'trading') {
    if (_sseUnsub) { _sseUnsub(); _sseUnsub = null; }
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    if (_chart) {
      try { _chart.destroy(); } catch { /* noop */ }
      _chart = null;
    }
  }
});

// ─── Chart Integration (self-contained canvas) ────

function _initChart() {
  const container = document.getElementById('trading-chart-container');
  const loader = document.getElementById('trading-chart-loader');
  if (!container) return;

  // Recreate if a stale chart's canvas is no longer in this container.
  if (_chart && !container.querySelector('canvas')) { _chart = null; }
  if (_chart) { try { _chart.destroy(); } catch { /* noop */ } _chart = null; }

  try {
    _chart = createCandleChart(container);
    if (loader) loader.style.display = 'none';
  } catch (e) {
    if (loader) { loader.style.display = 'flex'; loader.textContent = 'Klaida piešiant grafiką: ' + e.message; }
  }
}

async function _refreshChartData() {
  const loader = document.getElementById('trading-chart-loader');
  if (loader) { loader.style.display = 'flex'; loader.textContent = 'Kraunamas grafikas...'; }

  // Ensure the chart (canvas + toolbar) exists immediately, before the network wait.
  if (!_chart) _initChart();

  try {
    // Server returns candles + computed S/R levels + moving averages in one call.
    // 500 candles gives plenty of history to pan/zoom through.
    const res = await Api.getKlines(_selectedSymbol, _chartInterval, 500);
    const candles = (res.candles || []).map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
    }));
    _levels = res.levels || { support: [], resistance: [] };

    if (!_chart) _initChart();
    if (_chart && candles.length) {
      _chart.setData(candles, _selectedSymbol);
      if (res.indicators?.sma20) {
        const sma = res.candles
          .map((c, i) => ({ time: c.time, value: res.indicators.sma20[i] }))
          .filter(p => p.value != null);
        _chart.setSMA(sma);
      }
      const parseVWAP = (arr) => arr ? res.candles.map((c, i) => ({ time: c.time, value: arr[i] })).filter(p => p.value != null) : [];
      _chart.setVWAP({
          d: parseVWAP(res.indicators?.vwapD),
          w: parseVWAP(res.indicators?.vwapW),
          m: parseVWAP(res.indicators?.vwapM)
      });
      if (res.indicators?.cvd) {
        const cvdPts = res.candles
          .map((c, i) => ({ time: c.time, value: res.indicators.cvd[i] }))
          .filter(p => p.value != null);
        _chart.setCVD(cvdPts);
      }
      _chart.setLevels(_levels.support, _levels.resistance);
      _chart.toggleLevels(_srVisible);
    }
    if (loader) loader.style.display = 'none';
  } catch (err) {
    if (loader) { loader.style.display = 'flex'; loader.textContent = 'Klaida kraunant Binance duomenis: ' + err.message; }
  }
}

// ─── Support / Resistance overlay ─────────────────

function _toggleSR() {
  if (!_chart) return;
  _srVisible = _chart.toggleLevels();
  const label = document.getElementById('trading-chart-tools');
  const n = _levels.support.length + _levels.resistance.length;
  if (_srVisible) {
    if (label) label.textContent = `✕ Slėpti S/R ir Key Levels`;
    if (!n) showToast('Šiame intervale aiškių S/R lygių nerasta', 'info');
  } else {
    if (label) label.textContent = '+ Piešti Support/Resistance';
  }
}

// ─── Helpers ─────────────────────────────────────

function _tStateBadge(s) {
  if (s==='COMPLETED') return 'success';
  if (['FAILED','CANCELLED'].includes(s)) return 'error';
  return 'info';
}
function _fmtPrice(n) {
  if (n >= 1000) return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if (n >= 1)    return n.toFixed(4);
  return n.toFixed(6);
}
function _ago(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now()-ts)/1000);
  if (s<60) return `${s}s`; if (s<3600) return `${Math.floor(s/60)}min`; return `${Math.floor(s/3600)}h`;
}
function _escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _parseAndDrawSetup(text) {
  if (!_chart) return;
  if (!text) return;

  const cleanNum = (str) => {
    if (!str) return null;
    const s = str.replace(/[^\d.,]/g, '').replace(/,/g, '.');
    const parts = s.split('.');
    if (parts.length > 2) return parseFloat(parts.slice(0, -1).join('') + '.' + parts[parts.length-1]);
    return parseFloat(s) || null;
  };

  const lines = [];

  // 1. SL
  const slMatch = text.match(/(?:Stop.?Loss|SL|Stop\sLoss)[^\d]*([\d.,\s ]+)/i);
  if (slMatch) {
    const sl = cleanNum(slMatch[1]);
    if (sl) lines.push({ type: 'hline', price: sl, label: 'SL', color: '#f53030' });
  }

  // 2. Entry Zone or Line
  const entryZoneMatch = text.match(/(?:Įėjimo|Entry).*?(?:zona)?[^\d]*([\d.,\s ]+)(?:-|–|iki|to)([\d.,\s ]+)/i);
  if (entryZoneMatch) {
    const min = cleanNum(entryZoneMatch[1]);
    const max = cleanNum(entryZoneMatch[2]);
    if (min && max) {
       lines.push({ type: 'rect', min: Math.min(min, max), max: Math.max(min, max), label: 'Entry', color: '#11998e' });
    }
  } else {
    const entryMatch = text.match(/(?:Įėjimo|Entry)[^\d]*([\d.,\s ]+)/i);
    if (entryMatch) {
       const e = cleanNum(entryMatch[1]);
       if (e) lines.push({ type: 'hline', price: e, label: 'Entry', color: '#11998e' });
    }
  }

  // 3. TPs
  const tpRegex = /(?:Take.?Profit|TP)\s*(\d+)?[^\d]*([\d.,\s ]+)/gi;
  let match;
  let tpCount = 1;
  while ((match = tpRegex.exec(text)) !== null) {
    const tpNum = match[1] || tpCount;
    const tpVal = cleanNum(match[2]);
    if (tpVal && tpVal !== lines.find(l=>l.label==='SL')?.price) {
      lines.push({ type: 'hline', price: tpVal, label: `TP${tpNum}`, color: '#22a619', dashed: true });
      tpCount++;
    }
  }

  if (lines.length > 0) {
    _chart.addSetupLines(lines);
    showToast(`Rastas setupas, pridėti ${lines.length} grafiko lygiai`, 'success');
  }
}
