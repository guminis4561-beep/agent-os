// ═══════════════════════════════════════════════════
// DOMAIN: Agent Registry — real data from /api/agents
// ═══════════════════════════════════════════════════

import AppState from '../../core/state.js';
import EventBus from '../../core/events.js';
import * as Api from '../../core/api-client.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal } from '../../components/modal.js';
import { invalidateModelsCache } from '../engines/model-picker.js';

// Module state
let filterType = 'all';
let _agents = [];     // merged: built-in + custom
let _engines = [];    // engine names list from server
let _models = [];     // selectable model ids for per-agent override (union)
let _catalogue = [];  // editable availableModels list from config
let _tuning = {};     // per-profile overrides: { id: { model, temperature, persona } }
let _loading = false;
let _selectedId = null;

// ─── Render ───────────────────────────────────────

export function renderAgents() {
  if (_selectedId) {
    const agent = _agents.find(a => a.id === _selectedId);
    if (agent) return _renderProfile(agent);
  }

  const filtered = filterType === 'all'
    ? _agents
    : _agents.filter(a => a.type === filterType);

  const counts = {
    all: _agents.length,
    coding: _agents.filter(a => a.type === 'coding').length,
    trading: _agents.filter(a => a.type === 'trading').length,
    creation: _agents.filter(a => a.type === 'creation').length,
  };

  return `
    <div>
      <div class="section-header">
        <div class="section-header__left">
          <div class="section-header__icon" style="background:rgba(168,85,247,0.12);">⬢</div>
          <div>
            <h2 class="section-header__title">Hermes Valdymas</h2>
            <p class="section-header__subtitle">Agentų konfigūracija, modelių priskyrimas ir katalogas</p>
          </div>
        </div>
        <div class="section-header__actions">
          <button class="btn btn--ghost btn--sm" id="btn-agents-refresh">⟳ Atnaujinti</button>
          <button class="btn btn--primary" id="btn-new-agent">＋ Registruoti Agentą</button>
        </div>
      </div>

      ${_renderModelsCatalogue()}

      ${_renderAllPrompts()}

      <!-- Filters -->
      <div class="tabs" style="display:inline-flex;margin-bottom:var(--space-5);">
        <div class="tab ${filterType === 'all'      ? 'active' : ''}" data-filter="all">Visi (${counts.all})</div>
        <div class="tab ${filterType === 'coding'   ? 'active' : ''}" data-filter="coding">⟨/⟩ Coding (${counts.coding})</div>
        <div class="tab ${filterType === 'trading'  ? 'active' : ''}" data-filter="trading">◇ Trading (${counts.trading})</div>
        <div class="tab ${filterType === 'creation' ? 'active' : ''}" data-filter="creation">✦ Creation (${counts.creation})</div>
      </div>

      <!-- Loading skeleton -->
      ${_loading && !_agents.length ? `
        <div class="agents-grid">
          ${Array.from({length: 4}, () => `
            <div class="agent-card" style="opacity:.4;">
              <div style="height:80px;background:var(--bg-body);border-radius:var(--radius-md);"></div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Agent grid -->
      ${!_loading || _agents.length ? `
        <div class="agents-grid" id="agents-grid">
          ${filtered.length ? filtered.map(_renderCard).join('') : `
            <div class="card" style="grid-column:1/-1;padding:var(--space-8);text-align:center;">
              <div style="font-size:2rem;margin-bottom:var(--space-3);opacity:.4;">⬡</div>
              <div style="color:var(--text-muted);font-size:var(--text-sm);">Nėra agentų šioje kategorijoje.</div>
            </div>
          `}
        </div>
      ` : ''}
    </div>
  `;
}

// Read-only overview of every built-in agent's effective prompts (persona for
// meta agents; each FSM sub-state instruction for workers). Shows the override
// when one is set, otherwise the built-in default — so the whole prompt surface
// is visible in one place without opening each agent.
function _renderAllPrompts() {
  const builtIn = _agents.filter(a => !a.custom);
  if (!builtIn.length) return '';

  const overridden = `<span class="badge badge--info" style="font-size:9px;">pakeista</span>`;
  const isDefault = `<span style="font-size:9px;color:var(--text-muted);">numatytasis</span>`;

  const block = (label, badge, text) => `
    <div style="margin-bottom:var(--space-3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--coding-accent);">${label}</span>
        ${badge}
      </div>
      <pre style="margin:0;white-space:pre-wrap;word-break:break-word;background:var(--bg-body);border:1px solid var(--border-default);border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);font-family:var(--font-mono);font-size:11px;line-height:1.5;color:var(--text-secondary);max-height:260px;overflow:auto;">${_esc(text || '(tuščia — gali reikėti restartuoti serverį)')}</pre>
    </div>`;

  const agentBlocks = builtIn.map(a => {
    const t = _tuning[a.id] || {};
    const isMeta = a.role !== 'worker';
    let body, count;
    if (isMeta) {
      body = block('PERSONA', t.persona ? overridden : isDefault, t.persona || a.description || '');
      count = 1;
    } else {
      const steps = a.steps || [];
      count = steps.length;
      body = steps.map(sub => {
        const ov = t.steps && t.steps[sub];
        return block(sub, ov ? overridden : isDefault, ov || (a.stepPersonas && a.stepPersonas[sub]) || '');
      }).join('');
    }
    return `
      <details style="border:1px solid var(--border-default);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2);background:var(--bg-card);">
        <summary style="cursor:pointer;font-weight:var(--weight-bold);display:flex;align-items:center;gap:var(--space-2);list-style:none;">
          <span>${a.icon || '🤖'}</span>
          <span>${a.name}</span>
          <span class="badge badge--outline" style="font-size:9px;">${a.role}</span>
          <span style="font-size:10px;color:var(--text-muted);margin-left:auto;">${count} prompt${count === 1 ? 'as' : 'ai'}</span>
        </summary>
        <div style="margin-top:var(--space-3);">${body}</div>
      </details>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:var(--space-5);">
      <div class="card__header">
        <div>
          <div class="card__title">Promptų apžvalga</div>
          <div class="card__subtitle">Visi agentų ir žingsnių promptai, kaip jie siunčiami modeliui (efektyvus tekstas)</div>
        </div>
        <div class="section-header__icon" style="background:rgba(168,85,247,.12);width:32px;height:32px;font-size:16px;">📋</div>
      </div>
      <div class="card__body">${agentBlocks}</div>
    </div>`;
}

// Editable catalogue of model ids that populate every dropdown (per-task picker
// + per-agent override). Persisted via config.availableModels. Built to scale to
// the full OpenRouter list (hundreds of ids): scrollable + live filter + sync.
function _renderModelsCatalogue() {
  const chips = _catalogue.length
    ? [..._catalogue].sort().map(m => `
        <span class="catalogue-chip badge badge--outline" data-model="${m}" style="display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:11px;padding:4px 8px;">
          ${m}
          <button class="model-remove-btn" data-model="${m}" title="Pašalinti"
            style="background:none;border:none;color:var(--error);cursor:pointer;font-size:13px;line-height:1;padding:0;">✕</button>
        </span>`).join('')
    : `<span style="color:var(--text-muted);font-size:var(--text-xs);">Katalogas tuščias — pridėkite modelį arba spauskite „Sync iš OpenRouter".</span>`;

  return `
    <div class="card" style="margin-bottom:var(--space-5);">
      <div class="card__header">
        <div>
          <div class="card__title">Modelių katalogas <span class="badge badge--info" style="font-size:9px;margin-left:6px;">${_catalogue.length}</span></div>
          <div class="card__subtitle">Šie modeliai rodomi visuose pasirinkimuose (užduotys + agentai)</div>
        </div>
        <div style="display:flex;gap:var(--space-2);align-items:center;">
          <button class="btn btn--secondary btn--sm" id="btn-sync-openrouter" title="Pritraukti visus OpenRouter modelius">⟳ Sync iš OpenRouter</button>
          ${_catalogue.length ? `<button class="btn btn--ghost btn--sm" id="btn-clear-catalogue" style="color:var(--error);">Išvalyti</button>` : ''}
        </div>
      </div>
      <div class="card__body">
        ${_catalogue.length > 12 ? `
          <input id="model-filter-input" type="text" placeholder="🔍 Filtruoti modelius…"
            style="width:100%;box-sizing:border-box;margin-bottom:var(--space-3);padding:var(--space-2) var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:var(--text-sm);">
        ` : ''}
        <div id="models-catalogue-chips" style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-4);max-height:${_catalogue.length > 12 ? '260px' : 'none'};overflow-y:auto;${_catalogue.length > 12 ? 'padding:var(--space-2);border:1px solid var(--border-default);border-radius:var(--radius-md);' : ''}">
          ${chips}
        </div>
        <div style="display:flex;gap:var(--space-2);">
          <input id="model-add-input" type="text" placeholder="Rankiniu būdu pridėti, pvz. anthropic/claude-3.7-sonnet"
            style="flex:1;padding:var(--space-2) var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:var(--text-sm);font-family:var(--font-mono);">
          <button class="btn btn--secondary btn--sm" id="btn-add-model">＋ Pridėti</button>
        </div>
      </div>
    </div>
  `;
}

function _renderCard(agent) {
  const bgColor = agent.type === 'coding' ? 'var(--coding-bg)'
    : agent.type === 'trading' ? 'var(--trading-bg)'
    : 'var(--creation-bg)';
  const badgeType = { coding: 'coding', trading: 'trading', creation: 'creation' }[agent.type] || 'info';
  const engineLabel = agent.engine || agent.defaultEngine || 'glm';

  return `
    <div class="agent-card" data-agent-id="${agent.id}" style="cursor:pointer;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
        <div class="agent-card__avatar" style="background:${bgColor};">${agent.icon || '🤖'}</div>
        <div style="display:flex;gap:4px;align-items:center;">
          ${agent.custom ? `<span class="badge badge--outline" style="font-size:9px;">custom</span>` : `<span class="badge badge--info" style="font-size:9px;">hermes</span>`}
          <span class="badge badge--${agent.status === 'active' ? 'success' : 'info'}">
            <span class="badge__dot"></span>${agent.status || 'idle'}
          </span>
        </div>
      </div>
      <div class="agent-card__name">${agent.name}</div>
      <div class="agent-card__desc">${agent.description || ''}</div>
      <div class="agent-card__tags" style="margin-top:var(--space-2);display:flex;flex-wrap:wrap;gap:4px;">
        <span class="badge badge--${badgeType}" style="font-size:9px;">${agent.type || 'general'}</span>
        ${(agent.capabilities || []).slice(0, 2).map(c => `<span class="agent-card__tag">${c}</span>`).join('')}
      </div>
      <div style="margin-top:var(--space-3);padding-top:var(--space-2);border-top:1px solid var(--border-default);display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);">
        <span style="font-size:var(--text-xs);color:var(--text-muted);">Engine</span>
        ${agent.custom
          ? `<span style="font-size:var(--text-xs);font-family:var(--font-mono);color:var(--text-primary);">${engineLabel}</span>`
          : `<select class="agent-engine-select" data-profile-id="${agent.id}" style="flex:1;max-width:60%;padding:2px var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--border-default);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-xs);">
              ${_engines.map(e => `<option value="${e}" ${e === engineLabel ? 'selected' : ''}>${e}${e === agent.defaultEngine ? ' ★' : ''}</option>`).join('')}
             </select>`
        }
      </div>
      ${agent.custom ? `
        <button class="btn btn--ghost btn--sm agent-delete-btn" data-agent-id="${agent.id}"
          style="margin-top:var(--space-2);width:100%;color:var(--error);font-size:var(--text-xs);">
          ✕ Ištrinti
        </button>
      ` : ''}
    </div>
  `;
}

// Hermes per-agent tuning editor (built-in agents only): raw model override,
// temperature, and a system-prompt override. Persisted via config.agentTuning.
function _renderTuning(agent) {
  const isMeta = agent.role !== 'worker';
  const t = _tuning[agent.id] || {};
  const curModel = t.model || '';
  const curTemp = Number.isFinite(t.temperature) ? t.temperature : (agent.temperature ?? 0.7);
  const curPersona = t.persona || '';

  const modelOpts = ['<option value="">Numatytasis (engine modelis)</option>']
    .concat(_models.map(m => `<option value="${m}" ${m === curModel ? 'selected' : ''}>${m}</option>`))
    .join('');

  return `
    <div class="card" data-tuning-card="${agent.id}">
      <div class="card__header"><div class="card__title">Hermes derinimas</div></div>
      <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-4);">
        <div>
          <label style="display:block;font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-2);">Modelis (perrašo engine modelį)</label>
          <select id="tune-model" style="width:100%;padding:var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:var(--text-sm);">
            ${modelOpts}
          </select>
        </div>

        <div>
          <label style="display:flex;justify-content:space-between;font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-2);">
            <span>Temperatūra</span><span id="tune-temp-val" style="font-family:var(--font-mono);color:var(--text-primary);">${curTemp.toFixed(2)}</span>
          </label>
          <input id="tune-temp" type="range" min="0" max="2" step="0.05" value="${curTemp}" style="width:100%;">
        </div>

        ${isMeta ? `
        <div>
          <label style="display:flex;justify-content:space-between;align-items:center;font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-2);">
            <span>System prompt (persona)</span>
            ${t.persona ? `<span class="badge badge--info" style="font-size:9px;">pakeista</span>` : `<span style="font-size:9px;color:var(--text-muted);">numatytasis</span>`}
          </label>
          <textarea id="tune-persona" rows="8"
            style="width:100%;box-sizing:border-box;resize:vertical;padding:var(--space-2) var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:var(--text-xs);line-height:1.5;font-family:var(--font-mono);">${_esc(curPersona || agent.description || '')}</textarea>
          <div style="margin-top:4px;font-size:10px;color:var(--text-muted);">Rodomas dabartinis promptas. Identiškas numatytajam tekstas nesaugomas kaip pakeitimas.</div>
        </div>
        ` : _renderStepEditors(agent, t)}

        <div style="display:flex;gap:var(--space-2);">
          <button class="btn btn--primary btn--sm" id="btn-save-tuning" data-agent-id="${agent.id}">Išsaugoti derinimą</button>
          ${Object.keys(t).length ? `<button class="btn btn--ghost btn--sm" id="btn-reset-tuning" data-agent-id="${agent.id}" style="color:var(--text-muted);">Atstatyti numatytąjį</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

// Escape text destined for a textarea body (prevents '<...>' from being parsed
// as markup — the coding step personas contain literal <path> placeholders).
function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Per-sub-state instruction editors for a domain worker. Each textarea is
// pre-filled with the override (if any) or the built-in default so the user can
// see and edit exactly what the step tells the model.
function _renderStepEditors(agent, t) {
  const steps = agent.steps || [];
  const defs = agent.stepPersonas || {};
  const overrides = t.steps || {};
  if (!steps.length) {
    return `<div style="font-size:var(--text-xs);color:var(--text-muted);">Šis agentas neturi atskirų žingsnių instrukcijų.</div>`;
  }
  return `
    <div>
      <label style="display:block;font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-2);">
        Žingsnių instrukcijos (FSM sub-state)
      </label>
      <div style="display:flex;flex-direction:column;gap:var(--space-3);">
        ${steps.map(sub => {
          const def = defs[sub] || '';
          const ov = overrides[sub] || '';
          const changed = !!ov;
          return `
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--coding-accent);">${sub}</span>
                ${changed
                  ? `<span class="badge badge--info" style="font-size:9px;">pakeista</span>`
                  : `<span style="font-size:9px;color:var(--text-muted);">numatytasis</span>`}
              </div>
              <textarea class="tune-step" data-sub="${sub}" rows="4"
                style="width:100%;box-sizing:border-box;resize:vertical;padding:var(--space-2) var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:11px;line-height:1.5;font-family:var(--font-mono);">${_esc(ov || def)}</textarea>
            </div>`;
        }).join('')}
      </div>
      <div style="margin-top:var(--space-2);font-size:10px;color:var(--text-muted);">Redaguokite ir išsaugokite. Tekstas, identiškas numatytajam, nesaugomas kaip pakeitimas.</div>
    </div>
  `;
}

function _renderProfile(agent) {
  const badgeType = { coding: 'coding', trading: 'trading', creation: 'creation' }[agent.type] || 'info';
  const memScopes = agent.memoryScopes || { identity: 'read', global: 'read', workspace: 'write', session: 'write' };
  const tools = agent.allowedTools || agent.steps?.map(s => s.label) || ['Standard Tools'];

  return `
    <div class="agent-profile">
      <div class="section-header" style="margin-bottom:var(--space-6);">
        <div class="section-header__left">
          <button class="btn btn--ghost btn--icon" id="btn-back-agents" style="margin-right:var(--space-3);">←</button>
          <div class="section-header__icon" style="background:rgba(168,85,247,.12);">${agent.icon || '🤖'}</div>
          <div>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              <h2 class="section-header__title">${agent.name}</h2>
              <span class="badge badge--${badgeType}">${agent.type}</span>
              ${agent.custom ? `<span class="badge badge--outline" style="font-size:9px;">custom</span>` : `<span class="badge badge--info" style="font-size:9px;">built-in</span>`}
            </div>
            <p class="section-header__subtitle">${agent.description || ''}</p>
          </div>
        </div>
        <div class="section-header__actions">
          ${agent.custom ? `<button class="btn btn--error btn--sm" id="btn-delete-agent-profile">✕ Ištrinti</button>` : ''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6);">
        <!-- LEFT -->
        <div style="display:flex;flex-direction:column;gap:var(--space-6);">
          <div class="card">
            <div class="card__header"><div class="card__title">Gebėjimai ir įrankiai</div></div>
            <div class="card__body">
              <div style="margin-bottom:var(--space-4);">
                <div style="color:var(--text-secondary);font-size:var(--text-sm);margin-bottom:var(--space-2);">Capabilities</div>
                <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
                  ${(agent.capabilities || []).map(c => `<span class="badge badge--outline">${c}</span>`).join('')}
                </div>
              </div>
              <div>
                <div style="color:var(--text-secondary);font-size:var(--text-sm);margin-bottom:var(--space-2);">Žingsniai / Įrankiai</div>
                <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
                  ${tools.map(t => `<span class="badge" style="background:var(--bg-highlight);color:var(--text-primary);border:1px solid var(--border-default);">${t}</span>`).join('')}
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__header"><div class="card__title">Variklis</div></div>
            <div class="card__body">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:var(--text-sm);color:var(--text-muted);">Aktyvus engine</span>
                <span style="font-family:var(--font-mono);font-size:var(--text-sm);color:var(--text-primary);">${agent.engine || agent.defaultEngine || 'glm'}</span>
              </div>
              ${agent.defaultEngine && agent.engine !== agent.defaultEngine ? `
                <div style="margin-top:var(--space-2);font-size:10px;color:var(--text-muted);">Numatytasis: ${agent.defaultEngine}</div>
              ` : ''}
            </div>
          </div>

          ${!agent.custom ? _renderTuning(agent) : ''}
        </div>

        <!-- RIGHT: Memory scopes -->
        <div>
          <div class="card" style="height:100%;">
            <div class="card__header">
              <div><div class="card__title">Atminties Lygiai</div><div class="card__subtitle">Agento prieiga prie atminties</div></div>
              <div class="section-header__icon" style="background:rgba(108,92,231,.12);width:32px;height:32px;font-size:16px;">🧠</div>
            </div>
            <div class="card__body">
              ${[
                { key: 'identity',  label: 'Identity',  color: 'var(--accent-primary)',   desc: 'Core instrukcijos, persona, konstantai.' },
                { key: 'global',    label: 'Global',    color: 'var(--accent-secondary)', desc: 'Bendros sistemos žinios ir šablonai.' },
                { key: 'workspace', label: 'Workspace', color: 'var(--coding-accent)',    desc: 'Projekto kontekstas, failų sistema.' },
                { key: 'session',   label: 'Session',   color: 'var(--trading-accent)',   desc: 'Laikina darbo atmintis užduočiai.' },
              ].map(l => `
                <div style="margin-bottom:var(--space-4);background:var(--bg-highlight);padding:var(--space-4);border-radius:var(--radius-md);border-left:3px solid ${l.color};">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);">
                    <div style="font-weight:var(--weight-bold);">${l.label}</div>
                    ${memScopes[l.key] === 'write'
                      ? `<span class="badge badge--success">Read / Write</span>`
                      : memScopes[l.key] === 'read'
                      ? `<span class="badge badge--info">Read Only</span>`
                      : `<span class="badge badge--warning">None</span>`}
                  </div>
                  <div style="font-size:var(--text-sm);color:var(--text-secondary);">${l.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── Events ───────────────────────────────────────

export function initAgentEvents() {
  if (_selectedId) {
    // Profile mode
    document.getElementById('btn-back-agents')?.addEventListener('click', () => {
      _selectedId = null;
      EventBus.emit('navigate', 'agents');
    });

    document.getElementById('btn-delete-agent-profile')?.addEventListener('click', async () => {
      const agent = _agents.find(a => a.id === _selectedId);
      if (!agent?.custom) return;
      if (!confirm(`Ištrinti agentą "${agent.name}"?`)) return;
      await _deleteAgent(_selectedId);
      _selectedId = null;
      EventBus.emit('navigate', 'agents');
    });

    // Live temperature readout
    const tempInput = document.getElementById('tune-temp');
    tempInput?.addEventListener('input', () => {
      const out = document.getElementById('tune-temp-val');
      if (out) out.textContent = Number(tempInput.value).toFixed(2);
    });

    // Save per-agent tuning
    document.getElementById('btn-save-tuning')?.addEventListener('click', e => {
      _saveTuning(e.currentTarget.dataset.agentId);
    });

    // Reset to built-in defaults (clears all overrides for this agent)
    document.getElementById('btn-reset-tuning')?.addEventListener('click', e => {
      _resetTuning(e.currentTarget.dataset.agentId);
    });

    return;
  }

  // Grid mode
  document.getElementById('btn-agents-refresh')?.addEventListener('click', () => {
    _agents = [];
    _loadAndPaint();
  });

  document.querySelectorAll('.tab[data-filter]').forEach(tab => {
    tab.addEventListener('click', () => {
      filterType = tab.dataset.filter;
      EventBus.emit('navigate', 'agents');
    });
  });

  document.getElementById('btn-new-agent')?.addEventListener('click', () => _openCreateModal());

  // Models catalogue: add
  const addModel = () => {
    const inp = document.getElementById('model-add-input');
    const id = (inp?.value || '').trim();
    if (!id) return;
    if (_catalogue.includes(id)) { showToast('Toks modelis jau yra', 'info'); return; }
    _saveCatalogue([..._catalogue, id]);
  };
  document.getElementById('btn-add-model')?.addEventListener('click', addModel);
  document.getElementById('model-add-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') addModel();
  });

  // Models catalogue: remove
  document.querySelectorAll('.model-remove-btn[data-model]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.model;
      _saveCatalogue(_catalogue.filter(x => x !== m));
    });
  });

  // Models catalogue: sync from OpenRouter (pull the full live list)
  document.getElementById('btn-sync-openrouter')?.addEventListener('click', () => _syncOpenRouter());

  // Models catalogue: clear all
  document.getElementById('btn-clear-catalogue')?.addEventListener('click', () => {
    if (confirm('Išvalyti visą modelių katalogą?')) _saveCatalogue([]);
  });

  // Models catalogue: live filter (DOM-only, no re-render)
  const filterInput = document.getElementById('model-filter-input');
  filterInput?.addEventListener('input', () => {
    const q = filterInput.value.trim().toLowerCase();
    document.querySelectorAll('.catalogue-chip[data-model]').forEach(chip => {
      chip.style.display = chip.dataset.model.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  // Engine picker (built-in Hermes agents)
  document.querySelectorAll('.agent-engine-select').forEach(sel => {
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', async e => {
      e.stopPropagation();
      const profileId = sel.dataset.profileId;
      const engine = sel.value;
      try {
        await Api.setConfig({ agentEngines: { [profileId]: engine } });
        _agents = _agents.map(a => a.id === profileId ? { ...a, engine } : a);
        showToast(`${profileId} → ${engine}`, 'success');
      } catch (err) {
        showToast(`Nepavyko nustatyti: ${err.message}`, 'error');
      }
    });
  });

  // Delete buttons (custom agents)
  document.querySelectorAll('.agent-delete-btn[data-agent-id]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.agentId;
      const agent = _agents.find(a => a.id === id);
      if (!confirm(`Ištrinti "${agent?.name}"?`)) return;
      await _deleteAgent(id);
      EventBus.emit('navigate', 'agents');
    });
  });

  // Card click → profile
  document.querySelectorAll('.agent-card[data-agent-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.agent-engine-select') || e.target.closest('.agent-delete-btn')) return;
      _selectedId = card.dataset.agentId;
      EventBus.emit('navigate', 'agents');
    });
  });

  // Load data on first mount
  if (!_agents.length) _loadAndPaint();
}

// ─── Async load ───────────────────────────────────

async function _loadAndPaint() {
  _loading = true;

  try {
    const [agentsRes, modelsRes, cfg] = await Promise.allSettled([
      Api.getAgents(),
      Api.getModels(),
      Api.getConfig(),
    ]);
    if (agentsRes.status === 'fulfilled') {
      _agents = agentsRes.value.agents || [];
      _engines = agentsRes.value.engines || ['glm'];
    }
    _models = modelsRes.status === 'fulfilled' ? (modelsRes.value.models || []) : [];
    _tuning = cfg.status === 'fulfilled' ? (cfg.value.agentTuning || {}) : {};
    _catalogue = cfg.status === 'fulfilled' ? (cfg.value.availableModels || []) : [];
  } catch (err) {
    showToast(`Nepavyko užkrauti agentų: ${err.message}`, 'error');
    _agents = [];
  }

  _loading = false;
  EventBus.emit('navigate', 'agents');
}

// ─── CRUD helpers ─────────────────────────────────

async function _deleteAgent(id) {
  try {
    await Api.deleteAgent(id);
    _agents = _agents.filter(a => a.id !== id);
    showToast('Agentas ištrintas', 'success');
  } catch (err) {
    showToast(`Klaida trinant: ${err.message}`, 'error');
  }
}

async function _saveTuning(id) {
  const agent = _agents.find(a => a.id === id);
  const isMeta = agent && agent.role !== 'worker';
  const model = document.getElementById('tune-model')?.value ?? '';
  const temperature = Number(document.getElementById('tune-temp')?.value);

  const patch = { model, temperature };
  if (isMeta) {
    // Single persona for meta agents. The box is pre-filled with the default, so
    // only store an override when it actually differs (else clear it).
    const v = (document.getElementById('tune-persona')?.value ?? '').trim();
    const def = (agent?.description || '').trim();
    patch.persona = (v && v !== def) ? v : '';
  } else {
    // Per-step overrides — only persist steps that differ from the default.
    const defs = agent?.stepPersonas || {};
    const steps = {};
    document.querySelectorAll('.tune-step[data-sub]').forEach(ta => {
      const sub = ta.dataset.sub;
      const val = (ta.value || '').trim();
      const def = (defs[sub] || '').trim();
      if (val && val !== def) steps[sub] = val;
    });
    patch.steps = steps; // {} clears all step overrides server-side
  }

  const btn = document.getElementById('btn-save-tuning');
  if (btn) { btn.disabled = true; btn.textContent = 'Saugoma…'; }
  try {
    const cfg = await Api.setConfig({ agentTuning: { [id]: patch } });
    _tuning = cfg.agentTuning || {};
    showToast('Derinimas išsaugotas', 'success');
    EventBus.emit('navigate', 'agents');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Išsaugoti derinimą'; }
    showToast(`Klaida: ${err.message}`, 'error');
  }
}

async function _syncOpenRouter() {
  const btn = document.getElementById('btn-sync-openrouter');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Sinchronizuojama…'; }
  try {
    const res = await Api.getOpenRouterModels();
    const models = res.models || [];
    if (!models.length) throw new Error('OpenRouter grąžino tuščią sąrašą');
    await _saveCatalogue(models);
    showToast(`Įtraukta ${models.length} modelių iš OpenRouter`, 'success');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync iš OpenRouter'; }
    showToast(`Sync nepavyko: ${err.message}`, 'error');
  }
}

async function _saveCatalogue(list) {
  try {
    const cfg = await Api.setConfig({ availableModels: list });
    _catalogue = cfg.availableModels || list;          // raw stored list
    // Refresh the dropdown source (union incl. active glm/judge models).
    try { _models = (await Api.getModels()).models || _catalogue; } catch { _models = _catalogue; }
    invalidateModelsCache(); // so per-task pickers in engine views re-fetch
    showToast('Modelių katalogas atnaujintas', 'success');
    EventBus.emit('navigate', 'agents');
  } catch (err) {
    showToast(`Klaida: ${err.message}`, 'error');
  }
}

async function _resetTuning(id) {
  try {
    // null removes all overrides for this profile.
    const cfg = await Api.setConfig({ agentTuning: { [id]: null } });
    _tuning = cfg.agentTuning || {};
    showToast('Atstatyti numatytieji nustatymai', 'success');
    EventBus.emit('navigate', 'agents');
  } catch (err) {
    showToast(`Klaida: ${err.message}`, 'error');
  }
}

function _openCreateModal() {
  const typeOpts = ['coding', 'trading', 'creation']
    .map(t => `<option value="${t}">${t}</option>`).join('');

  openModal({
    title: 'Registruoti Naują Agentą',
    content: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4);">
        <div>
          <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:600;">Pavadinimas *</label>
          <input id="inp-agent-name" type="text" placeholder="pvz. DataMiner"
            style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);">
        </div>
        <div>
          <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:600;">Tipas</label>
          <select id="inp-agent-type" style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);">
            ${typeOpts}
          </select>
        </div>
        <div>
          <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:600;">Aprašymas</label>
          <textarea id="inp-agent-desc" placeholder="Trumpai apibūdinkite agento galimybes..."
            style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);min-height:72px;resize:vertical;"></textarea>
        </div>
        <div>
          <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:600;">Gebėjimai (per kablelį)</label>
          <input id="inp-agent-caps" type="text" placeholder="pvz. Code Review, Testing"
            style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);">
        </div>
      </div>
    `,
    actions: `
      <button class="btn btn--secondary" id="btn-cancel-agent">Atšaukti</button>
      <button class="btn btn--primary" id="btn-save-agent">Sukurti Agentą</button>
    `,
  });

  requestAnimationFrame(() => {
    document.getElementById('btn-cancel-agent')?.addEventListener('click', closeModal);
    document.getElementById('inp-agent-name')?.focus();

    document.getElementById('btn-save-agent')?.addEventListener('click', async () => {
      const name = document.getElementById('inp-agent-name')?.value.trim();
      const type = document.getElementById('inp-agent-type')?.value;
      const desc = document.getElementById('inp-agent-desc')?.value.trim();
      const capsRaw = document.getElementById('inp-agent-caps')?.value.trim();
      const capabilities = capsRaw
        ? capsRaw.split(',').map(s => s.trim()).filter(Boolean)
        : ['Custom'];

      if (!name) { showToast('Pavadinimas būtinas', 'error'); return; }

      const btn = document.getElementById('btn-save-agent');
      btn.disabled = true;
      btn.textContent = 'Kuriama…';

      try {
        const res = await Api.createAgent({ name, type, description: desc, capabilities });
        _agents.push(res.agent);
        closeModal();
        showToast(`Agentas "${name}" sukurtas!`, 'success');
        EventBus.emit('navigate', 'agents');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Sukurti Agentą';
        showToast(`Klaida: ${err.message}`, 'error');
      }
    });
  });
}
