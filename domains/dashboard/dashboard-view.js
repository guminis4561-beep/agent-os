// ═══════════════════════════════════════════════════
// DOMAIN: Dashboard View — real data from API
// ═══════════════════════════════════════════════════

import EventBus from '../../core/events.js';
import AppState from '../../core/state.js';
import * as Api from '../../core/api-client.js';

// Cache — atnaujinamas async po render
let _cache = null;
let _loadPromise = null;

export function renderDashboard() {
  const workspaces = AppState.getState('workspaces') || [];
  const activeWsId = AppState.getState('activeWorkspace');
  const activeWs = workspaces.find(w => w.id === activeWsId) || workspaces[0];

  // Render iš karto su cached duomenimis (arba skeleton)
  return `
    <div class="dashboard">
      <div class="dashboard__header">
        <h1 class="dashboard__title">Home Dashboard</h1>
        <div class="dashboard__header-actions" style="display:flex;gap:var(--space-2);">
          <button class="btn btn--secondary btn--sm" id="dash-refresh">⟳ Atnaujinti</button>
          <button class="btn btn--primary btn--sm" data-navigate="task-execution">Nauja Užduotis</button>
        </div>
      </div>

      <div class="dashboard__grid" style="grid-template-columns:2fr 1fr;gap:var(--space-4);">

        <!-- Kairė kolona -->
        <div style="display:flex;flex-direction:column;gap:var(--space-4);">

          <section>
            <div class="dashboard__section-title">
              <span>Varikliai</span>
              <button class="btn btn--ghost btn--sm" data-navigate="engines">Valdyti →</button>
            </div>
            <div id="dash-engines" class="dashboard__engines" style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-4);">
              ${_skeletonCard()}${_skeletonCard()}${_skeletonCard()}
            </div>
          </section>

          <section>
            <div class="dashboard__section-title">
              <span>Paskutinės Užduotys</span>
              <button class="btn btn--ghost btn--sm" data-navigate="task-execution">Visos →</button>
            </div>
            <div id="dash-tasks" class="card" style="padding:0;">
              ${_skeletonRows(3)}
            </div>
          </section>

        </div>

        <!-- Dešinė kolona -->
        <div style="display:flex;flex-direction:column;gap:var(--space-4);">

          <section>
            <div class="dashboard__section-title"><span>Sistemos Būsena</span></div>
            <div id="dash-health" class="card" style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
              ${_skeletonStats(4)}
            </div>
          </section>

          <section>
            <div class="dashboard__section-title">
              <span>Atmintis</span>
              <button class="btn btn--ghost btn--sm" data-navigate="memory">Detaliau →</button>
            </div>
            <div id="dash-memory" class="card" style="display:flex;flex-direction:column;gap:var(--space-3);">
              ${_skeletonRows(2)}
            </div>
          </section>

        </div>
      </div>
    </div>
  `;
}

export function initDashboardEvents() {
  document.querySelectorAll('[data-navigate]').forEach(el => {
    el.addEventListener('click', () => EventBus.emit('navigate', el.dataset.navigate));
  });

  document.getElementById('dash-refresh')?.addEventListener('click', () => {
    _cache = null;
    _loadAndPaint();
  });

  // Repaint instantly from cache on re-mount; only fetch on first mount / refresh.
  if (_cache) {
    _paintEngines(_cache.tasks, _cache.health, _cache.cfg, _cache.usage);
    _paintTasks(_cache.tasks);
    _paintHealth(_cache.health, _cache.usage);
    _paintMemory(_cache.mem);
  } else if (!_loadPromise) {
    _loadAndPaint();
  }
}

// ─── Async load + paint ───────────────────────────

async function _loadAndPaint() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = _doLoad();
  _loadPromise.finally(() => { _loadPromise = null; });
  return _loadPromise;
}

async function _doLoad() {
  const [healthRes, memRes, tasksRes, cfgRes, usageRes] = await Promise.allSettled([
    Api.getHealth(),
    Api.getMemorySummary(),
    Api.getTasks(),
    Api.getConfig(),
    Api.getUsage(),
  ]);

  const health = healthRes.status === 'fulfilled' ? healthRes.value : null;
  const mem    = memRes.status    === 'fulfilled' ? memRes.value    : null;
  const tasks  = tasksRes.status  === 'fulfilled' ? (tasksRes.value.tasks || []) : [];
  const cfg    = cfgRes.status    === 'fulfilled' ? cfgRes.value    : null;
  const usage  = usageRes.status  === 'fulfilled' ? usageRes.value  : null;

  _cache = { health, mem, tasks, cfg, usage };

  _paintEngines(tasks, health, cfg, usage);
  _paintTasks(tasks);
  _paintHealth(health, usage);
  _paintMemory(mem);
}

// ─── Usage formatting ─────────────────────────────
function _fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
function _fmtCost(c) {
  c = Number(c) || 0;
  if (c === 0) return 'nemokama';
  if (c < 0.01) return '$' + c.toFixed(4);
  return '$' + c.toFixed(c < 1 ? 3 : 2);
}

/**
 * The model an agent actually runs on, mirroring the server's resolveAgent():
 * per-agent tuning model > the agent's (named) engine model > the global default.
 */
function _effectiveModel(agentId, cfg) {
  if (!cfg) return null;
  const tuned = cfg.agentTuning?.[agentId]?.model;
  if (tuned) return { model: tuned, source: 'tuning' };
  const engineName = cfg.agentEngines?.[agentId] || 'glm';
  if (engineName !== 'glm') {
    const em = cfg.engines?.[engineName]?.model;
    if (em) return { model: em, source: 'engine' };
  }
  return { model: cfg.glmModel || '—', source: 'default' };
}

// ─── Engines panel ───────────────────────────────

function _paintEngines(tasks, health, cfg, usage) {
  const el = document.getElementById('dash-engines');
  if (!el) return;
  const byDomainUsage = usage?.byDomain || {};

  const byDomain = { coding: 0, trading: 0, creation: 0 };
  const lastByDomain = {};
  tasks.forEach(t => {
    if (t.domainEngine in byDomain) {
      byDomain[t.domainEngine]++;
      if (!lastByDomain[t.domainEngine]) lastByDomain[t.domainEngine] = t;
    }
  });

  const hasKey = health?.hasApiKey ?? false;

  const DOMAINS = [
    { id: 'coding',   agentId: 'codeweaver',  label: 'CODING ENGINE',   sub: 'CodeWeaver',    nav: 'coding',   icon: '⟨/⟩' },
    { id: 'trading',  agentId: 'marketsense', label: 'TRADING ENGINE',  sub: 'MarketSense',   nav: 'trading',  icon: '◇'   },
    { id: 'creation', agentId: 'storyteller', label: 'CREATION ENGINE', sub: 'StoryTeller',   nav: 'creation', icon: '✦'   },
  ];

  const engineCards = DOMAINS.map(d => {
    const count = byDomain[d.id];
    const last  = lastByDomain[d.id];
    const lastLabel = last ? _ago(last.startedAt) : 'Niekada';
    const active = hasKey;

    const eff = _effectiveModel(d.agentId, cfg) || { model: health?.model || '—', source: 'default' };
    const overridden = eff.source !== 'default';
    const u = byDomainUsage[d.id] || { totalTokens: 0, cost: 0, calls: 0 };

    return `
      <div class="engine-card" data-navigate="${d.nav}" style="cursor:pointer;">
        <div class="engine-card__header">
          <div class="engine-card__title-group">
            <div class="engine-card__title">${d.label}</div>
            <div class="engine-card__version">(${d.sub})</div>
          </div>
          <div class="engine-card__status">
            <span class="engine-card__status-dot ${active ? 'engine-card__status-dot--active' : ''}" style="${active ? '' : 'background:var(--text-muted)'}"></span>
            <span style="color:${active ? 'var(--success)' : 'var(--text-muted)'};">${active ? 'Aktyvus' : 'Be rakto'}</span>
          </div>
        </div>
        <div class="engine-card__tags" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="engine-card__tag" style="font-family:var(--font-mono);font-size:10px;" title="${overridden ? 'Priskirtas šiam agentui' : 'Numatytasis modelis'}">${eff.model}</span>
          ${overridden ? `<span class="badge badge--info" style="font-size:8px;">priskirta</span>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin:var(--space-3) 0;padding:var(--space-2) var(--space-3);background:var(--bg-body);border-radius:var(--radius-md);">
          <div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">Token'ai</div>
            <div style="font-size:var(--text-sm);font-weight:600;font-family:var(--font-mono);color:var(--text-primary);">${_fmtTokens(u.totalTokens)}</div>
          </div>
          <div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">Kreditai</div>
            <div style="font-size:var(--text-sm);font-weight:600;font-family:var(--font-mono);color:${u.cost > 0 ? 'var(--warning)' : 'var(--text-muted)'};">${_fmtCost(u.cost)}</div>
          </div>
        </div>
        <div class="engine-card__stats">
          <span class="engine-card__stat-label">Užduotys:</span>
          <span class="engine-card__stat-value">${count}</span>
          <span class="engine-card__stat-label">Iškvietimai:</span>
          <span class="engine-card__stat-value">${u.calls}</span>
          <span class="engine-card__stat-label">Paskutinė:</span>
          <span class="engine-card__stat-value">${lastLabel}</span>
        </div>
      </div>
    `;
  });

  // Chat card
  const chatU = byDomainUsage['chat'] || { totalTokens: 0, cost: 0, calls: 0 };
  const chatModel = _effectiveModel('chatbot', cfg) || { model: health?.model || '—', source: 'default' };
  const chatCard = `
    <div class="engine-card" data-navigate="chat" style="cursor:pointer;">
      <div class="engine-card__header">
        <div class="engine-card__title-group">
          <div class="engine-card__title">💬 POKALBIS</div>
          <div class="engine-card__version">(AI Asistentas)</div>
        </div>
        <div class="engine-card__status">
          <span class="engine-card__status-dot ${hasKey ? 'engine-card__status-dot--active' : ''}" style="${hasKey ? '' : 'background:var(--text-muted)'}"></span>
          <span style="color:${hasKey ? 'var(--success)' : 'var(--text-muted)'};">${hasKey ? 'Aktyvus' : 'Be rakto'}</span>
        </div>
      </div>
      <div class="engine-card__tags" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span class="engine-card__tag" style="font-family:var(--font-mono);font-size:10px;" title="Numatytasis + pasirenkamas pokalbyje">${chatModel.model}</span>
        <span class="badge badge--info" style="font-size:8px;">atmintis</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin:var(--space-3) 0;padding:var(--space-2) var(--space-3);background:var(--bg-body);border-radius:var(--radius-md);">
        <div>
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">Token'ai</div>
          <div style="font-size:var(--text-sm);font-weight:600;font-family:var(--font-mono);color:var(--text-primary);">${_fmtTokens(chatU.totalTokens)}</div>
        </div>
        <div>
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">Kreditai</div>
          <div style="font-size:var(--text-sm);font-weight:600;font-family:var(--font-mono);color:${chatU.cost > 0 ? 'var(--warning)' : 'var(--text-muted)'};">${_fmtCost(chatU.cost)}</div>
        </div>
      </div>
      <div class="engine-card__stats">
        <span class="engine-card__stat-label">Pranešimai:</span>
        <span class="engine-card__stat-value">${chatU.calls}</span>
        <span class="engine-card__stat-label">Atmintis:</span>
        <span class="engine-card__stat-value">Memory Fabric</span>
      </div>
    </div>
  `;

  el.innerHTML = [...engineCards, chatCard].join('');

  // Re-attach navigacijos event'us naujai sugeneruotiems elementams
  el.querySelectorAll('[data-navigate]').forEach(e =>
    e.addEventListener('click', () => EventBus.emit('navigate', e.dataset.navigate))
  );
}

// ─── Tasks panel ─────────────────────────────────

function _paintTasks(tasks) {
  const el = document.getElementById('dash-tasks');
  if (!el) return;

  const recent = [...tasks].reverse().slice(0, 6);

  if (!recent.length) {
    el.innerHTML = `<div style="padding:var(--space-5);text-align:center;color:var(--text-muted);font-size:var(--text-sm);">Dar nėra užduočių. Pradėk nuo <a href="#" id="dash-goto-task" style="color:var(--accent-primary);">Task FSM</a>.</div>`;
    el.querySelector('#dash-goto-task')?.addEventListener('click', e => { e.preventDefault(); EventBus.emit('navigate', 'task-execution'); });
    return;
  }

  el.innerHTML = recent.map((t, i) => {
    const isLast = i === recent.length - 1;
    const stateColor = t.state === 'COMPLETED' ? 'var(--success)' : t.state === 'FAILED' ? 'var(--error)' : 'var(--warning)';
    const domainIcon = { coding: '⟨/⟩', trading: '◇', creation: '✦' }[t.domainEngine] || '⚙';
    const elapsed = t.completedAt
      ? ((t.completedAt - t.startedAt) / 1000).toFixed(1) + 's'
      : _ago(t.startedAt);

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4);${isLast ? '' : 'border-bottom:1px solid var(--border-default);'}">
        <div style="display:flex;align-items:center;gap:var(--space-3);min-width:0;">
          <div style="width:32px;height:32px;border-radius:var(--radius-md);background:var(--bg-body);display:flex;align-items:center;justify-content:center;border:1px solid var(--border-default);flex-shrink:0;font-size:13px;">${domainIcon}</div>
          <div style="min-width:0;">
            <div style="font-size:var(--text-sm);font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;">${t.intent || '—'}</div>
            <div style="font-size:var(--text-xs);color:${t.state === 'FAILED' && t.errorMessage ? 'var(--error)' : 'var(--text-muted)'};">${t.state === 'FAILED' && t.errorMessage ? t.errorMessage.slice(0, 60) : (t.routedAgent || t.domainEngine || '—') + ' · ' + elapsed}</div>
          </div>
        </div>
        <span class="badge" style="background:transparent;border:1px solid ${stateColor};color:${stateColor};font-size:10px;flex-shrink:0;">${t.state}</span>
      </div>
    `;
  }).join('');
}

// ─── Health panel ─────────────────────────────────

function _paintHealth(health, usage) {
  const el = document.getElementById('dash-health');
  if (!el) return;

  const ok = health?.ok ?? false;
  const model = health?.model || '—';
  const hasKey = health?.hasApiKey ?? false;
  const ping = health ? Math.round(Date.now() - (health.time || Date.now())) + ' ms' : '—';
  const tot = usage?.total || { totalTokens: 0, cost: 0, calls: 0 };

  el.innerHTML = `
    <div>
      <div style="font-size:var(--text-xs);color:var(--text-muted);">Būsena</div>
      <div style="font-size:var(--text-lg);font-weight:600;color:${ok ? 'var(--success)' : 'var(--error)'};">${ok ? 'Veikia' : 'Klaida'}</div>
    </div>
    <div>
      <div style="font-size:var(--text-xs);color:var(--text-muted);">API raktas</div>
      <div style="font-size:var(--text-lg);font-weight:600;color:${hasKey ? 'var(--success)' : 'var(--error)'};">${hasKey ? '✓' : '✕'}</div>
    </div>
    <div>
      <div style="font-size:var(--text-xs);color:var(--text-muted);">Ping</div>
      <div style="font-size:var(--text-lg);font-weight:600;color:var(--text-primary);">${ping}</div>
    </div>
    <div>
      <div style="font-size:var(--text-xs);color:var(--text-muted);">Modelis</div>
      <div style="font-size:11px;font-weight:600;color:var(--text-primary);word-break:break-all;line-height:1.3;margin-top:2px;">${model}</div>
    </div>
    <div>
      <div style="font-size:var(--text-xs);color:var(--text-muted);">Token'ai (viso)</div>
      <div style="font-size:var(--text-lg);font-weight:600;font-family:var(--font-mono);color:var(--text-primary);">${_fmtTokens(tot.totalTokens)}</div>
    </div>
    <div>
      <div style="font-size:var(--text-xs);color:var(--text-muted);">Kreditai (viso)</div>
      <div style="font-size:var(--text-lg);font-weight:600;font-family:var(--font-mono);color:${tot.cost > 0 ? 'var(--warning)' : 'var(--text-muted)'};">${_fmtCost(tot.cost)}</div>
    </div>
  `;
}

// ─── Memory panel ─────────────────────────────────

function _paintMemory(mem) {
  const el = document.getElementById('dash-memory');
  if (!el) return;

  const total = mem?.total ?? 0;
  const byLayer = mem?.byLayer || {};

  if (!total) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-3);">Atmintis tuščia</div>`;
    return;
  }

  const layers = Object.entries(byLayer);
  const maxVal = Math.max(...layers.map(([, v]) => v), 1);

  el.innerHTML = layers.map(([layer, count]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);">
      <span style="font-size:var(--text-sm);font-weight:500;color:var(--text-primary);width:80px;flex-shrink:0;">${layer}</span>
      <div style="flex:1;height:4px;background:var(--bg-body);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${Math.round(count/maxVal*100)}%;background:var(--trading-accent);border-radius:2px;"></div>
      </div>
      <span style="font-size:var(--text-xs);color:var(--text-muted);font-family:var(--font-mono);width:30px;text-align:right;">${count}</span>
    </div>
  `).join('') + `
    <div style="padding-top:var(--space-2);border-top:1px solid var(--border-default);display:flex;justify-content:space-between;font-size:var(--text-xs);color:var(--text-muted);">
      <span>Iš viso įrašų</span>
      <span style="font-family:var(--font-mono);color:var(--text-primary);">${total}</span>
    </div>
  `;
}

// ─── Skeleton loaders ─────────────────────────────

function _skeletonCard() {
  return `<div class="engine-card" style="opacity:.4;"><div style="height:60px;background:var(--bg-body);border-radius:var(--radius-md);"></div></div>`;
}
function _skeletonRows(n) {
  return Array.from({length: n}, () =>
    `<div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);"><div style="height:32px;background:var(--bg-body);border-radius:var(--radius-md);opacity:.4;"></div></div>`
  ).join('');
}
function _skeletonStats(n) {
  return Array.from({length: n}, () =>
    `<div><div style="height:36px;background:var(--bg-body);border-radius:var(--radius-md);opacity:.4;"></div></div>`
  ).join('');
}

// ─── Helpers ─────────────────────────────────────

function _ago(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  return `${Math.floor(s/3600)}h`;
}

