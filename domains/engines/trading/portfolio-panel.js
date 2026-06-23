// ═══════════════════════════════════════════════════
// DOMAIN: Trading — Paper Trading Portfolio panel
// ═══════════════════════════════════════════════════
//
// Virtual $10k account. Place market/limit buy/sell orders against live prices,
// see open positions marked-to-market (unrealized PnL), pending limit orders and
// the trade history. All paper — no real money moves.

import * as Api from '../../../core/api-client.js';
import { showToast } from '../../../components/toast.js';

let _pf = null;
let _busy = false;

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'DOTUSDT'];

export function renderPortfolioPanel() {
  return `
    <div style="padding:var(--space-4);max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
        <div>
          <h3 style="margin:0;font-size:var(--text-lg);">Paper Trading portfelis</h3>
          <p style="margin:2px 0 0;font-size:var(--text-xs);color:var(--text-muted);">Virtualus $10,000 balansas · realios Binance kainos · jokios tikros prekybos</p>
        </div>
        <button class="btn btn--ghost btn--sm" id="pf-reset" style="color:var(--error);">↺ Atstatyti $10k</button>
      </div>

      <div id="pf-summary" style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3);margin-bottom:var(--space-4);">
        ${_skel(4)}
      </div>

      <div style="display:grid;grid-template-columns:1fr 320px;gap:var(--space-4);align-items:start;">
        <div style="display:flex;flex-direction:column;gap:var(--space-4);">
          <div class="card" style="padding:0;">
            <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);">Atviros pozicijos</div>
            <div id="pf-positions">${_skelRows(2)}</div>
          </div>
          <div class="card" style="padding:0;">
            <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);">Laukiantys limit orderiai</div>
            <div id="pf-pending"><div style="padding:var(--space-3);font-size:11px;color:var(--text-muted);">—</div></div>
          </div>
          <div class="card" style="padding:0;">
            <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);">Sandorių istorija</div>
            <div id="pf-trades" style="max-height:240px;overflow-y:auto;">${_skelRows(3)}</div>
          </div>
        </div>

        <!-- Order ticket -->
        <div class="card" style="padding:var(--space-4);position:sticky;top:var(--space-4);background:rgba(20,20,20,0.5);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.05);box-shadow:0 8px 32px rgba(0,0,0,0.3);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
            <div style="font-size:var(--text-sm);font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:6px;">
              <span style="color:var(--accent);">⚡</span> Naujas Orderis
            </div>
            <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">PAPER TRADE</div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-bottom:var(--space-3);">
            <div>
              <label style="display:block;font-size:10px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;">Pora</label>
              <select id="ord-symbol" style="width:100%;padding:var(--space-2);background:rgba(0,0,0,0.2);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-family:var(--font-mono);font-size:var(--text-xs);transition:border-color 0.2s;">
                ${PAIRS.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="display:block;font-size:10px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;">Tipas</label>
              <select id="ord-type" style="width:100%;padding:var(--space-2);background:rgba(0,0,0,0.2);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);transition:border-color 0.2s;">
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
            </div>
          </div>

          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);padding:4px;background:rgba(0,0,0,0.2);border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,0.02);">
            <button class="btn" id="ord-buy" data-side="buy" style="flex:1;background:var(--success);color:#fff;border:none;font-weight:600;letter-spacing:1px;height:36px;transition:all 0.2s;box-shadow:0 0 10px rgba(34,197,94,0.2);">PIRKTI</button>
            <button class="btn" id="ord-sell" data-side="sell" style="flex:1;background:transparent;color:var(--text-muted);border:none;font-weight:600;letter-spacing:1px;height:36px;transition:all 0.2s;">PARDUOTI</button>
          </div>

          <div id="ord-limit-row" style="display:none;margin-bottom:var(--space-3);">
            <label style="display:block;font-size:10px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;">Limit Kaina ($)</label>
            <input id="ord-limit-price" type="number" step="any" placeholder="0.00"
              style="width:100%;box-sizing:border-box;padding:8px 12px;background:rgba(0,0,0,0.2);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-family:var(--font-mono);font-size:var(--text-sm);transition:border-color 0.2s;">
          </div>

          <div style="margin-bottom:var(--space-4);">
            <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4px;">
              <label style="display:block;font-size:10px;color:var(--text-muted);text-transform:uppercase;">Suma (USDT)</label>
              <div style="display:flex;gap:4px;">
                ${[100, 500, 1000].map(v => `<button class="btn btn--ghost btn--sm" data-amt="${v}" style="font-size:9px;padding:2px 6px;height:20px;min-height:20px;">$${v}</button>`).join('')}
              </div>
            </div>
            <input id="ord-amount" type="number" step="any" value="500" placeholder="USDT"
              style="width:100%;box-sizing:border-box;padding:8px 12px;background:rgba(0,0,0,0.2);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-family:var(--font-mono);font-size:var(--text-sm);font-weight:700;">
          </div>

          <!-- SETUP INFO SECTION -->
          <div style="border-top:1px dashed var(--border-default);padding-top:var(--space-3);margin-bottom:var(--space-4);">
            <div style="font-size:10px;font-weight:700;color:var(--text-secondary);margin-bottom:var(--space-3);display:flex;align-items:center;gap:6px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Prekybos Parametrai (Setup)
            </div>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-bottom:var(--space-3);">
              <div>
                <label style="display:block;font-size:10px;color:var(--success);margin-bottom:4px;">Take Profit ($)</label>
                <input id="ord-tp" type="number" step="any" placeholder="Neprivaloma"
                  style="width:100%;box-sizing:border-box;padding:6px;background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);border-radius:var(--radius-sm);color:var(--success);font-family:var(--font-mono);font-size:var(--text-xs);">
              </div>
              <div>
                <label style="display:block;font-size:10px;color:var(--error);margin-bottom:4px;">Stop Loss ($)</label>
                <input id="ord-sl" type="number" step="any" placeholder="Neprivaloma"
                  style="width:100%;box-sizing:border-box;padding:6px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);color:var(--error);font-family:var(--font-mono);font-size:var(--text-xs);">
              </div>
            </div>
            
            <div style="margin-bottom:var(--space-3);">
              <label style="display:block;font-size:10px;color:var(--text-muted);margin-bottom:4px;">Setup Notes / Strategija</label>
              <input id="ord-notes" type="text" placeholder="Pvz., Atšokimas nuo 200 EMA"
                style="width:100%;box-sizing:border-box;padding:6px 8px;background:rgba(0,0,0,0.2);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-secondary);font-size:11px;">
            </div>

            <!-- Risk/Reward Indicator -->
            <div id="ord-rr-container" style="display:none;padding:8px;background:rgba(0,0,0,0.3);border-radius:var(--radius-sm);font-size:11px;font-family:var(--font-mono);color:var(--text-secondary);">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span>Risk/Reward:</span>
                <span id="ord-rr-value" style="font-weight:700;">-</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:9px;">
                <span style="color:var(--error);">Rizika: <span id="ord-risk-amt">-</span></span>
                <span style="color:var(--success);">Pelnas: <span id="ord-reward-amt">-</span></span>
              </div>
            </div>
          </div>

          <button class="btn btn--primary" id="ord-submit" style="width:100%;height:40px;font-size:var(--text-sm);font-weight:700;letter-spacing:0.5px;box-shadow:0 4px 12px rgba(var(--accent-rgb),0.3);transition:all 0.2s;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:text-bottom;display:inline-block;"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            VYKDYTI ORDERĮ
          </button>
          <div id="ord-msg" style="margin-top:var(--space-2);font-size:11px;min-height:14px;text-align:center;"></div>
        </div>
      </div>
    </div>
  `;
}

let _side = 'buy';

export async function initPortfolioPanel() {
  document.getElementById('ord-type')?.addEventListener('change', (e) => {
    document.getElementById('ord-limit-row').style.display = e.target.value === 'limit' ? 'block' : 'none';
  });
  const setSide = (s) => {
    _side = s;
    const buy = document.getElementById('ord-buy'), sell = document.getElementById('ord-sell');
    if (buy && sell) {
      if (s === 'buy') {
        buy.style.background = 'var(--success)';
        buy.style.color = '#fff';
        buy.style.boxShadow = '0 0 10px rgba(34,197,94,0.2)';
        sell.style.background = 'transparent';
        sell.style.color = 'var(--text-muted)';
        sell.style.boxShadow = 'none';
      } else {
        sell.style.background = 'var(--error)';
        sell.style.color = '#fff';
        sell.style.boxShadow = '0 0 10px rgba(239,68,68,0.2)';
        buy.style.background = 'transparent';
        buy.style.color = 'var(--text-muted)';
        buy.style.boxShadow = 'none';
      }
    }
    _calcRR();
  };

  const _calcRR = () => {
    const tp = parseFloat(document.getElementById('ord-tp')?.value);
    const sl = parseFloat(document.getElementById('ord-sl')?.value);
    const amount = parseFloat(document.getElementById('ord-amount')?.value) || 0;
    const isLimit = document.getElementById('ord-type')?.value === 'limit';
    
    let entryPrice = 0;
    if (isLimit) {
      entryPrice = parseFloat(document.getElementById('ord-limit-price')?.value);
    }

    const rrContainer = document.getElementById('ord-rr-container');
    if (!tp || !sl) {
      if(rrContainer) rrContainer.style.display = 'none';
      return;
    }

    if (rrContainer) rrContainer.style.display = 'block';

    if (entryPrice > 0) {
      const riskPerCoin = _side === 'buy' ? entryPrice - sl : sl - entryPrice;
      const rewardPerCoin = _side === 'buy' ? tp - entryPrice : entryPrice - tp;
      
      const qty = amount / entryPrice;
      const totalRisk = riskPerCoin * qty;
      const totalReward = rewardPerCoin * qty;

      let rrValue = '-';
      if (riskPerCoin > 0 && rewardPerCoin > 0) {
        rrValue = (rewardPerCoin / riskPerCoin).toFixed(2);
      }
      
      document.getElementById('ord-rr-value').textContent = rrValue !== '-' ? `1 : ${rrValue}` : 'Neteisingas TP/SL';
      document.getElementById('ord-risk-amt').textContent = totalRisk > 0 ? `$${totalRisk.toFixed(2)}` : '-';
      document.getElementById('ord-reward-amt').textContent = totalReward > 0 ? `$${totalReward.toFixed(2)}` : '-';
    } else {
       document.getElementById('ord-rr-value').textContent = "Paskaičiuojama Limit orderiams";
       document.getElementById('ord-risk-amt').textContent = '-';
       document.getElementById('ord-reward-amt').textContent = '-';
    }
  };

  ['ord-tp', 'ord-sl', 'ord-amount', 'ord-limit-price', 'ord-type'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _calcRR);
    document.getElementById(id)?.addEventListener('change', _calcRR);
  });

  document.getElementById('ord-buy')?.addEventListener('click', () => setSide('buy'));
  document.getElementById('ord-sell')?.addEventListener('click', () => setSide('sell'));
  document.querySelectorAll('[data-amt]').forEach(b =>
    b.addEventListener('click', () => { document.getElementById('ord-amount').value = b.dataset.amt; }));
  document.getElementById('ord-submit')?.addEventListener('click', _submitOrder);
  document.getElementById('pf-reset')?.addEventListener('click', async () => {
    if (!confirm('Atstatyti portfelį į $10,000? Visos pozicijos ir istorija bus ištrintos.')) return;
    await Api.resetPortfolio();
    showToast('Portfelis atstatytas', 'success');
    loadPortfolio();
  });
  setSide('buy');
  loadPortfolio();
}

export async function loadPortfolio() {
  try {
    _pf = await Api.getPortfolio();
    _paint();
  } catch (err) {
    showToast(`Portfelis: ${err.message}`, 'error');
  }
}

async function _submitOrder() {
  if (_busy) return;
  const symbol = document.getElementById('ord-symbol').value;
  const type = document.getElementById('ord-type').value;
  const amount = parseFloat(document.getElementById('ord-amount').value);
  const msg = document.getElementById('ord-msg');
  if (!(amount > 0)) { if (msg) { msg.style.color = 'var(--error)'; msg.textContent = 'Įveskite sumą'; } return; }

  const tp = document.getElementById('ord-tp')?.value;
  const sl = document.getElementById('ord-sl')?.value;
  const notes = document.getElementById('ord-notes')?.value;

  const body = { symbol, side: _side, type, quoteAmount: amount };
  if (type === 'limit') {
    const lp = parseFloat(document.getElementById('ord-limit-price').value);
    if (!(lp > 0)) { if (msg) { msg.style.color = 'var(--error)'; msg.textContent = 'Įveskite limit kainą'; } return; }
    body.limitPrice = lp;
  }
  
  if (tp) body.takeProfit = parseFloat(tp);
  if (sl) body.stopLoss = parseFloat(sl);
  if (notes) body.notes = notes;

  _busy = true;
  const btn = document.getElementById('ord-submit');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await Api.placeOrder(body);
    if (msg) {
      msg.style.color = 'var(--success)';
      msg.textContent = res.pending ? 'Limit orderis pateiktas (laukia)' : `Įvykdyta: ${_side} ${symbol}`;
    }
    showToast(res.pending ? 'Limit orderis pateiktas' : `Orderis įvykdytas: ${_side.toUpperCase()} ${symbol}`, 'success');
    loadPortfolio();
  } catch (err) {
    if (msg) { msg.style.color = 'var(--error)'; msg.textContent = err.message; }
    showToast(err.message, 'error');
  } finally {
    _busy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Vykdyti orderį'; }
  }
}

// ─── Paint ────────────────────────────────────────
function _paint() {
  if (!_pf) return;
  const sumEl = document.getElementById('pf-summary');
  const pnlColor = _pf.totalPnl >= 0 ? 'var(--success)' : 'var(--error)';
  if (sumEl) sumEl.innerHTML = `
    ${_statCard('Equity (viso)', '$' + _fmt(_pf.equity), 'var(--text-primary)')}
    ${_statCard('Laisvos lėšos', '$' + _fmt(_pf.cash), 'var(--text-primary)')}
    ${_statCard('Bendras P&L', (_pf.totalPnl >= 0 ? '+' : '') + '$' + _fmt(_pf.totalPnl) + ` (${_pf.totalPnlPct >= 0 ? '+' : ''}${_pf.totalPnlPct}%)`, pnlColor)}
    ${_statCard('Realiz. / Nerealiz.', '$' + _fmt(_pf.realizedPnl) + ' / $' + _fmt(_pf.unrealizedPnl), 'var(--text-secondary)')}
  `;

  const posEl = document.getElementById('pf-positions');
  if (posEl) {
    posEl.innerHTML = _pf.positions.length ? `
      <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr auto;gap:var(--space-2);padding:10px var(--space-4);font-size:9px;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border-default);background:rgba(255,255,255,0.02);">
        <span>Pora</span><span>Kiekis</span><span>Vid. kaina</span><span>P&L</span><span></span>
      </div>
      ${_pf.positions.map(p => {
        const c = p.unrealizedPnl >= 0 ? 'var(--success)' : 'var(--error)';
        const bg = p.unrealizedPnl >= 0 ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)';
        
        let setupHtml = '';
        if (p.takeProfit || p.stopLoss || p.notes) {
          setupHtml = `<div style="grid-column:1/-1;margin-top:8px;padding:8px 12px;background:rgba(0,0,0,0.2);border-radius:4px;display:flex;gap:12px;font-size:10px;">
            ${p.takeProfit ? `<span style="color:var(--success);font-weight:600;">TP: $${_fmt(p.takeProfit)}</span>` : ''}
            ${p.stopLoss ? `<span style="color:var(--error);font-weight:600;">SL: $${_fmt(p.stopLoss)}</span>` : ''}
            ${p.notes ? `<span style="color:var(--text-muted);margin-left:auto;font-family:var(--font-sans);">📝 ${p.notes}</span>` : ''}
          </div>`;
        }

        return `
        <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);background:${bg};transition:background 0.2s;cursor:default;">
          <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr auto;gap:var(--space-2);align-items:center;font-size:12px;font-family:var(--font-mono);">
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;">${p.symbol.charAt(0)}</div>
              <span style="font-weight:700;color:var(--text-primary);">${p.symbol.replace('USDT', '')}</span>
            </div>
            <span>${_fmtQty(p.qty)}</span>
            <span>$${_fmt(p.avgPrice)}</span>
            <span style="color:${c};font-weight:600;text-shadow:0 0 10px ${c}40;">${p.unrealizedPnl >= 0 ? '+' : ''}$${_fmt(p.unrealizedPnl)} (${p.unrealizedPct}%)</span>
            <button class="btn btn--ghost btn--sm" data-sell="${p.symbol}" style="font-size:10px;padding:4px 12px;color:var(--error);background:rgba(239,68,68,0.1);border-radius:4px;transition:all 0.2s;">Uždaryti</button>
          </div>
          ${setupHtml}
        </div>`;
      }).join('')}
    ` : `<div style="padding:var(--space-4);font-size:11px;color:var(--text-muted);text-align:center;">Nėra atvirų pozicijų. Pirk porą dešinėje.</div>`;
    posEl.querySelectorAll('[data-sell]').forEach(b =>
      b.addEventListener('click', () => _closePosition(b.dataset.sell)));
  }

  const pendEl = document.getElementById('pf-pending');
  if (pendEl) {
    pendEl.innerHTML = _pf.pendingOrders.length ? _pf.pendingOrders.map(o => `
      <div style="padding:10px var(--space-4);border-bottom:1px solid var(--border-default);font-family:var(--font-mono);transition:background 0.2s;" class="hover-bg-card">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="padding:2px 6px;border-radius:3px;background:${o.side === 'buy' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'};color:${o.side === 'buy' ? 'var(--success)' : 'var(--error)'};font-weight:700;font-size:9px;">${o.side.toUpperCase()}</span>
            <span style="color:var(--text-primary);font-weight:600;">${o.symbol.replace('USDT', '')}</span>
            <span style="color:var(--text-secondary);">@ $${_fmt(o.limitPrice)}</span>
          </div>
          <button class="btn btn--ghost btn--sm" data-cancel="${o.id}" style="font-size:9px;padding:4px 8px;border:1px solid rgba(255,255,255,0.1);border-radius:4px;transition:all 0.2s;">✕ Atšaukti</button>
        </div>
        ${o.takeProfit || o.stopLoss || o.notes ? `
        <div style="margin-top:8px;padding:6px 10px;background:rgba(0,0,0,0.15);border-radius:4px;display:flex;gap:12px;font-size:9px;color:var(--text-muted);">
          ${o.takeProfit ? `<span style="color:var(--success);">TP: $${_fmt(o.takeProfit)}</span>` : ''}
          ${o.stopLoss ? `<span style="color:var(--error);">SL: $${_fmt(o.stopLoss)}</span>` : ''}
          ${o.notes ? `<span style="margin-left:auto;font-family:var(--font-sans);">📝 ${o.notes}</span>` : ''}
        </div>` : ''}
      </div>`).join('') : `<div style="padding:var(--space-4);font-size:11px;color:var(--text-muted);text-align:center;">Nėra laukiančių orderių</div>`;
    pendEl.querySelectorAll('[data-cancel]').forEach(b =>
      b.addEventListener('click', async () => { await Api.cancelOrder(b.dataset.cancel); loadPortfolio(); }));
  }

  const trEl = document.getElementById('pf-trades');
  if (trEl) {
    trEl.innerHTML = _pf.trades.length ? _pf.trades.map(t => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px var(--space-4);border-bottom:1px solid var(--border-default);font-size:11px;font-family:var(--font-mono);">
        <span><span style="color:${t.side === 'buy' ? 'var(--success)' : 'var(--error)'};font-weight:700;">${t.side.toUpperCase()}</span> ${t.symbol.replace('USDT', '')}</span>
        <span style="color:var(--text-muted);">${_fmtQty(t.qty)} @ $${_fmt(t.price)}</span>
        <span>$${_fmt(t.value)}</span>
      </div>`).join('') : `<div style="padding:var(--space-4);font-size:11px;color:var(--text-muted);text-align:center;">Dar nėra sandorių</div>`;
  }
}

async function _closePosition(symbol) {
  const p = _pf?.positions.find(x => x.symbol === symbol);
  if (!p) return;
  if (!confirm(`Uždaryti visą ${symbol} poziciją (${_fmtQty(p.qty)})?`)) return;
  try {
    await Api.placeOrder({ symbol, side: 'sell', type: 'market', qty: p.qty });
    showToast(`Pozicija uždaryta: ${symbol}`, 'success');
    loadPortfolio();
  } catch (err) { showToast(err.message, 'error'); }
}

// ─── Helpers ──────────────────────────────────────
function _statCard(label, value, color) {
  return `<div class="card" style="padding:var(--space-3);">
    <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">${label}</div>
    <div style="font-size:var(--text-md);font-weight:700;font-family:var(--font-mono);color:${color};margin-top:4px;word-break:break-all;">${value}</div>
  </div>`;
}
function _fmt(n) { n = Number(n) || 0; return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _fmtQty(n) { n = Number(n) || 0; return n < 1 ? n.toFixed(6) : n.toFixed(4); }
function _skel(n) { return Array.from({ length: n }, () => `<div class="card" style="padding:var(--space-3);opacity:.4;"><div style="height:40px;background:var(--bg-body);border-radius:4px;"></div></div>`).join(''); }
function _skelRows(n) { return Array.from({ length: n }, () => `<div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);"><div style="height:20px;background:var(--bg-body);border-radius:4px;opacity:.4;"></div></div>`).join(''); }
