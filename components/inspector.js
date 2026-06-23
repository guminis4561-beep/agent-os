// ═══════════════════════════════════════════════════
// COMPONENT: Inspector Panel — real data only
// ═══════════════════════════════════════════════════

import AppState from '../core/state.js';
import * as Api from '../core/api-client.js';

// Monotonically increasing counter. Each renderInspector() call bumps it;
// async continuations check their captured value against the current one and
// bail out if a newer render has already started (stale-render guard).
let _loadGeneration = 0;

export function renderInspector() {
  const inspector = document.getElementById('inspector');
  if (!inspector) return;

  const view = AppState.getState('activeView');
  const selectedItem = AppState.getState('selectedItem');
  const title = view === 'dashboard' ? 'Sistema' : 'Inspektorius';

  inspector.innerHTML = `
    <div class="inspector__header">
      <span class="inspector__title">${title}</span>
      <button class="inspector__close-btn" id="inspector-close">✕</button>
    </div>
    <div class="inspector__body" id="inspector-body">
      <div style="color:var(--text-muted);font-size:var(--text-xs);text-align:center;padding:var(--space-4);">Kraunama…</div>
    </div>
  `;

  inspector.querySelector('#inspector-close').addEventListener('click', () => {
    AppState.setState('inspectorOpen', false);
    document.getElementById('app').classList.add('inspector-collapsed');
  });

  // Bump generation before the rAF so any in-flight load from a previous render
  // sees the new value and discards its result.
  const gen = ++_loadGeneration;
  // Defer to next frame: coalesces rapid successive calls (e.g. quick nav clicks)
  // so only the last scheduled load actually touches the DOM.
  requestAnimationFrame(() => _loadContent(view, selectedItem, gen));
}

async function _loadContent(view, selectedItem, gen) {
  const body = document.getElementById('inspector-body');
  // Guard: bail if another render has already superseded this one.
  if (!body || _loadGeneration !== gen) return;

  try {
    if (view === 'dashboard') {
      await _renderDashboardPanel(body, gen);
    } else {
      await _renderContextPanel(body, view, selectedItem, gen);
    }
  } catch (err) {
    if (_loadGeneration !== gen) return;
    body.innerHTML = `<div style="color:var(--error);font-size:var(--text-xs);padding:var(--space-3);">Klaida: ${err.message}</div>`;
  }
}

async function _renderDashboardPanel(body, gen) {
  // Fetch real data in parallel
  const [health, memorySummary, tasksData] = await Promise.allSettled([
    Api.getHealth(),
    Api.getMemorySummary(),
    Api.getTasks(),
  ]);

  const h = health.status === 'fulfilled' ? health.value : null;
  const mem = memorySummary.status === 'fulfilled' ? memorySummary.value : null;
  const tasks = tasksData.status === 'fulfilled' ? (tasksData.value.tasks || []) : [];

  const activeTasks = tasks.filter(t => !['COMPLETED','CANCELLED','FAILED'].includes(t.state));
  const modelLabel = h?.model || 'Nekonfigūruota';
  const hasKey = h?.hasApiKey ?? false;

  // Memory alert only if real memory store is near capacity
  const memCount = mem?.total ?? 0;
  const memAlert = memCount > 80;

  // Stale-render guard: another navigation may have started while we were fetching
  if (_loadGeneration !== gen) return;

  body.innerHTML = `
    ${memAlert ? `
    <div class="inspector__section">
      <div class="inspector__section-title">Įspėjimai</div>
      <div style="background:rgba(248,113,113,0.1);border:1px solid var(--error);border-radius:var(--radius-md);padding:var(--space-3);">
        <div style="font-size:var(--text-sm);font-weight:500;color:var(--error);margin-bottom:4px;">Atminties riba artėja</div>
        <div style="font-size:var(--text-xs);color:var(--text-primary);">Išsaugota ${memCount} įrašų. Svarstykite išvalyti senus.</div>
      </div>
    </div>` : ''}

    <div class="inspector__section">
      <div class="inspector__section-title">Variklio Būsena</div>
      <div class="inspector__property">
        <span class="inspector__prop-label">Modelis</span>
        <span class="inspector__prop-value" style="color:${hasKey ? 'var(--success)' : 'var(--error)'};">${modelLabel}</span>
      </div>
      <div class="inspector__property">
        <span class="inspector__prop-label">API raktas</span>
        <span class="inspector__prop-value" style="color:${hasKey ? 'var(--success)' : 'var(--error)'};">${hasKey ? 'Nustatytas ✓' : 'Nenustatytas ✕'}</span>
      </div>
      <div class="inspector__property">
        <span class="inspector__prop-label">Aktyvios užduotys</span>
        <span class="inspector__prop-value" style="color:${activeTasks.length > 0 ? 'var(--success)' : 'var(--text-muted)'};">${activeTasks.length > 0 ? `Vyksta (${activeTasks.length})` : 'Nėra'}</span>
      </div>
    </div>

    ${activeTasks.length > 0 ? `
    <div class="inspector__section">
      <div class="inspector__section-title">Aktyvios Užduotys</div>
      ${activeTasks.slice(0, 3).map(t => `
        <div class="inspector__property" style="flex-direction:column;align-items:flex-start;gap:2px;">
          <span class="inspector__prop-label" style="font-size:10px;color:var(--text-muted);">${t.domainEngine?.toUpperCase() || 'TASK'}</span>
          <span style="font-size:var(--text-xs);color:var(--text-primary);word-break:break-word;">${(t.intent || '').slice(0, 60)}${t.intent?.length > 60 ? '…' : ''}</span>
          <span class="badge badge--info" style="font-size:9px;">${t.state}</span>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="inspector__section">
      <div class="inspector__section-title">Atmintis</div>
      <div class="inspector__property">
        <span class="inspector__prop-label">Iš viso įrašų</span>
        <span class="inspector__prop-value">${mem?.total ?? '—'}</span>
      </div>
      ${mem?.byLayer ? Object.entries(mem.byLayer).map(([layer, count]) => `
        <div class="inspector__property">
          <span class="inspector__prop-label">${layer}</span>
          <span class="inspector__prop-value">${count}</span>
        </div>
      `).join('') : ''}
    </div>

    <div class="inspector__section">
      <div class="inspector__section-title">Greiti Veiksmai</div>
      <button class="btn btn--secondary btn--sm" style="width:100%;margin-bottom:var(--space-2);" id="insp-btn-settings">⚙ Nustatymai</button>
      <button class="btn btn--secondary btn--sm" style="width:100%;" id="insp-btn-tasks">⚙ Užduočių FSM</button>
    </div>
  `;

  // Attach event listeners in the next frame — same pattern as topbar.js modal buttons.
  requestAnimationFrame(() => {
    if (_loadGeneration !== gen) return;
    document.getElementById('insp-btn-settings')?.addEventListener('click', () => {
      import('../core/events.js').then(({ default: EventBus }) => EventBus.emit('navigate', 'settings'));
    });
    document.getElementById('insp-btn-tasks')?.addEventListener('click', () => {
      import('../core/events.js').then(({ default: EventBus }) => EventBus.emit('navigate', 'task-execution'));
    });
  });
}

async function _renderContextPanel(body, view, selectedItem, gen) {
  const [memorySummary, tasksData] = await Promise.allSettled([
    Api.getMemorySummary(),
    Api.getTasks(),
  ]);
  const mem = memorySummary.status === 'fulfilled' ? memorySummary.value : null;
  const tasks = tasksData.status === 'fulfilled' ? (tasksData.value.tasks || []) : [];
  const recentTasks = tasks.slice(-3).reverse();

  if (_loadGeneration !== gen) return;

  let propsHtml = '';
  if (selectedItem?.type === 'agent') {
    const a = selectedItem.data;
    propsHtml = _props([
      ['ID', a.id],
      ['Pavadinimas', a.name],
      ['Tipas', a.type],
      ['Variklis', a.engine || 'glm'],
      ['Būsena', a.status || '—'],
    ]);
  } else if (selectedItem?.type === 'node') {
    const n = selectedItem.data;
    propsHtml = _props([
      ['ID', n.id],
      ['Pavadinimas', n.name || n.type],
      ['Tipas', n.type],
      ['Pozicija', `${n.x}, ${n.y}`],
    ]);
  } else {
    propsHtml = _props([
      ['Vaizdas', view],
      ['Darbo sritis', 'Pagrindinė'],
      ['Atminties įrašai', mem?.total ?? '—'],
      ['Paskutinės užduotys', tasks.length],
    ]);
  }

  body.innerHTML = `
    <div class="inspector__section">
      <div class="inspector__list-item">
        <div class="inspector__list-item-icon">📋</div>
        <span class="inspector__list-item-label">Veiklos Istorija</span>
        <span class="inspector__list-item-meta">(${tasks.length})</span>
      </div>
      <div class="inspector__list-item">
        <div class="inspector__list-item-icon">🧠</div>
        <span class="inspector__list-item-label">Atmintis</span>
        <span class="inspector__list-item-meta">(${mem?.total ?? 0} įrašų)</span>
      </div>
    </div>

    ${recentTasks.length > 0 ? `
    <div class="inspector__section">
      <div class="inspector__section-title">Paskutinės Užduotys</div>
      ${recentTasks.map(t => `
        <div style="margin-bottom:var(--space-2);padding:var(--space-2);background:var(--bg-elevated);border-radius:var(--radius-md);">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">${t.domainEngine || ''} · <span class="badge badge--${t.state === 'COMPLETED' ? 'success' : 'info'}" style="font-size:9px;">${t.state}</span></div>
          <div style="font-size:var(--text-xs);color:var(--text-primary);">${(t.intent || '').slice(0, 55)}${(t.intent || '').length > 55 ? '…' : ''}</div>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="inspector__section">
      <div class="inspector__section-title">Informacija</div>
      ${propsHtml}
    </div>
  `;
}

function _props(pairs) {
  return pairs.map(([label, value]) => `
    <div class="inspector__property">
      <span class="inspector__prop-label">${label}</span>
      <span class="inspector__prop-value">${value}</span>
    </div>
  `).join('');
}

AppState.subscribe('activeView', () => renderInspector());
AppState.subscribe('selectedItem', () => renderInspector());
