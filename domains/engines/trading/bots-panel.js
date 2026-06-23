// ═══════════════════════════════════════════════════
// DOMAIN: Trading — Automated Bots panel
// ═══════════════════════════════════════════════════
//
// Create condition→action rules the server scheduler evaluates each tick. Bots
// place PAPER orders only. Supports signal + DCA bots, indicator conditions
// (RSI / SMA-EMA cross), edge-triggering, brackets (TP/SL/trailing), budget caps,
// % -of-cash sizing, templates and live distance-to-trigger.

import * as Api from '../../../core/api-client.js';
import { showToast } from '../../../components/toast.js';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

const CONDITIONS = {
  price_below: 'Kaina žemiau $',
  price_above: 'Kaina virš $',
  change_below: 'Pokytis 24h žemiau %',
  change_above: 'Pokytis 24h virš %',
  pct_from_start_below: 'Pokytis nuo sukūrimo žemiau %',
  pct_from_start_above: 'Pokytis nuo sukūrimo virš %',
  rsi_below: 'RSI žemiau',
  rsi_above: 'RSI virš',
  sma_cross_up: 'SMA kerta aukštyn',
  sma_cross_down: 'SMA kerta žemyn',
  ema_cross_up: 'EMA kerta aukštyn',
  ema_cross_down: 'EMA kerta žemyn',
};
const NEEDS_VALUE = new Set(['price_below', 'price_above', 'change_below', 'change_above', 'pct_from_start_below', 'pct_from_start_above', 'rsi_below', 'rsi_above']);
const NEEDS_RSI = new Set(['rsi_below', 'rsi_above']);
const NEEDS_MA = new Set(['sma_cross_up', 'sma_cross_down', 'ema_cross_up', 'ema_cross_down']);

const TEMPLATES = {
  'BTC dip pirkėjas': { symbol: 'BTCUSDT', botType: 'signal', conditionType: 'change_below', conditionValue: -5, side: 'buy', quoteAmount: 500, sentimentMax: 40 },
  'RSI oversold + TP': { symbol: 'ETHUSDT', botType: 'signal', conditionType: 'rsi_below', conditionValue: 30, rsiPeriod: 14, side: 'buy', quoteAmount: 500, takeProfit: 10, stopLoss: 5 },
  'DCA kas valandą': { symbol: 'BTCUSDT', botType: 'dca', side: 'buy', quoteAmount: 100, cooldownMin: 60, maxAllocation: 2000 },
  'EMA cross + trailing': { symbol: 'SOLUSDT', botType: 'signal', conditionType: 'ema_cross_up', fast: 12, slow: 26, side: 'buy', quoteAmount: 500, trailingStop: 5 },
};

let _bots = [];
let _prices = {};
let _editingId = null;

const fld = (id, label, val, attrs = '') => `
  <div>
    <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">${label}</label>
    <input id="${id}" value="${val}" ${attrs} style="width:100%;box-sizing:border-box;padding:var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);font-family:var(--font-mono);">
  </div>`;

export function renderBotsPanel() {
  return `
    <div style="padding:var(--space-4);max-width:1040px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-3);flex-wrap:wrap;gap:var(--space-2);">
        <div>
          <h3 style="margin:0 0 2px;font-size:var(--text-lg);">Automatiniai botai</h3>
          <p style="margin:0;font-size:var(--text-xs);color:var(--text-muted);">Serveris kas minutę tikrina taisykles ir vykdo paper orderius 24/7. Edge-trigger, indikatoriai, SL/TP, DCA.</p>
        </div>
        <div style="display:flex;gap:var(--space-2);">
          <button class="btn btn--ghost btn--sm" id="bots-enable-all">▶ Įjungti visus</button>
          <button class="btn btn--ghost btn--sm" id="bots-pause-all">⏸ Stabdyti visus</button>
        </div>
      </div>

      <!-- Templates -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--space-3);">
        <span style="font-size:11px;color:var(--text-muted);align-self:center;">Šablonai:</span>
        ${Object.keys(TEMPLATES).map(t => `<button class="btn btn--ghost btn--sm bot-tpl" data-tpl="${t}" style="font-size:10px;padding:3px 8px;">${t}</button>`).join('')}
      </div>

      <!-- AI Generator -->
      <details style="margin-bottom:var(--space-4);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);overflow:hidden;">
        <summary style="padding:var(--space-3);font-size:12px;font-weight:600;color:var(--trading-accent);cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;">
          <span>✨ Generuoti iš kodo (Python / JSON)</span>
        </summary>
        <div style="padding:var(--space-3);border-top:1px solid var(--border-default);">
          <p style="font-size:11px;color:var(--text-muted);margin:0 0 var(--space-2) 0;">Įklijuokite savo prekybos strategijos Python kodą ar JSON setup'ą, ir MarketSense AI automatiškai užpildys boto parametrus.</p>
          <textarea id="bot-ai-input" rows="4" placeholder="Pvz.: if rsi < 30 and price_change < -5: buy(amount=1000, tp=5, sl=2)" style="width:100%;box-sizing:border-box;resize:vertical;padding:var(--space-2);background:var(--bg-body);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:11px;font-family:var(--font-mono);margin-bottom:var(--space-2);"></textarea>
          <div style="display:flex;justify-content:flex-end;">
            <button class="btn btn--primary btn--sm" id="bot-ai-parse">Išanalizuoti ir užpildyti</button>
          </div>
        </div>
      </details>

      <div class="card" style="padding:var(--space-4);margin-bottom:var(--space-4);">
        <div style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:var(--space-3);" id="bot-form-title">Naujas botas</div>

        <div style="display:grid;grid-template-columns:1.4fr 0.8fr 0.8fr 0.8fr;gap:var(--space-3);margin-bottom:var(--space-3);">
          ${fld('bot-name', 'Pavadinimas', '', 'placeholder="pvz. BTC dip pirkėjas"')}
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Pora</label>
            <select id="bot-symbol" class="bot-sel">${PAIRS.map(s => `<option value="${s}">${s}</option>`).join('')}</select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Tipas</label>
            <select id="bot-type" class="bot-sel">
              <option value="signal">Signalas</option>
              <option value="dca">DCA (periodinis)</option>
            </select>
          </div>
          <div id="bot-trigger-wrap">
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Trigeris</label>
            <select id="bot-trigger" class="bot-sel">
              <option value="once">Vieną kartą (edge)</option>
              <option value="always">Kaskart (level)</option>
            </select>
          </div>
        </div>

        <!-- Condition (signal only) -->
        <div id="bot-cond-block" style="display:grid;grid-template-columns:2fr auto;gap:var(--space-3);margin-bottom:var(--space-3);align-items:end;">
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Sąlyga</label>
            <select id="bot-cond" class="bot-sel">${Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          </div>
          <div id="bot-cond-params" style="display:flex;gap:var(--space-3);"></div>
        </div>

        <!-- Action -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-3);">
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Veiksmas</label>
            <select id="bot-side" class="bot-sel"><option value="buy">PIRKTI</option><option value="sell">PARDUOTI</option></select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Dydžio režimas</label>
            <select id="bot-sizing" class="bot-sel"><option value="fixed">Fiksuotas $</option><option value="pctCash">% laisvų lėšų</option></select>
          </div>
          ${fld('bot-amount', 'Suma (USDT / %)', '500', 'type="number" step="any"')}
          <div id="bot-sellpct-wrap" style="display:none;">
            ${fld('bot-sellpct', 'Parduoti % pozicijos', '100', 'type="number" step="any"')}
          </div>
        </div>

        <!-- Brackets (buy) -->
        <details id="bot-bracket-block" style="margin-bottom:var(--space-3);">
          <summary style="font-size:11px;color:var(--trading-accent);cursor:pointer;">+ Brackets: Take-Profit / Stop-Loss / Trailing (auto-uždaro poziciją)</summary>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3);margin-top:var(--space-2);">
            ${fld('bot-tp', 'Take-Profit %', '0', 'type="number" step="any" min="0"')}
            ${fld('bot-sl', 'Stop-Loss %', '0', 'type="number" step="any" min="0"')}
            ${fld('bot-trail', 'Trailing Stop %', '0', 'type="number" step="any" min="0"')}
          </div>
        </details>

        <!-- Safety / lifecycle -->
        <details style="margin-bottom:var(--space-3);">
          <summary style="font-size:11px;color:var(--trading-accent);cursor:pointer;">+ Sauga: biudžetas, cooldown, limitai, galiojimas</summary>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:var(--space-3);margin-top:var(--space-2);">
            ${fld('bot-maxalloc', 'Max biudžetas $ (0=∞)', '0', 'type="number" step="any" min="0"')}
            ${fld('bot-cooldown', 'Cooldown (min)', '30', 'type="number" min="0"')}
            ${fld('bot-maxtrig', 'Max suveikimų (0=∞)', '0', 'type="number" min="0"')}
            ${fld('bot-expiry', 'Galioja (dienos, 0=∞)', '0', 'type="number" min="0"')}
          </div>
        </details>

        <!-- Sentiment gate -->
        <details style="margin-bottom:var(--space-3);">
          <summary style="font-size:11px;color:var(--trading-accent);cursor:pointer;">+ Fear &amp; Greed filtras</summary>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-top:var(--space-2);">
            ${fld('bot-sent-min', 'Min indeksas (0–100)', '', 'type="number" placeholder="tuščia = bet koks"')}
            ${fld('bot-sent-max', 'Max indeksas (0–100)', '', 'type="number" placeholder="pvz. 40 = tik baimė"')}
          </div>
        </details>

        <div style="display:flex;gap:var(--space-2);">
          <button class="btn btn--primary" id="bot-create" style="flex:1;">+ Sukurti botą</button>
          <button class="btn btn--ghost" id="bot-cancel-edit" style="display:none;">Atšaukti</button>
        </div>
      </div>

      <div id="bots-list"></div>
      <style>.bot-sel{width:100%;padding:var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);}</style>
    </div>
  `;
}

export function initBotsPanel() {
  document.getElementById('bot-create')?.addEventListener('click', _submit);
  document.getElementById('bot-cancel-edit')?.addEventListener('click', _cancelEdit);
  document.getElementById('bot-type')?.addEventListener('change', _syncFormVisibility);
  document.getElementById('bot-cond')?.addEventListener('change', _renderCondParams);
  document.getElementById('bot-side')?.addEventListener('change', _syncFormVisibility);
  document.getElementById('bot-sizing')?.addEventListener('change', _syncFormVisibility);
  document.getElementById('bots-pause-all')?.addEventListener('click', () => _setAll(false));
  document.getElementById('bots-enable-all')?.addEventListener('click', () => _setAll(true));
  document.getElementById('bot-ai-parse')?.addEventListener('click', _parseAI);
  document.querySelectorAll('.bot-tpl').forEach(b => b.addEventListener('click', () => _applyTemplate(b.dataset.tpl)));
  _renderCondParams();
  _syncFormVisibility();
  loadBots();
}

function _renderCondParams() {
  const cond = document.getElementById('bot-cond')?.value;
  const el = document.getElementById('bot-cond-params');
  if (!el) return;
  let html = '';
  if (NEEDS_RSI.has(cond)) html += fld('bot-rsiperiod', 'RSI periodas', '14', 'type="number"') + fld('bot-value', 'Reikšmė', '30', 'type="number" step="any"');
  else if (NEEDS_MA.has(cond)) html += fld('bot-fast', 'Greitas', '9', 'type="number"') + fld('bot-slow', 'Lėtas', '21', 'type="number"');
  else if (NEEDS_VALUE.has(cond)) html += fld('bot-value', 'Reikšmė', '-5', 'type="number" step="any"');
  el.innerHTML = html;
}

function _syncFormVisibility() {
  const type = document.getElementById('bot-type')?.value;
  const side = document.getElementById('bot-side')?.value;
  const sizing = document.getElementById('bot-sizing')?.value;
  const isSignal = type === 'signal';
  document.getElementById('bot-cond-block').style.display = isSignal ? 'grid' : 'none';
  document.getElementById('bot-trigger-wrap').style.visibility = isSignal ? 'visible' : 'hidden';
  document.getElementById('bot-bracket-block').style.display = side === 'buy' ? 'block' : 'none';
  document.getElementById('bot-sellpct-wrap').style.display = side === 'sell' ? 'block' : 'none';
  const amtLabel = document.querySelector('#bot-amount')?.previousElementSibling;
  if (amtLabel) amtLabel.textContent = sizing === 'pctCash' ? 'Dydis (% lėšų)' : 'Suma (USDT)';
}

function _applyTemplate(name) {
  const t = TEMPLATES[name];
  if (!t) return;
  _editingId = null;
  const set = (id, v) => { const e = document.getElementById(id); if (e != null && v != null) e.value = v; };
  set('bot-name', name);
  set('bot-symbol', t.symbol);
  set('bot-type', t.botType);
  if (t.conditionType) set('bot-cond', t.conditionType);
  set('bot-side', t.side);
  _syncFormVisibility(); _renderCondParams();
  // fill cond params after they render
  if (t.conditionValue != null) set('bot-value', t.conditionValue);
  if (t.rsiPeriod != null) set('bot-rsiperiod', t.rsiPeriod);
  if (t.fast != null) set('bot-fast', t.fast);
  if (t.slow != null) set('bot-slow', t.slow);
  set('bot-amount', t.quoteAmount ?? 500);
  set('bot-tp', t.takeProfit ?? 0);
  set('bot-sl', t.stopLoss ?? 0);
  set('bot-trail', t.trailingStop ?? 0);
  set('bot-maxalloc', t.maxAllocation ?? 0);
  set('bot-cooldown', t.cooldownMin ?? 30);
  set('bot-sent-max', t.sentimentMax ?? '');
  showToast(`Šablonas „${name}" užkrautas`, 'info');
}

async function _parseAI() {
  const input = document.getElementById('bot-ai-input');
  const btn = document.getElementById('bot-ai-parse');
  if (!input || !btn) return;
  const text = input.value.trim();
  if (!text) return showToast('Įklijuokite kodą!', 'warning');
  
  btn.disabled = true;
  btn.textContent = 'Analizuojama...';
  
  try {
    const res = await Api.parseBotSetup(text);
    if (res.ok && res.setup) {
      _applyTemplate(res.setup);
      // Priverstinai atnaujinti dropdownų pasirinkimus ir inputus nes _applyTemplate vadina jas "name", o ne object
      // wait, we should modify _applyTemplate to accept objects as well or just fill here.
      // I will fill here to avoid breaking _applyTemplate
      const s = res.setup;
      const set = (id, v) => { const e = document.getElementById(id); if (e != null && v != null) e.value = v; };
      set('bot-name', s.name || 'AI sugeneruotas botas');
      set('bot-symbol', s.symbol || 'BTCUSDT');
      set('bot-type', s.botType || 'signal');
      if (s.triggerMode) set('bot-trigger', s.triggerMode);
      if (s.conditionType) set('bot-cond', s.conditionType);
      set('bot-side', s.side || 'buy');
      if (s.sizingMode) set('bot-sizing', s.sizingMode);
      _syncFormVisibility(); _renderCondParams();
      
      set('bot-value', s.conditionValue);
      set('bot-rsiperiod', s.rsiPeriod);
      set('bot-fast', s.fast);
      set('bot-slow', s.slow);
      set('bot-amount', s.quoteAmount ?? 500);
      set('bot-tp', s.takeProfit ?? 0);
      set('bot-sl', s.stopLoss ?? 0);
      set('bot-trail', s.trailingStop ?? 0);
      set('bot-maxalloc', s.maxAllocation ?? 0);
      set('bot-cooldown', s.cooldownMin ?? 30);
      
      showToast('Forma užpildyta pagal jūsų kodą!', 'success');
      document.querySelector('#bot-form-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Išanalizuoti ir užpildyti';
  }
}

function _readForm() {
  const v = (id) => document.getElementById(id)?.value;
  const n = (id) => { const x = v(id); return x === '' || x == null ? null : Number(x); };
  const type = v('bot-type');
  const expiryDays = n('bot-expiry') || 0;
  return {
    name: v('bot-name')?.trim(),
    symbol: v('bot-symbol'),
    botType: type,
    triggerMode: v('bot-trigger'),
    conditionType: v('bot-cond'),
    conditionValue: n('bot-value'),
    rsiPeriod: n('bot-rsiperiod') ?? 14,
    fast: n('bot-fast') ?? 9,
    slow: n('bot-slow') ?? 21,
    side: v('bot-side'),
    sizingMode: v('bot-sizing'),
    quoteAmount: n('bot-amount') ?? 500,
    sellPct: n('bot-sellpct') ?? 100,
    takeProfit: n('bot-tp') ?? 0,
    stopLoss: n('bot-sl') ?? 0,
    trailingStop: n('bot-trail') ?? 0,
    maxAllocation: n('bot-maxalloc') ?? 0,
    cooldownMin: n('bot-cooldown') ?? 30,
    maxTriggers: n('bot-maxtrig') ?? 0,
    expiresAt: expiryDays > 0 ? Date.now() + expiryDays * 86400000 : null,
    sentimentMin: n('bot-sent-min'),
    sentimentMax: n('bot-sent-max'),
  };
}

async function _submit() {
  const body = _readForm();
  try {
    if (_editingId) {
      await Api.updateBot(_editingId, { edit: true, ...body });
      showToast('Botas atnaujintas', 'success');
      _cancelEdit();
    } else {
      await Api.createBot(body);
      showToast('Botas sukurtas', 'success');
      document.getElementById('bot-name').value = '';
    }
    loadBots();
  } catch (err) { showToast(err.message, 'error'); }
}

function _startEdit(bot) {
  _editingId = bot.id;
  const set = (id, val) => { const e = document.getElementById(id); if (e != null && val != null) e.value = val; };
  set('bot-name', bot.name); set('bot-symbol', bot.symbol); set('bot-type', bot.botType);
  set('bot-trigger', bot.triggerMode); set('bot-cond', bot.conditionType); set('bot-side', bot.side);
  set('bot-sizing', bot.sizingMode);
  _syncFormVisibility(); _renderCondParams();
  set('bot-value', bot.conditionValue); set('bot-rsiperiod', bot.rsiPeriod);
  set('bot-fast', bot.fast); set('bot-slow', bot.slow);
  set('bot-amount', bot.quoteAmount); set('bot-sellpct', bot.sellPct);
  set('bot-tp', bot.takeProfit); set('bot-sl', bot.stopLoss); set('bot-trail', bot.trailingStop);
  set('bot-maxalloc', bot.maxAllocation); set('bot-cooldown', bot.cooldownMin); set('bot-maxtrig', bot.maxTriggers);
  set('bot-sent-min', bot.sentimentMin ?? ''); set('bot-sent-max', bot.sentimentMax ?? '');
  document.getElementById('bot-form-title').textContent = `Redaguojamas: ${bot.name}`;
  document.getElementById('bot-create').textContent = '✓ Atnaujinti botą';
  document.getElementById('bot-cancel-edit').style.display = 'block';
  document.querySelector('#bots-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function _cancelEdit() {
  _editingId = null;
  document.getElementById('bot-form-title').textContent = 'Naujas botas';
  document.getElementById('bot-create').textContent = '+ Sukurti botą';
  document.getElementById('bot-cancel-edit').style.display = 'none';
}

async function _setAll(enabled) {
  try { await Api.setAllBots(enabled); showToast(enabled ? 'Visi botai įjungti' : 'Visi botai sustabdyti', 'info'); loadBots(); }
  catch (err) { showToast(err.message, 'error'); }
}

export async function loadBots() {
  try {
    const res = await Api.getBots();
    _bots = res.bots || [];
    _prices = res.prices || {};
    _paint();
  } catch (err) { showToast(`Botai: ${err.message}`, 'error'); }
}

function _condText(b) {
  if (b.botType === 'dca') return `DCA: pirk $${b.quoteAmount} kas ${b.cooldownMin}min`;
  const label = CONDITIONS[b.conditionType] || b.conditionType;
  if (NEEDS_MA.has(b.conditionType)) return `${label} (${b.fast}/${b.slow})`;
  if (NEEDS_RSI.has(b.conditionType)) return `${label} ${b.conditionValue} (RSI${b.rsiPeriod})`;
  return `${label} ${b.conditionValue}`;
}

function _distance(b) {
  const p = _prices[b.symbol];
  if (!p || b.botType === 'dca') return null;
  const px = p.price, ch = p.change;
  let prog = null, now = '', target = '';
  if (b.conditionType === 'price_below') { prog = Math.min(1, b.conditionValue / px); now = `$${_fmt(px)}`; target = `$${_fmt(b.conditionValue)}`; }
  else if (b.conditionType === 'price_above') { prog = Math.min(1, px / b.conditionValue); now = `$${_fmt(px)}`; target = `$${_fmt(b.conditionValue)}`; }
  else if (b.conditionType === 'change_below') { prog = ch <= b.conditionValue ? 1 : Math.max(0, 1 - (ch - b.conditionValue) / Math.max(Math.abs(b.conditionValue), 1)); now = `${ch.toFixed(2)}%`; target = `${b.conditionValue}%`; }
  else if (b.conditionType === 'change_above') { prog = ch >= b.conditionValue ? 1 : Math.max(0, ch / Math.max(b.conditionValue, 0.1)); now = `${ch.toFixed(2)}%`; target = `${b.conditionValue}%`; }
  if (prog == null) return null;
  return { prog: Math.max(0, Math.min(1, prog)), now, target };
}

function _paint() {
  const el = document.getElementById('bots-list');
  if (!el) return;
  if (!_bots.length) {
    el.innerHTML = `<div class="card" style="padding:var(--space-5);text-align:center;color:var(--text-muted);font-size:var(--text-sm);">Dar nėra botų. Naudok šabloną arba sukurk viršuje.</div>`;
    return;
  }
  el.innerHTML = _bots.map(b => {
    const sentGate = (b.sentimentMin != null || b.sentimentMax != null) ? `<span class="badge badge--info" style="font-size:8px;">F&amp;G ${b.sentimentMin ?? 0}–${b.sentimentMax ?? 100}</span>` : '';
    const brackets = [];
    if (b.takeProfit > 0) brackets.push(`TP ${b.takeProfit}%`);
    if (b.stopLoss > 0) brackets.push(`SL ${b.stopLoss}%`);
    if (b.trailingStop > 0) brackets.push(`Trail ${b.trailingStop}%`);
    const d = _distance(b);
    const inPos = b.managedPos ? `<span class="badge badge--warning" style="font-size:8px;">pozicijoje @$${_fmt(b.managedPos.entryPrice)}</span>` : '';
    const budget = b.maxAllocation > 0 ? ` · $${b.deployed.toFixed(0)}/$${b.maxAllocation}` : '';
    const trigCap = b.maxTriggers > 0 ? `/${b.maxTriggers}` : '';
    return `
    <div class="card" style="padding:var(--space-3) var(--space-4);margin-bottom:var(--space-2);${b.enabled ? '' : 'opacity:.55;'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3);">
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:var(--text-sm);">${_esc(b.name)}</span>
            <span class="badge badge--${b.side === 'buy' ? 'success' : 'error'}" style="font-size:8px;">${b.side.toUpperCase()}</span>
            <span class="badge" style="font-size:8px;background:var(--bg-body);border:1px solid var(--border-default);">${b.botType === 'dca' ? 'DCA' : (b.triggerMode === 'once' ? 'EDGE' : 'LEVEL')}</span>
            ${brackets.length ? `<span class="badge badge--info" style="font-size:8px;">${brackets.join(' · ')}</span>` : ''}
            ${sentGate}${inPos}
            ${b.enabled ? '<span style="font-size:8px;color:var(--success);">● aktyvus</span>' : '<span style="font-size:8px;color:var(--text-muted);">○ sustabdytas</span>'}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px;font-family:var(--font-mono);">
            ${b.symbol} · ${_esc(_condText(b))} → ${b.side} ${b.sizingMode === 'pctCash' ? b.quoteAmount + '% lėšų' : '$' + b.quoteAmount} · ${b.triggerCount}${trigCap}× suveikė${budget}
          </div>
          ${d ? `
            <div style="margin-top:5px;display:flex;align-items:center;gap:8px;">
              <div style="flex:1;max-width:240px;height:5px;background:var(--bg-body);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${Math.round(d.prog * 100)}%;background:${d.prog >= 1 ? 'var(--success)' : 'var(--trading-accent)'};"></div>
              </div>
              <span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">${d.now} → ${d.target}</span>
            </div>` : ''}
          ${b.log?.length ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono);opacity:.8;">↳ ${_esc(b.log[0].message)} <span style="opacity:.6;">(${_ago(b.log[0].ts)})</span></div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn--ghost btn--sm" data-toggle="${b.id}" style="font-size:10px;">${b.enabled ? '⏸' : '▶'}</button>
          <button class="btn btn--ghost btn--sm" data-edit="${b.id}" style="font-size:10px;">✎</button>
          <button class="btn btn--ghost btn--sm" data-del="${b.id}" style="font-size:10px;color:var(--error);">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const bot = _bots.find(x => x.id === btn.dataset.toggle);
    await Api.updateBot(btn.dataset.toggle, { enabled: !bot.enabled }); loadBots();
  }));
  el.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
    const bot = _bots.find(x => x.id === btn.dataset.edit); if (bot) _startEdit(bot);
  }));
  el.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Ištrinti šį botą?')) return;
    await Api.deleteBot(btn.dataset.del); loadBots();
  }));
}

function _fmt(n) { n = Number(n) || 0; return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toFixed(5); }
function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _ago(ts) { if (!ts) return ''; const s = Math.round((Date.now() - ts) / 1000); if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}min`; return `${Math.floor(s / 3600)}h`; }
