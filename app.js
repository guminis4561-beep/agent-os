// ═══════════════════════════════════════════════════
// APP.JS – Application Bootstrap & Routing
// ═══════════════════════════════════════════════════

import AppState from './core/state.js';
import Router from './core/router.js';
import EventBus from './core/events.js';
import TaskRunner from './core/live-runner.js';
import * as Api from './core/api-client.js';

import { renderSidebar } from './components/sidebar.js';
import { renderTopbar } from './components/topbar.js';
import { renderInspector } from './components/inspector.js';
import { renderCanvas } from './components/canvas.js';
import { initCommandPalette } from './components/modal.js';

import { renderDashboard, initDashboardEvents } from './domains/dashboard/dashboard-view.js';
import { renderWorkspaces, initWorkspaceEvents } from './domains/workspace/workspace-view.js';
import { renderWorkflows, initWorkflowEvents } from './domains/workflow/workflow-view.js';
import { renderAgents, initAgentEvents } from './domains/agents/agents-view.js';
import { renderMemory, initMemoryEvents } from './domains/memory/memory-view.js';
import { renderCodingEngine, initCodingEvents } from './domains/engines/coding-engine.js';
import { renderTradingEngine, initTradingEvents } from './domains/engines/trading-engine.js';
import { renderCreationEngine, initCreationEvents } from './domains/engines/creation-engine.js';
import { renderTaskExecution, initTaskExecutionEvents } from './domains/workflow/task-execution-view.js';
import { renderSessions, initSessionsEvents } from './domains/sessions/sessions-view.js';
import { renderChat, initChatEvents } from './domains/chat/chat-view.js';

// ═══════════════════════════════
// VIEW REGISTRY
// ═══════════════════════════════
const VIEWS = {
  dashboard:  { render: renderDashboard, init: initDashboardEvents },
  workspaces: { render: renderWorkspaces, init: initWorkspaceEvents },
  workflows:  { render: renderWorkflows, init: initWorkflowEvents },
  agents:     { render: renderAgents, init: initAgentEvents },
  memory:     { render: renderMemory, init: initMemoryEvents },
  coding:     { render: renderCodingEngine, init: initCodingEvents },
  trading:    { render: renderTradingEngine, init: initTradingEvents },
  creation:   { render: renderCreationEngine, init: initCreationEvents },
  'task-execution': { render: renderTaskExecution, init: initTaskExecutionEvents },
  engines:    { render: renderCodingEngine, init: initCodingEvents },
  sessions:   { render: renderSessions, init: initSessionsEvents },
  chat:       { render: renderChat, init: initChatEvents },
  settings:   { render: renderSettings, init: initSettingsEvents },
};

// ═══════════════════════════════
// SETTINGS PLACEHOLDER VIEW
// ═══════════════════════════════
function renderSettings() {
  return `
    <div>
      <div class="section-header">
        <div class="section-header__left">
          <div class="section-header__icon">⚙</div>
          <div>
            <h2 class="section-header__title">Settings</h2>
            <p class="section-header__subtitle">Configure your AI workspace</p>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__header">
          <div class="card__title">General</div>
        </div>
        <div class="card__body">
          <div class="inspector__property">
            <span class="inspector__prop-label">Theme</span>
            <span class="inspector__prop-value">Dark (Default)</span>
          </div>
          <div class="inspector__property">
            <span class="inspector__prop-label">Language</span>
            <span class="inspector__prop-value">English</span>
          </div>
          <div class="inspector__property">
            <span class="inspector__prop-label">Notifications</span>
            <span class="inspector__prop-value">Enabled</span>
          </div>
          <div class="inspector__property">
            <span class="inspector__prop-label">Auto-save</span>
            <span class="inspector__prop-value">Every 30s</span>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__header">
          <div class="card__title">Engine (GLM 5.2)</div>
          <span id="settings-engine-status" style="font-size:var(--text-xs);color:var(--text-muted);">Loading…</span>
        </div>
        <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-3);">
          <label style="display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);">
            <span class="inspector__prop-label">Model ID</span>
            <input id="cfg-model" class="input" type="text" placeholder="glm-5.2"
              style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-family:var(--font-mono);">
          </label>
          <label style="display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);">
            <span class="inspector__prop-label">Base URL</span>
            <input id="cfg-base-url" class="input" type="text" placeholder="https://api.z.ai/api/paas/v4"
              style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-family:var(--font-mono);">
          </label>
          <label style="display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);">
            <span class="inspector__prop-label">API Key</span>
            <input id="cfg-api-key" class="input" type="password" placeholder="paste key to set (leave blank to keep current)"
              style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-family:var(--font-mono);">
          </label>
          <div style="display:flex;gap:var(--space-3);">
            <label style="display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);flex:1;">
              <span class="inspector__prop-label">Quality threshold</span>
              <input id="cfg-threshold" class="input" type="number" min="0" max="100"
                style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);">
            </label>
            <label style="display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);flex:1;">
              <span class="inspector__prop-label">Max reworks</span>
              <input id="cfg-max-reworks" class="input" type="number" min="0" max="10"
                style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);">
            </label>
          </div>
          <div style="display:flex;gap:var(--space-3);align-items:center;margin-top:var(--space-2);">
            <button class="btn btn--primary" id="btn-save-config">Save</button>
            <button class="btn btn--secondary" id="btn-test-engine">Test engine</button>
            <span id="settings-test-result" style="font-size:var(--text-sm);color:var(--text-muted);"></span>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__header">
          <div class="card__title">Engines (Hermes & others)</div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">Add a second model for per-agent routing</span>
        </div>
        <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-3);">
          <div id="engines-list" style="display:flex;flex-direction:column;gap:var(--space-2);">
            <div style="color:var(--text-muted);font-size:var(--text-sm);">Loading…</div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);">
            <div style="font-size:var(--text-sm);color:var(--text-secondary);">Add / update engine</div>
            <input id="eng-name" class="input" type="text" placeholder="name (e.g. hermes)"
              style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);">
            <input id="eng-base-url" class="input" type="text" placeholder="base URL (e.g. https://openrouter.ai/api/v1)"
              style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-family:var(--font-mono);">
            <input id="eng-model" class="input" type="text" placeholder="model id (e.g. nousresearch/hermes-3-llama-3.1-70b)"
              style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-family:var(--font-mono);">
            <input id="eng-api-key" class="input" type="password" placeholder="API key (blank = reuse GLM key)"
              style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-family:var(--font-mono);">
            <div style="display:flex;gap:var(--space-3);align-items:center;">
              <button class="btn btn--primary" id="btn-add-engine">Add engine</button>
              <span id="engine-add-result" style="font-size:var(--text-sm);color:var(--text-muted);"></span>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__header">
          <div class="card__title">System</div>
        </div>
        <div class="card__body">
          <div class="inspector__property">
            <span class="inspector__prop-label">Version</span>
            <span class="inspector__prop-value">Agent OS v0.1.0</span>
          </div>
          <div class="inspector__property">
            <span class="inspector__prop-label">Build</span>
            <span class="inspector__prop-value">2026.06.19</span>
          </div>
          <div class="inspector__property">
            <span class="inspector__prop-label">Runtime</span>
            <span class="inspector__prop-value">Browser (Chrome 128)</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════
// AGENT REGISTRY (load real Hermes profiles from server)
// ═══════════════════════════════
function _engineColor(type) {
  return type === 'coding' ? 'var(--coding-accent)'
    : type === 'trading' ? 'var(--trading-accent)'
    : type === 'creation' ? 'var(--creation-accent)'
    : 'var(--accent-primary)';
}

async function loadAgentRegistry() {
  let data;
  try {
    data = await Api.getAgents();
  } catch (err) {
    console.warn('[Agent OS] Registry load failed, keeping local agents:', err.message);
    return;
  }
  const profiles = data.agents || [];
  AppState.setState('engines', data.engines || ['glm']);
  if (!profiles.length) return;

  const existing = AppState.getState('agents') || [];
  const byName = new Map(existing.map((a) => [a.name, a]));

  const merged = profiles.map((p) => {
    const prev = byName.get(p.name) || {};
    byName.delete(p.name);
    return {
      ...prev,
      id: prev.id || p.id,
      name: p.name,
      type: p.type,
      status: 'active',
      description: p.description || prev.description || '',
      capabilities: p.capabilities || prev.capabilities || [],
      allowedTools: (p.steps && p.steps.length ? p.steps : prev.allowedTools) || ['GLM 5.2'],
      model: p.engine === 'glm' ? 'glm-5.2' : `${p.engine}`,
      engine: p.engine,
      defaultEngine: p.defaultEngine || 'glm',
      profileId: p.id,
      icon: p.icon || prev.icon || '⬡',
      color: _engineColor(p.type),
      runsToday: prev.runsToday ?? 0,
      successRate: prev.successRate ?? 100,
      avgLatency: prev.avgLatency || '—',
      serverBacked: true,
    };
  });

  // Keep any local-only agents (e.g. user-registered) that the server doesn't define.
  const leftovers = Array.from(byName.values());
  AppState.setState('agents', [...merged, ...leftovers]);
}

// ═══════════════════════════════
// SETTINGS EVENTS (wire to /api/config + engine test)
// ═══════════════════════════════
function initSettingsEvents() {
  const $ = (id) => document.getElementById(id);
  const status = $('settings-engine-status');
  const testOut = $('settings-test-result');

  const renderEnginesList = (engines) => {
    const host = $('engines-list');
    if (!host) return;
    const names = Object.keys(engines || {});
    if (!names.length) {
      host.innerHTML = '<div style="color:var(--text-muted);font-size:var(--text-sm);">Only the built-in GLM engine. Add one below to route specific agents elsewhere.</div>';
      return;
    }
    host.innerHTML = names.map((name) => {
      const e = engines[name];
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);background:var(--bg-elevated);padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);">
        <div style="min-width:0;">
          <div style="font-weight:var(--weight-semibold);">${name}</div>
          <div style="font-size:var(--text-xs);color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;">${e.model || '—'} · ${e.hasApiKey ? 'key set' : 'uses GLM key'}</div>
        </div>
        <button class="btn btn--ghost" data-remove-engine="${name}" title="Remove" style="color:var(--danger,#f85149);">✕</button>
      </div>`;
    }).join('');
    host.querySelectorAll('[data-remove-engine]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.removeEngine;
        try {
          const cfg = await Api.setConfig({ engines: { [name]: null } });
          renderEnginesList(cfg.engines);
        } catch (err) { if (status) status.textContent = `Remove failed: ${err.message}`; }
      });
    });
  };

  Api.getConfig()
    .then((cfg) => {
      if ($('cfg-model')) $('cfg-model').value = cfg.glmModel || '';
      if ($('cfg-base-url')) $('cfg-base-url').value = cfg.glmBaseUrl || '';
      if ($('cfg-threshold')) $('cfg-threshold').value = cfg.qualityThreshold ?? 75;
      if ($('cfg-max-reworks')) $('cfg-max-reworks').value = cfg.maxReworks ?? 3;
      if (status) {
        status.textContent = cfg.hasApiKey ? 'API key set ✓' : 'No API key — set one below';
        status.style.color = cfg.hasApiKey ? 'var(--success, #3fb950)' : 'var(--warning, #d29922)';
      }
      renderEnginesList(cfg.engines);
    })
    .catch((err) => { if (status) status.textContent = `Config error: ${err.message}`; });

  $('btn-add-engine')?.addEventListener('click', async () => {
    const out = $('engine-add-result');
    const name = $('eng-name')?.value.trim();
    if (!name) { if (out) out.textContent = 'Name is required'; return; }
    if (name === 'glm' || name === 'default') { if (out) out.textContent = '"glm" is reserved'; return; }
    const def = {
      baseUrl: $('eng-base-url')?.value.trim() || '',
      model: $('eng-model')?.value.trim() || '',
      apiKey: $('eng-api-key')?.value.trim() || '',
    };
    try {
      const cfg = await Api.setConfig({ engines: { [name]: def } });
      ['eng-name', 'eng-base-url', 'eng-model', 'eng-api-key'].forEach((id) => { if ($(id)) $(id).value = ''; });
      if (out) { out.textContent = `Saved "${name}"`; out.style.color = 'var(--success, #3fb950)'; }
      renderEnginesList(cfg.engines);
    } catch (err) {
      if (out) { out.textContent = `Failed: ${err.message}`; out.style.color = 'var(--danger, #f85149)'; }
    }
  });

  $('btn-save-config')?.addEventListener('click', async () => {
    const patch = {
      glmModel: $('cfg-model')?.value.trim() || undefined,
      glmBaseUrl: $('cfg-base-url')?.value.trim() || undefined,
      qualityThreshold: Number($('cfg-threshold')?.value) || undefined,
      maxReworks: Number($('cfg-max-reworks')?.value),
    };
    const key = $('cfg-api-key')?.value.trim();
    if (key) patch.glmApiKey = key;
    try {
      const cfg = await Api.setConfig(patch);
      if ($('cfg-api-key')) $('cfg-api-key').value = '';
      if (status) {
        status.textContent = cfg.hasApiKey ? 'Saved · API key set ✓' : 'Saved · no API key';
        status.style.color = cfg.hasApiKey ? 'var(--success, #3fb950)' : 'var(--warning, #d29922)';
      }
    } catch (err) {
      if (status) status.textContent = `Save failed: ${err.message}`;
    }
  });

  $('btn-test-engine')?.addEventListener('click', async () => {
    if (testOut) { testOut.textContent = 'Testing…'; testOut.style.color = 'var(--text-muted)'; }
    try {
      const res = await Api.testEngine('Reply with the single word: ok');
      if (testOut) {
        testOut.textContent = `OK · ${res.model}: "${(res.text || '').slice(0, 60)}"`;
        testOut.style.color = 'var(--success, #3fb950)';
      }
    } catch (err) {
      if (testOut) {
        testOut.textContent = `Failed: ${err.message}`;
        testOut.style.color = 'var(--danger, #f85149)';
      }
    }
  });
}

// ═══════════════════════════════
// NAVIGATION HANDLER
// ═══════════════════════════════
let _suppressHashChange = false;

const _motionOK = () => {
  try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return true; }
};

function navigateTo(route) {
  const view = VIEWS[route];
  if (!view) {
    console.warn(`[App] Unknown route: ${route}`);
    navigateTo('dashboard');
    return;
  }

  // Update state
  AppState.setState('activeView', route);

  // Update hash — suppress the resulting hashchange so we don't re-render twice
  if (window.location.hash !== `#/${route}`) {
    _suppressHashChange = true;
    window.location.hash = `#/${route}`;
  }

  const swapDom = () => renderCanvas(view.render());
  const afterSwap = () => {
    requestAnimationFrame(() => view.init());
    renderInspector();
  };

  // Animate the content swap with the native View Transitions API when available
  // (only the content area animates; the sidebar/topbar stay put — see index.css).
  if (typeof document.startViewTransition === 'function' && _motionOK()) {
    const t = document.startViewTransition(swapDom);
    t.updateCallbackDone.then(afterSwap).catch(afterSwap);
  } else {
    swapDom();
    afterSwap();
  }
}

// ═══════════════════════════════
// STATUS BAR
// ═══════════════════════════════
function renderStatusBar() {
  const statusbar = document.getElementById('statusbar');
  if (!statusbar) return;

  // Get current FSM task state
  const task = AppState.getState('taskExecution');
  let fsmIndicator = '';
  if (task) {
    const stateClass = task.state === 'COMPLETED' ? 'completed'
      : task.state === 'FAILED' ? 'failed'
      : task.state === 'RECOVERY' || task.state === 'HUMAN_REVIEW' ? 'recovery'
      : 'active';
    fsmIndicator = `
      <div class="statusbar__item">
        <span class="statusbar__fsm-state statusbar__fsm-state--${stateClass}">
          ⚙ ${task.state}${task.subState ? ' › ' + task.subState : ''}
        </span>
      </div>
    `;
  }

  statusbar.innerHTML = `
    <div class="statusbar__left">
      <div class="statusbar__item">
        <span class="statusbar__dot statusbar__dot--success"></span>
        <span>System Online</span>
      </div>
      <div class="statusbar__item">
        <span>⬡ ${(AppState.getState('agents') || []).filter(a => a.status === 'active').length} agents active</span>
      </div>
      <div class="statusbar__item">
        <span>⚡ 3 workflows running</span>
      </div>
      ${fsmIndicator}
    </div>
    <div class="statusbar__right">
      <div class="statusbar__item">
        <span>Memory: 1.36 GB</span>
      </div>
      <div class="statusbar__item">
        <span>Tokens: 12,847 / 128K</span>
      </div>
      <div class="statusbar__item">
        <span>${new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  `;
}

// ═══════════════════════════════
// APP INITIALIZATION
// ═══════════════════════════════
function initApp() {
  console.log('[Agent OS] Initializing...');
  
  // Set theme
  document.documentElement.setAttribute('data-theme', AppState.getState('theme'));
  AppState.subscribe('theme', (t) => document.documentElement.setAttribute('data-theme', t));

  // Initialize Task Runner (FSM orchestrator)
  TaskRunner.init();

  // Load the real Hermes agent registry from the server (async, non-blocking).
  loadAgentRegistry();

  // Render static layout components
  renderTopbar();
  renderSidebar();
  renderInspector();
  renderStatusBar();
  initCommandPalette();
  
  // Listen for navigation events
  EventBus.on('navigate', (route) => {
    navigateTo(route);
  });
  
  // Hash-based routing — skip if we just set the hash ourselves
  function handleHash() {
    if (_suppressHashChange) { _suppressHashChange = false; return; }
    const hash = window.location.hash.slice(2) || 'dashboard';
    if (hash === AppState.getState('activeView')) return;
    navigateTo(hash);
  }

  window.addEventListener('hashchange', handleHash);
  
  // Initial route
  handleHash();
  
  // Update clock every second
  setInterval(() => {
    const timeEl = document.querySelector('.statusbar__right .statusbar__item:last-child span');
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
  }, 1000);
  
  // Update status bar when FSM state changes
  EventBus.on('task:stateChange', () => renderStatusBar());
  EventBus.on('task:subStateChange', () => renderStatusBar());
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+I: Toggle inspector
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      const isOpen = AppState.getState('inspectorOpen');
      AppState.setState('inspectorOpen', !isOpen);
      document.getElementById('app').classList.toggle('inspector-collapsed', isOpen);
    }
  });
  
  console.log('[Agent OS] Ready ✓');
}

// ═══════════════════════════════
// BOOT
// ═══════════════════════════════
document.addEventListener('DOMContentLoaded', initApp);
