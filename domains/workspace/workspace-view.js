// ═══════════════════════════════════════════════════
// DOMAIN: Workspace Manager + View
// ═══════════════════════════════════════════════════

import AppState from '../../core/state.js';
import EventBus from '../../core/events.js';
import { showToast } from '../../components/toast.js';
import * as Api from '../../core/api-client.js';

// ── Module state ──────────────────────────────────────
let _stats = {};      // { [wsId]: { tasks, memItems } }
let _totalMem = 0;
let _defaultModel = '';  // active default model (shown per workspace)
let _loading = false;
let _loadPromise = null;  // guard — prevents re-entrant calls during fetch

// ── Data loading ──────────────────────────────────────
function _loadStats() {
  if (_loadPromise) return _loadPromise;
  _loading = true;
  _loadPromise = (async () => {
    try {
      const [tasksRes, memCounts, healthRes] = await Promise.all([
        Api.getTasks(),
        Api.getMemoryWorkspaceSummary(),
        Api.getHealth().catch(() => null),
      ]);

      const tasks = tasksRes?.tasks ?? [];
      _totalMem = memCounts.__total__ ?? 0;
      _defaultModel = healthRes?.model || '';

      const workspaces = AppState.getState('workspaces') || [];
      _stats = {};
      for (const ws of workspaces) {
        const wsTasks = tasks.filter(t => (t.workspaceId || '') === ws.id).length;
        const wsMem   = memCounts[ws.id] ?? 0;
        _stats[ws.id] = { tasks: wsTasks, memItems: wsMem };
      }
    } catch {
      // silently degrade — stats stay at 0
    }

    _loading = false;
    EventBus.emit('navigate', 'workspaces');  // single repaint after data ready
  })();
  _loadPromise.finally(() => { _loadPromise = null; });
  return _loadPromise;
}

// ── Render ─────────────────────────────────────────────
export function renderWorkspaces() {
  const activeWs = AppState.getState('activeWorkspace');
  const workspaces = AppState.getState('workspaces') || [];

  return `
    <div>
      <div class="section-header">
        <div class="section-header__left">
          <div class="section-header__icon">◫</div>
          <div>
            <h2 class="section-header__title">Workspaces</h2>
            <p class="section-header__subtitle">Manage your isolated AI environments</p>
          </div>
        </div>
        <div class="section-header__actions">
          <button class="btn btn--primary" id="btn-create-workspace">＋ New Workspace</button>
        </div>
      </div>

      <div class="workspace-grid">
        ${workspaces.map(ws => _renderCard(ws, activeWs)).join('')}

        <div class="workspace-card" style="border-style:dashed;display:flex;align-items:center;justify-content:center;min-height:220px;cursor:pointer;" id="ws-create-card">
          <div class="empty-state" style="padding:var(--space-4);">
            <div class="empty-state__icon">＋</div>
            <div class="empty-state__title" style="font-size:var(--text-md);">Create Workspace</div>
            <div class="empty-state__desc" style="margin-bottom:0;">Start a new isolated AI environment</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Workspace Modal -->
    <div class="modal-overlay hidden" id="modal-create-ws">
      <div class="modal">
        <div class="modal__header">
          <div class="modal__title">Create New Workspace</div>
          <button class="modal__close" id="btn-close-ws-modal">✕</button>
        </div>
        <div class="modal__body">
          <div style="margin-bottom:var(--space-4);">
            <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--text-primary);">Workspace Name</label>
            <input type="text" id="input-ws-name" placeholder="e.g. Finance Analytics" style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);">
          </div>
          <div>
            <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--text-primary);">Description</label>
            <textarea id="input-ws-desc" placeholder="Briefly describe the purpose..." style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);min-height:80px;resize:vertical;"></textarea>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--secondary" id="btn-cancel-ws">Cancel</button>
          <button class="btn btn--primary" id="btn-save-ws">Create Workspace</button>
        </div>
      </div>
    </div>
  `;
}

function _renderCard(ws, activeWs) {
  const st = _stats[ws.id];
  const tasks    = st ? st.tasks   : '—';
  const memItems = st ? st.memItems : '—';
  const memPct   = (st && _totalMem > 0) ? Math.round((st.memItems / _totalMem) * 100) : 0;
  const barWidth = _loading ? 0 : memPct;

  return `
    <div class="workspace-card ${ws.id === activeWs ? 'active' : ''}" data-ws-id="${ws.id}" style="position:relative;">
      ${ws.id === activeWs ? '<span class="badge badge--accent" style="position:absolute;top:var(--space-3);right:var(--space-3);">Active</span>' : ''}
      <div class="workspace-card__header">
        <div class="workspace-card__icon">${ws.icon}</div>
        <div>
          <div class="workspace-card__name">${ws.name}</div>
        </div>
      </div>
      <p class="workspace-card__desc">${ws.description}</p>

      <div style="margin-bottom:var(--space-4);">
        <div style="display:flex;justify-content:space-between;margin-bottom:var(--space-1);">
          <span style="font-size:var(--text-xs);color:var(--text-secondary);">Memory Usage</span>
          <span style="font-size:var(--text-xs);font-weight:600;">
            ${_loading ? '…' : (memItems === 0 ? '0 items' : `${memItems} items (${memPct}%)`)}
          </span>
        </div>
        <div class="progress">
          <div class="progress__bar" style="width:${barWidth}%;transition:width .4s ease;"></div>
        </div>
      </div>

      <div style="margin-bottom:var(--space-3);display:flex;align-items:center;gap:6px;">
        <span style="font-size:var(--text-xs);color:var(--text-secondary);">🤖 Modelis:</span>
        <span class="badge badge--outline" style="font-family:var(--font-mono);font-size:10px;" title="Numatytasis modelis šios erdvės užduotims">${_loading ? '…' : (_defaultModel || '—')}</span>
      </div>

      <div class="workspace-card__stats">
        <div class="workspace-card__stat">
          <span>⚡</span>
          <span>${_loading ? '…' : tasks} tasks</span>
        </div>
        <div class="workspace-card__stat">
          <span>🧠</span>
          <span>${_loading ? '…' : memItems} memories</span>
        </div>
        <div class="workspace-card__stat">
          <span>📅</span>
          <span>${ws.createdAt}</span>
        </div>
      </div>
    </div>
  `;
}

// ── Events ─────────────────────────────────────────────
export function initWorkspaceEvents() {
  const workspaces = AppState.getState('workspaces') || [];

  // Load real stats once per mount — guard prevents loop during fetch
  if (!_loadPromise && Object.keys(_stats).length === 0) {
    _loadStats();
  }

  // Card click → switch active workspace
  document.querySelectorAll('.workspace-card[data-ws-id]').forEach(card => {
    card.addEventListener('click', () => {
      const wsId = card.dataset.wsId;
      AppState.setState('activeWorkspace', wsId);
      showToast(`Switched to workspace: ${workspaces.find(w => w.id === wsId)?.name}`, 'success');
      EventBus.emit('navigate', 'workspaces');
    });
  });

  // Modal wiring
  const modal     = document.getElementById('modal-create-ws');
  const btnCreate = document.getElementById('btn-create-workspace');
  const cardCreate = document.getElementById('ws-create-card');
  const btnClose  = document.getElementById('btn-close-ws-modal');
  const btnCancel = document.getElementById('btn-cancel-ws');
  const btnSave   = document.getElementById('btn-save-ws');
  const inputName = document.getElementById('input-ws-name');
  const inputDesc = document.getElementById('input-ws-desc');

  const openModal  = () => { modal.classList.remove('hidden'); inputName.focus(); };
  const closeModal = () => { modal.classList.add('hidden'); inputName.value = ''; inputDesc.value = ''; };

  btnCreate?.addEventListener('click', openModal);
  cardCreate?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);
  btnCancel?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  btnSave?.addEventListener('click', () => {
    const name = inputName.value.trim();
    const desc = inputDesc.value.trim();
    if (!name) { showToast('Workspace name is required', 'error'); return; }

    const newWs = {
      id: `ws-${Date.now()}`,
      name,
      description: desc || 'Custom user workspace',
      icon: '✨',
      createdAt: new Date().toISOString().split('T')[0],
    };

    AppState.batchUpdate({
      workspaces: [...workspaces, newWs],
      activeWorkspace: newWs.id,
    });

    // Reset stats cache so new workspace gets counted
    _stats = {};
    _loadPromise = null;

    closeModal();
    showToast(`Workspace "${name}" created!`, 'success');
    _loadStats();
  });
}
