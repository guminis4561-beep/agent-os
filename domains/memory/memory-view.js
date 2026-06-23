// ═══════════════════════════════════════════════════
// DOMAIN: Memory Browser — real data from /api/memory
// ═══════════════════════════════════════════════════

import EventBus from '../../core/events.js';
import { showToast } from '../../components/toast.js';
import * as Api from '../../core/api-client.js';

const LAYERS = ['workspace', 'session', 'global', 'identity'];

const LAYER_META = {
  workspace: { icon: '📁', label: 'Workspace',  desc: 'Projekto užduočių rezultatai ir failų pakeitimai' },
  session:   { icon: '⚡', label: 'Session',    desc: 'Dabartinio vykdymo kontekstas (trumpalaikis)' },
  global:    { icon: '🌐', label: 'Global',     desc: 'Tarpworkspace žinios ir šablonai' },
  identity:  { icon: '🧠', label: 'Identity',   desc: 'Nuolatinė vartotojo konteksto atmintis' },
};

let _activeLayer = 'workspace';
let _search = '';
let _data = {};   // { [layer]: items[] }
let _summary = {}; // { [layer]: count }
let _loading = false;
let _loadPromise = null;

// ─── Render (sinchroninis — duomenys užkraunami async po render) ─────────────

export function renderMemory() {
  const meta = LAYER_META[_activeLayer] || LAYER_META.workspace;
  const items = _filterItems(_data[_activeLayer] || []);
  const total = Object.values(_summary).reduce((s, n) => s + n, 0);

  return `
    <div>
      <div class="section-header">
        <div class="section-header__left">
          <div class="section-header__icon" style="background:rgba(108,92,231,0.12);">◉</div>
          <div>
            <h2 class="section-header__title">Memory Browser</h2>
            <p class="section-header__subtitle">Tikras atminties saugyklos naršymas</p>
          </div>
        </div>
        <div class="section-header__actions">
          <input type="text" id="memory-search-input" placeholder="⌕ Ieškoti..." value="${_search}"
            style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border-default);background:var(--bg-card);color:var(--text-primary);width:180px;">
          <button class="btn btn--ghost btn--sm" id="btn-memory-refresh">⟳ Atnaujinti</button>
        </div>
      </div>

      <!-- Layer kortelės -->
      <div class="memory-layers" style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3);margin-bottom:var(--space-5);">
        ${LAYERS.map(layer => {
          const m = LAYER_META[layer];
          const count = _summary[layer] ?? '…';
          const isActive = layer === _activeLayer;
          return `
            <div class="memory-layer-card ${isActive ? 'active' : ''}" data-layer="${layer}" style="cursor:pointer;padding:var(--space-4);border-radius:var(--radius-lg);border:1px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-default)'};background:${isActive ? 'rgba(79,142,247,0.08)' : 'var(--bg-card)'};text-align:center;">
              <div style="font-size:1.5rem;margin-bottom:var(--space-2);">${m.icon}</div>
              <div style="font-weight:600;font-size:var(--text-sm);color:var(--text-primary);margin-bottom:4px;">${m.label}</div>
              <div style="font-size:var(--text-2xl);font-weight:700;color:${isActive ? 'var(--accent-primary)' : 'var(--text-primary)'};">${count}</div>
              <div style="font-size:10px;color:var(--text-muted);">įrašų</div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Aktyvaus layer header -->
      <div class="card" style="margin-bottom:var(--space-4);padding:var(--space-3) var(--space-4);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600;">${meta.icon} ${meta.label}</div>
          <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px;">${meta.desc}</div>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          ${_loading ? `<span style="font-size:var(--text-xs);color:var(--text-muted);">Kraunama…</span>` : ''}
          <span class="badge badge--info" style="font-size:10px;">${items.length} ${_search ? 'rasta' : 'įrašų'}</span>
        </div>
      </div>

      <!-- Įrašai -->
      <div id="memory-entries-list">
        ${_renderEntries(items)}
      </div>

      <!-- Statistika -->
      <div style="margin-top:var(--space-6);display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-4);">
        <div class="card" style="text-align:center;padding:var(--space-4);">
          <div style="font-size:var(--text-2xl);font-weight:700;color:var(--accent-primary);">${total}</div>
          <div style="font-size:var(--text-sm);color:var(--text-muted);">Iš viso įrašų</div>
        </div>
        <div class="card" style="text-align:center;padding:var(--space-4);">
          <div style="font-size:var(--text-2xl);font-weight:700;color:var(--accent-secondary);">${LAYERS.length}</div>
          <div style="font-size:var(--text-sm);color:var(--text-muted);">Layer'ių</div>
        </div>
        <div class="card" style="text-align:center;padding:var(--space-4);">
          <div style="font-size:var(--text-2xl);font-weight:700;color:var(--success);">500</div>
          <div style="font-size:var(--text-sm);color:var(--text-muted);">Max / layer</div>
        </div>
      </div>
    </div>
  `;
}

function _renderEntries(items) {
  if (_loading && !items.length) {
    return Array.from({length: 3}, () => `
      <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);">
        <div style="height:40px;background:var(--bg-elevated);border-radius:var(--radius-md);opacity:.4;"></div>
      </div>
    `).join('');
  }

  if (!items.length) {
    return `
      <div class="card" style="padding:var(--space-8);text-align:center;">
        <div style="font-size:2rem;margin-bottom:var(--space-3);opacity:.4;">◉</div>
        <div style="color:var(--text-muted);font-size:var(--text-sm);">
          ${_search ? `Nerasta rezultatų pagal "${_search}"` : 'Šiame layer\'yje įrašų nėra. Įvykdyk užduotį ir rezultatai atsiras čia.'}
        </div>
      </div>
    `;
  }

  return `
    <div class="card" style="padding:0;overflow:hidden;">
      ${items.map((item, i) => {
        const isLast = i === items.length - 1;
        const val = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
        const preview = val.length > 120 ? val.slice(0, 120) + '…' : val;
        const time = item.ts ? new Date(item.ts).toLocaleString('lt-LT') : '—';
        const domain = item.meta?.domainEngine || '';
        const agent  = item.meta?.agent || '';

        return `
          <div class="memory-entry" data-id="${item.id}" style="display:flex;gap:var(--space-3);padding:var(--space-3) var(--space-4);${isLast ? '' : 'border-bottom:1px solid var(--border-default);'}cursor:pointer;">
            <div style="width:32px;height:32px;border-radius:var(--radius-md);background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;">
              ${LAYER_META[_activeLayer]?.icon || '📄'}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-2);">
                <div style="font-size:var(--text-sm);font-weight:600;color:var(--text-primary);word-break:break-word;">${_hl(item.key)}</div>
                <div style="display:flex;gap:4px;flex-shrink:0;">
                  ${domain ? `<span class="badge badge--info" style="font-size:9px;">${domain}</span>` : ''}
                  ${item.meta?.score != null ? `<span class="badge badge--success" style="font-size:9px;">${item.meta.score}</span>` : ''}
                </div>
              </div>
              <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px;line-height:1.5;word-break:break-word;">${_hl(preview)}</div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${time}${agent ? ' · ' + agent : ''}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ─── Events ──────────────────────────────────────

export function initMemoryEvents() {
  // Layer pasirinkimas
  document.querySelectorAll('.memory-layer-card[data-layer]').forEach(card => {
    card.addEventListener('click', () => {
      _activeLayer = card.dataset.layer;
      _search = '';
      EventBus.emit('navigate', 'memory');
    });
  });

  // Paieška — local filter (nereikia API kiekvienam klavišui)
  document.getElementById('memory-search-input')?.addEventListener('input', e => {
    _search = e.target.value;
    const list = document.getElementById('memory-entries-list');
    if (list) list.innerHTML = _renderEntries(_filterItems(_data[_activeLayer] || []));
    _reAttachEntryClicks();
  });

  // Atnaujinti
  document.getElementById('btn-memory-refresh')?.addEventListener('click', () => {
    _data = {};
    _summary = {};
    _loadAndPaint();
  });

  // Įrašo detalės (click)
  _reAttachEntryClicks();

  // Load only if no data yet and not already in flight
  if (!_loadPromise && Object.keys(_data).length === 0) {
    _loadAndPaint();
  }
}

function _reAttachEntryClicks() {
  document.querySelectorAll('.memory-entry[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const item = (_data[_activeLayer] || []).find(i => i.id === id);
      if (!item) return;
      const val = typeof item.value === 'string' ? item.value : JSON.stringify(item.value, null, 2);
      _showDetail(item.key, val, item);
    });
  });
}

// ─── Async load ───────────────────────────────────

function _loadAndPaint() {
  if (_loadPromise) return _loadPromise;
  _loading = true;
  _loadPromise = (async () => {
    const sumRes = await Api.getMemorySummary().catch(() => null);
    if (sumRes?.byLayer) _summary = sumRes.byLayer;

    const itemsRes = await Api.getMemory({ layer: _activeLayer, limit: 200 }).catch(() => null);
    _data[_activeLayer] = itemsRes?.items || [];
    _loading = false;

    _patchLayerCounts();
    const list = document.getElementById('memory-entries-list');
    if (list) {
      list.innerHTML = _renderEntries(_filterItems(_data[_activeLayer]));
      _reAttachEntryClicks();
    }
  })();
  _loadPromise.finally(() => { _loadPromise = null; });
  return _loadPromise;
}

function _patchLayerCounts() {
  LAYERS.forEach(layer => {
    const card = document.querySelector(`.memory-layer-card[data-layer="${layer}"]`);
    if (!card) return;
    const countEl = card.querySelector('div[style*="text-2xl"]');
    if (countEl) countEl.textContent = _summary[layer] ?? 0;
  });
}

// ─── Detail modal ─────────────────────────────────

function _showDetail(key, value, item) {
  const time = item.ts ? new Date(item.ts).toLocaleString('lt-LT') : '—';
  // Naudojame paprastą inline expand — nepriklauso nuo modal sistemos
  const existing = document.getElementById('mem-detail-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mem-detail-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:var(--space-6);';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border-radius:var(--radius-lg);border:1px solid var(--border-default);max-width:640px;width:100%;max-height:80vh;display:flex;flex-direction:column;">
      <div style="padding:var(--space-4);border-bottom:1px solid var(--border-default);display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:600;font-size:var(--text-md);word-break:break-word;">${key}</div>
        <button id="mem-detail-close" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;flex-shrink:0;">✕</button>
      </div>
      <div style="padding:var(--space-4);overflow-y:auto;flex:1;">
        <pre style="white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--text-primary);line-height:1.6;">${_escHtml(value)}</pre>
      </div>
      <div style="padding:var(--space-3) var(--space-4);border-top:1px solid var(--border-default);font-size:10px;color:var(--text-muted);display:flex;gap:var(--space-4);">
        <span>Layer: <b>${_activeLayer}</b></span>
        <span>ID: ${item.id}</span>
        <span>${time}</span>
        ${item.meta?.domainEngine ? `<span>Domain: ${item.meta.domainEngine}</span>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#mem-detail-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ─── Helpers ─────────────────────────────────────

function _filterItems(items) {
  if (!_search) return items;
  const q = _search.toLowerCase();
  return items.filter(i =>
    (i.key || '').toLowerCase().includes(q) ||
    String(i.value || '').toLowerCase().includes(q) ||
    (i.meta?.domainEngine || '').toLowerCase().includes(q)
  );
}

function _hl(text) {
  if (!_search || !text) return _escHtml(String(text));
  const q = _search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return _escHtml(String(text)).replace(
    new RegExp(q, 'gi'),
    m => `<mark style="background:rgba(79,142,247,.3);color:inherit;border-radius:2px;">${m}</mark>`
  );
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
