// ═══════════════════════════════════════════════════
// DOMAIN: Workflow Orchestrator + Canvas + View
// ═══════════════════════════════════════════════════

import AppState from '../../core/state.js';
import EventBus from '../../core/events.js';
import { TASK_STATES } from '../../core/state-machine.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal } from '../../components/modal.js';
import * as Api from '../../core/api-client.js';

let activeWorkflowId = null;
let viewMode = 'list'; // 'list' or 'canvas'

// ── Real task data ─────────────────────────────────────
let _tasks = [];
let _loading = false;
let _loadPromise = null;   // guard against concurrent / recursive loads
let _hasLoaded = false;    // true after first successful fetch — prevents empty-array loop
let _sseUnsub = null;      // single SSE subscription for this view

const ENGINE_META = {
  coding:   { icon: '💻', name: 'Coding Engine',   desc: 'Workspace code generation & editing' },
  trading:  { icon: '📈', name: 'Trading Engine',  desc: 'Market analysis & strategy execution' },
  creation: { icon: '✍️',  name: 'Creation Engine', desc: 'AI content generation pipeline' },
  general:  { icon: '⚡', name: 'General Tasks',   desc: 'Multi-purpose agent workflows' },
};

function _loadTasks() {
  if (_loadPromise) return _loadPromise;   // already in flight — don't double-fetch
  _loading = true;
  _loadPromise = Api.getTasks()
    .then(res  => { _tasks = res?.tasks ?? []; })
    .catch(()  => { _tasks = []; })
    .finally(() => {
      _loading = false;
      _loadPromise = null;
      _hasLoaded = true;
      EventBus.emit('navigate', 'workflows');  // single repaint after data is ready
    });
  return _loadPromise;
}

/** Group tasks by domainEngine → aggregate stats per workflow. */
function _buildWorkflows() {
  const groups = {};
  for (const t of _tasks) {
    const key = t.domainEngine || 'general';
    if (!groups[key]) groups[key] = { engine: key, tasks: [] };
    groups[key].tasks.push(t);
  }
  return Object.values(groups).map(g => {
    const total  = g.tasks.length;
    const done   = g.tasks.filter(t => t.state === 'COMPLETED').length;
    const failed = g.tasks.filter(t => t.state === 'FAILED').length;
    const running = g.tasks.filter(t => !['COMPLETED','FAILED','CANCELLED'].includes(t.state)).length;
    const last   = g.tasks.slice().sort((a, b) => (b.startedAt||0) - (a.startedAt||0))[0];
    const meta   = ENGINE_META[g.engine] || ENGINE_META.general;
    return {
      id: g.engine,
      ...meta,
      runs: total,
      successRate: total > 0 ? Math.round((done / total) * 100) : 0,
      running,
      failed,
      lastTask: last,
      allTasks: g.tasks.slice().sort((a, b) => (b.startedAt||0) - (a.startedAt||0)),
    };
  }).sort((a, b) => b.runs - a.runs);
}

export function renderWorkflows() {
  return `
    <div>
      <div class="section-header">
        <div class="section-header__left">
          <div class="section-header__icon" style="background:rgba(0,210,255,0.12);">⚡</div>
          <div>
            <h2 class="section-header__title">Workflow Orchestrator</h2>
            <p class="section-header__subtitle">Build, run, and monitor your agentic workflows</p>
          </div>
        </div>
        <div class="section-header__actions">
          <div class="tabs" style="margin-right:var(--space-3);">
            <div class="tab ${viewMode === 'list' ? 'active' : ''}" data-view="list">List</div>
            <div class="tab ${viewMode === 'canvas' ? 'active' : ''}" data-view="canvas">Canvas</div>
          </div>
          <button class="btn btn--primary" id="btn-new-workflow">
            ＋ New Workflow
          </button>
        </div>
      </div>

      ${renderFSMStatusBar()}
      ${_loading
        ? '<div class="empty-state" style="padding:var(--space-8);"><div class="empty-state__icon">⏳</div><div class="empty-state__title">Kraunama…</div></div>'
        : viewMode === 'list' ? renderWorkflowList() : renderWorkflowCanvas()
      }
    </div>
  `;
}

function renderFSMStatusBar() {
  const task = AppState.getState('taskExecution');
  if (!task) return '';

  const states = ['IDLE', 'INTENT_CAPTURED', 'PLANNING', 'ROUTING', 'EXECUTING', 'VALIDATING', 'PERSISTING', 'COMPLETED'];
  const shortLabels = { IDLE: 'Idle', INTENT_CAPTURED: 'Intent', PLANNING: 'Plan', ROUTING: 'Route', EXECUTING: 'Exec', VALIDATING: 'Valid', PERSISTING: 'Save', COMPLETED: 'Done' };
  const currentIdx = states.indexOf(task.state);
  const isFailed = task.state === 'FAILED' || task.state === 'RECOVERY' || task.state === 'HUMAN_REVIEW';

  return `
    <div class="fsm-pipeline" style="margin-bottom:var(--space-4);padding:var(--space-3) var(--space-4);">
      ${states.map((s, i) => {
        let cls = '';
        if (i < currentIdx) cls = 'fsm-state--completed';
        else if (i === currentIdx && !isFailed) cls = task.state === 'COMPLETED' ? 'fsm-state--completed' : 'fsm-state--active';

        const connCls = i < currentIdx ? 'fsm-connector--completed'
          : i === currentIdx && !isFailed && task.state !== 'COMPLETED' ? 'fsm-connector--active' : '';

        return `
          <div class="fsm-state ${cls}" style="min-width:56px;">
            <div class="fsm-state__dot" style="width:22px;height:22px;font-size:9px;">
              ${i < currentIdx ? '✓' : i === currentIdx ? '⚡' : '○'}
            </div>
            <div class="fsm-state__label" style="font-size:8px;">${shortLabels[s]}</div>
          </div>
          ${i < states.length - 1 ? `<div class="fsm-connector ${connCls}" style="min-width:12px;max-width:30px;"></div>` : ''}
        `;
      }).join('')}
      ${isFailed ? `
        <div class="fsm-connector" style="min-width:12px;max-width:30px;background:var(--error);"></div>
        <div class="fsm-state fsm-state--failed" style="min-width:56px;">
          <div class="fsm-state__dot" style="width:22px;height:22px;font-size:9px;">✕</div>
          <div class="fsm-state__label" style="font-size:8px;">${task.state}</div>
        </div>
      ` : ''}
      <div style="margin-left:auto;display:flex;align-items:center;gap:var(--space-2);">
        <span style="font-size:10px;color:var(--text-muted);">${task.routedAgent || ''}</span>
        ${task.subState ? `<span class="badge badge--info" style="font-size:9px;">${task.subState}</span>` : ''}
      </div>
    </div>
  `;
}

function renderWorkflowList() {
  const workflows = _buildWorkflows();
  if (!workflows.length) {
    return `
      <div class="empty-state" style="padding:var(--space-8);">
        <div class="empty-state__icon">⚡</div>
        <div class="empty-state__title">Dar nėra workflow'ų</div>
        <div class="empty-state__desc">Paleiskite pirmą užduotį iš Coding, Trading arba Creation engine.</div>
      </div>
    `;
  }
  return `
    <div class="workflow-list">
      ${workflows.map(wf => {
        const statusLabel = wf.running > 0 ? 'running' : wf.failed > 0 ? 'error' : 'idle';
        const lastTs = wf.lastTask?.startedAt
          ? new Date(wf.lastTask.startedAt).toLocaleDateString('lt-LT')
          : '—';
        return `
          <div class="workflow-item" data-wf-id="${wf.id}">
            <div class="workflow-item__icon">${wf.icon}</div>
            <div class="workflow-item__info">
              <div class="workflow-item__name">${wf.name}</div>
              <div class="workflow-item__desc">${wf.desc}</div>
            </div>
            <div class="workflow-item__meta">
              <div style="text-align:right;margin-right:var(--space-3);">
                <div style="font-size:var(--text-sm);font-weight:600;">${wf.runs}</div>
                <div style="font-size:var(--text-xs);color:var(--text-muted);">runs</div>
              </div>
              <div style="text-align:right;margin-right:var(--space-3);">
                <div style="font-size:var(--text-sm);font-weight:600;">${wf.successRate}%</div>
                <div style="font-size:var(--text-xs);color:var(--text-muted);">success</div>
              </div>
              <div style="text-align:right;margin-right:var(--space-3);">
                <div style="font-size:var(--text-xs);color:var(--text-muted);">${lastTs}</div>
                <div style="font-size:var(--text-xs);color:var(--text-muted);">last run</div>
              </div>
              <span class="badge badge--${getStatusBadge(statusLabel)}">
                <span class="badge__dot"></span>
                ${statusLabel}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderWorkflowCanvas() {
  const wf = _buildWorkflows().find(w => w.id === activeWorkflowId);

  if (!wf) {
    return `
      <div class="empty-state">
        <div class="empty-state__icon">⚡</div>
        <div class="empty-state__title">Pasirinkite workflow iš sąrašo</div>
        <div class="empty-state__desc">Perjunkite į List rodinį ir paspauskite ant workflow eilutės.</div>
      </div>
    `;
  }

  const FSM_PHASES = ['PLANNING','ROUTING','EXECUTING','VALIDATING','PERSISTING'];
  const PHASE_META = {
    PLANNING:   { icon: '🧠', owner: 'supervisor', label: 'Planning' },
    ROUTING:    { icon: '🔀', owner: 'supervisor', label: 'Routing' },
    EXECUTING:  { icon: '⚙️', owner: wf.id === 'coding' ? 'codeweaver' : wf.id === 'trading' ? 'marketsense' : wf.id === 'creation' ? 'storyteller' : 'worker', label: 'Executing' },
    VALIDATING: { icon: '⚖️', owner: 'judge',      label: 'Validating' },
    PERSISTING: { icon: '💾', owner: 'system',     label: 'Persisting' },
  };

  // Compute per-phase stats from all tasks of this engine
  const phaseCounts = {};
  for (const phase of FSM_PHASES) phaseCounts[phase] = { reached: 0, total: wf.runs };
  for (const t of wf.allTasks) {
    const history = t.stateHistory || [];
    for (const phase of FSM_PHASES) {
      if (history.includes(phase) || t.state === phase || (t.state === 'COMPLETED' && FSM_PHASES.indexOf(phase) <= FSM_PHASES.indexOf('PERSISTING'))) {
        phaseCounts[phase].reached++;
      }
    }
  }

  const lastTask = wf.lastTask;
  const lastTs = lastTask?.startedAt ? new Date(lastTask.startedAt).toLocaleString('lt-LT') : '—';
  const lastState = lastTask?.state || '—';
  const lastOutput = lastTask?.finalOutput
    ? (lastTask.finalOutput.length > 300 ? lastTask.finalOutput.slice(0, 300) + '…' : lastTask.finalOutput)
    : '(nėra output)';

  // Node positions — horizontal pipeline
  const nodes = FSM_PHASES.map((phase, i) => ({
    id: phase,
    x: 40 + i * 180,
    y: 60,
    ...PHASE_META[phase],
    rate: wf.runs > 0 ? Math.round((phaseCounts[phase].reached / wf.runs) * 100) : 0,
  }));

  return `
    <div style="margin-bottom:var(--space-3);display:flex;align-items:center;gap:var(--space-3);">
      <button class="btn btn--secondary btn--sm" id="btn-back-to-list">⟵ Back</button>
      <h3 style="font-size:var(--text-md);font-weight:var(--weight-semibold);">${wf.icon} ${wf.name}</h3>
      <span class="badge badge--info">${wf.runs} runs</span>
      <span class="badge badge--${wf.successRate >= 80 ? 'success' : wf.successRate >= 50 ? 'warning' : 'error'}">${wf.successRate}% success</span>
    </div>

    <div style="display:flex;flex-direction:column;gap:var(--space-4);height:calc(100vh - 200px);">
      <!-- FSM Canvas -->
      <div style="flex:2;min-height:280px;background:var(--bg-body);border:1px solid var(--border-default);border-radius:var(--radius-lg);position:relative;overflow:auto;">
        <svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">
          ${nodes.slice(0,-1).map((n,i) => {
            const nx = n.x + 140; const ny = n.y + 60;
            const tx = nodes[i+1].x; const ty = nodes[i+1].y + 60;
            return `<path d="M ${nx} ${ny} C ${nx+30} ${ny}, ${tx-30} ${ty}, ${tx} ${ty}" stroke="var(--border-strong)" stroke-width="2" fill="none" stroke-dasharray="6,3" opacity=".6"/>`;
          }).join('')}
        </svg>
        ${nodes.map(node => `
          <div style="position:absolute;left:${node.x}px;top:${node.y}px;width:140px;background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);">
            <div style="font-size:20px;text-align:center;">${node.icon}</div>
            <div style="font-size:var(--text-sm);font-weight:600;text-align:center;color:var(--text-primary);">${node.label}</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted);text-align:center;">${node.owner}</div>
            <div style="background:var(--bg-body);border-radius:var(--radius-sm);height:4px;overflow:hidden;">
              <div style="height:100%;width:${node.rate}%;background:var(--accent);transition:width .4s;"></div>
            </div>
            <div style="font-size:10px;color:var(--text-muted);text-align:center;">${node.rate}% reached</div>
          </div>
        `).join('')}
      </div>

      <!-- Last run + recent tasks -->
      <div style="flex:1;display:flex;gap:var(--space-4);min-height:180px;">
        <!-- Last run output -->
        <div style="flex:1;background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-lg);display:flex;flex-direction:column;">
          <div style="padding:var(--space-3);border-bottom:1px solid var(--border-default);font-weight:var(--weight-semibold);display:flex;justify-content:space-between;">
            <span>Paskutinis run</span>
            <span style="font-size:var(--text-xs);color:var(--text-muted);">${lastTs} · <span class="badge badge--${getStatusBadge(lastState.toLowerCase())}" style="font-size:9px;">${lastState}</span></span>
          </div>
          <div style="padding:var(--space-3);flex:1;overflow-y:auto;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--text-secondary);white-space:pre-wrap;line-height:1.5;">${lastOutput}</div>
        </div>

        <!-- Recent tasks -->
        <div style="width:280px;background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-lg);display:flex;flex-direction:column;">
          <div style="padding:var(--space-3);border-bottom:1px solid var(--border-default);font-weight:var(--weight-semibold);">Istorija</div>
          <div style="flex:1;overflow-y:auto;">
            ${wf.allTasks.slice(0, 10).map(t => `
              <div style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-default);display:flex;gap:var(--space-2);align-items:center;">
                <span class="badge badge--${getStatusBadge(t.state.toLowerCase())}" style="font-size:9px;flex-shrink:0;">${t.state}</span>
                <span style="font-size:var(--text-xs);color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.intent || '—'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderNodeInspector(node) {
  return `
    <div style="display:flex; flex-direction:column; gap:var(--space-4);">
      <div>
        <label style="display:block; font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-1);">Node Name</label>
        <div style="font-size:var(--text-sm); font-weight:var(--weight-medium); color:var(--text-primary); padding:var(--space-2); background:var(--bg-body); border-radius:var(--radius-md); border:1px solid var(--border-default);">${node.name}</div>
      </div>
      <div>
        <label style="display:block; font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-1);">Status</label>
        <span class="badge badge--${getStatusBadge(node.status)}">${node.status || 'idle'}</span>
      </div>
      <div>
        <label style="display:block; font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-1);">Owner Agent</label>
        <div style="font-size:var(--text-sm); color:var(--text-primary); padding:var(--space-2); background:var(--bg-body); border-radius:var(--radius-md); border:1px solid var(--border-default); display:flex; align-items:center; gap:var(--space-2);">
          <span>🤖</span> ${node.owner || 'System'}
        </div>
      </div>
      <div>
        <label style="display:block; font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-1);">Tool Access</label>
        <div style="display:flex; gap:var(--space-2); flex-wrap:wrap; padding:var(--space-2); background:var(--bg-body); border-radius:var(--radius-md); border:1px solid var(--border-default);">
          ${(node.tools || []).map(t => `<span class="badge badge--info" style="font-size:10px;">${t}</span>`).join('') || '<span style="color:var(--text-muted); font-size:var(--text-xs);">None</span>'}
        </div>
      </div>
      <div>
        <label style="display:block; font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-1);">Input Schema</label>
        <div style="font-size:var(--text-xs); font-family:var(--font-mono); color:var(--coding-accent); padding:var(--space-3); background:#1e1e1e; border-radius:var(--radius-md); overflow-x:auto;">${node.schemaIn}</div>
      </div>
      <div>
        <label style="display:block; font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-1);">Output Schema</label>
        <div style="font-size:var(--text-xs); font-family:var(--font-mono); color:var(--trading-accent); padding:var(--space-3); background:#1e1e1e; border-radius:var(--radius-md); overflow-x:auto;">${node.schemaOut}</div>
      </div>
      <div style="margin-top:var(--space-2);">
        <button class="btn btn--secondary btn--sm" style="width:100%; border:1px solid var(--border-strong);" onclick="document.querySelector('.workflow-node[data-node-id=&quot;${node.id}&quot;]').dispatchEvent(new MouseEvent('dblclick'))">Edit Configuration ⚙</button>
      </div>
    </div>
  `;
}

function getStatusBadge(status) {
  switch (status) {
    case 'running':   return 'success';
    case 'idle':      return 'info';
    case 'scheduled': return 'warning';
    case 'error':     return 'error';
    default:          return 'info';
  }
}

export function initWorkflowEvents() {
  // Load real task data once per mount — _hasLoaded prevents empty-array re-fetch loop
  if (!_hasLoaded && !_loadPromise) {
    _loadTasks();
  }

  // View mode toggle
  document.querySelectorAll('.tab[data-view]').forEach(tab => {
    tab.addEventListener('click', () => {
      viewMode = tab.dataset.view;
      EventBus.emit('navigate', 'workflows');
    });
  });

  document.getElementById('btn-new-workflow')?.addEventListener('click', () => {
    showToast('Paleiskite užduotį iš Coding, Trading arba Creation engine — ji automatiškai atsiras čia.', 'info');
  });

  // Click workflow item → open canvas
  document.querySelectorAll('.workflow-item').forEach(item => {
    item.addEventListener('click', () => {
      activeWorkflowId = item.dataset.wfId;
      viewMode = 'canvas';
      EventBus.emit('navigate', 'workflows');
    });
  });

  // Back button
  document.getElementById('btn-back-to-list')?.addEventListener('click', () => {
    viewMode = 'list';
    EventBus.emit('navigate', 'workflows');
  });

  // SSE — one subscription for the lifetime of this view
  if (!_sseUnsub) {
    _sseUnsub = Api.subscribeEvents((name) => {
      if ((name === 'task:done' || name === 'task:created') && !_loadPromise) {
        _tasks = [];
        _hasLoaded = false;
        _loadTasks();
      }
    });
    EventBus.on('navigate', function cleanup(route) {
      if (route !== 'workflows') {
        _sseUnsub?.();
        _sseUnsub = null;
        EventBus.off('navigate', cleanup);
      }
    });
  }

  // Draw connections if canvas is visible
  if (viewMode === 'canvas') {
    requestAnimationFrame(() => drawConnections());
  }

  // Node selection and Drag & Drop
  let draggedNode = null;
  let offset = { x: 0, y: 0 };
  let connectionDraft = { active: false, fromNodeId: null, mouseX: 0, mouseY: 0 };
  const canvas = document.getElementById('workflow-canvas');

  document.querySelectorAll('.workflow-node').forEach(node => {
    node.addEventListener('mousedown', (e) => {
      // Handle output port connection drag
      if (e.target.classList.contains('workflow-node__port--output')) {
        e.stopPropagation();
        connectionDraft.active = true;
        connectionDraft.fromNodeId = node.dataset.nodeId;
        return;
      }
      
      // Don't drag if clicking input port
      if (e.target.classList.contains('workflow-node__port--input')) return;
      
      document.querySelectorAll('.workflow-node').forEach(n => n.classList.remove('selected'));
      node.classList.add('selected');
      
      // Update Inspector
      const nodeId = node.dataset.nodeId;
      const workflows = AppState.getState('workflows') || [];
      const wf = workflows.find(w => w.id === (activeWorkflowId || workflows[0]?.id));
      if (wf && wf.nodes) {
        const nodeData = wf.nodes.find(n => n.id === nodeId);
        if (nodeData) {
          AppState.setState('selectedItem', { type: 'node', data: nodeData });
          if (!AppState.getState('inspectorOpen')) {
            AppState.setState('inspectorOpen', true);
            document.getElementById('app')?.classList.remove('inspector-collapsed');
          }
        }
      }
      
      draggedNode = node;
      const rect = node.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      
      offset.x = e.clientX - rect.left;
      offset.y = e.clientY - rect.top;
      
      node.style.cursor = 'grabbing';
      node.style.zIndex = '100';
    });

    node.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const nodeId = node.dataset.nodeId;
      const workflows = AppState.getState('workflows') || [];
      const wfIndex = workflows.findIndex(w => w.id === (activeWorkflowId || workflows[0]?.id));
      if (wfIndex === -1) return;
      const wf = workflows[wfIndex];
      const nodeData = wf.nodes?.find(n => n.id === nodeId);
      if (!nodeData) return;

      const agents = AppState.getState('agents') || [];
      const agentOptions = agents.map(a => `<option value="${a.id}" ${nodeData.agentId === a.id ? 'selected' : ''}>${a.name} (${a.type})</option>`).join('');

      let extraFields = '';
      if (nodeData.type === 'agent') {
        extraFields = `
          <div style="margin-top:var(--space-4);">
            <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--text-primary);">Assigned Agent</label>
            <select id="node-prop-agent" style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);">
              <option value="">-- Select Agent --</option>
              ${agentOptions}
            </select>
          </div>
        `;
      } else if (nodeData.type === 'condition') {
        extraFields = `
          <div style="margin-top:var(--space-4);">
            <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--text-primary);">Condition Expression</label>
            <input type="text" id="node-prop-condition" value="${nodeData.condition || ''}" placeholder="e.g. status == 'success'" style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);">
          </div>
        `;
      } else if (nodeData.type === 'action') {
        extraFields = `
          <div style="margin-top:var(--space-4);">
            <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--text-primary);">Action Script</label>
            <textarea id="node-prop-script" placeholder="Enter script..." style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);min-height:80px;resize:vertical;">${nodeData.script || ''}</textarea>
          </div>
        `;
      }

      openModal({
        title: 'Node Properties',
        content: `
          <div>
            <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--text-primary);">Node Name</label>
            <input type="text" id="node-prop-name" value="${nodeData.name}" style="width:100%;padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);">
          </div>
          ${extraFields}
        `,
        actions: `
          <button class="btn btn--secondary" id="btn-cancel-node-props">Cancel</button>
          <button class="btn btn--primary" id="btn-save-node-props">Save</button>
        `
      });

      requestAnimationFrame(() => {
        document.getElementById('btn-cancel-node-props')?.addEventListener('click', closeModal);
        document.getElementById('btn-save-node-props')?.addEventListener('click', () => {
          const nameInput = document.getElementById('node-prop-name');
          if (nameInput) nodeData.name = nameInput.value.trim();

          const agentSelect = document.getElementById('node-prop-agent');
          if (agentSelect) nodeData.agentId = agentSelect.value;

          const conditionInput = document.getElementById('node-prop-condition');
          if (conditionInput) nodeData.condition = conditionInput.value;

          const scriptInput = document.getElementById('node-prop-script');
          if (scriptInput) nodeData.script = scriptInput.value;

          AppState.setState('workflows', [...workflows]);
          
          // Re-emit selected item so inspector updates instantly
          AppState.setState('selectedItem', { type: 'node', data: nodeData });

          closeModal();
          showToast('Node properties updated', 'success');
          EventBus.emit('navigate', 'workflows');
        });
        document.getElementById('node-prop-name')?.focus();
      });
    });
  });

  if (canvas) {
    // Add mousemove and mouseup to document to handle drag reliably
    const onMouseMove = (e) => {
      if (connectionDraft.active) {
        const canvasRect = canvas.getBoundingClientRect();
        connectionDraft.mouseX = e.clientX - canvasRect.left;
        connectionDraft.mouseY = e.clientY - canvasRect.top;
        drawConnections(connectionDraft);
        return;
      }
      
      if (!draggedNode) return;
      
      const canvasRect = canvas.getBoundingClientRect();
      let newX = e.clientX - canvasRect.left - offset.x;
      let newY = e.clientY - canvasRect.top - offset.y;
      
      // Boundaries
      newX = Math.max(0, Math.min(newX, canvasRect.width - draggedNode.offsetWidth));
      newY = Math.max(0, Math.min(newY, canvasRect.height - draggedNode.offsetHeight));
      
      draggedNode.style.left = `${newX}px`;
      draggedNode.style.top = `${newY}px`;
      
      drawConnections();
    };

    const onMouseUp = (e) => {
      if (connectionDraft.active) {
        const targetPort = document.elementFromPoint(e.clientX, e.clientY);
        if (targetPort && targetPort.classList.contains('workflow-node__port--input')) {
          const toNodeId = targetPort.closest('.workflow-node').dataset.nodeId;
          if (connectionDraft.fromNodeId && toNodeId && connectionDraft.fromNodeId !== toNodeId) {
            const workflows = AppState.getState('workflows') || [];
            const wfId = activeWorkflowId || workflows[0]?.id;
            const wfIndex = workflows.findIndex(w => w.id === wfId);
            if (wfIndex > -1) {
              const wf = workflows[wfIndex];
              wf.connections = wf.connections || [];
              const exists = wf.connections.find(c => c.from === connectionDraft.fromNodeId && c.to === toNodeId);
              if (!exists) {
                wf.connections.push({ from: connectionDraft.fromNodeId, to: toNodeId });
                AppState.setState('workflows', [...workflows]);
              }
            }
          }
        }
        connectionDraft.active = false;
        drawConnections();
        return;
      }
      
      if (draggedNode) {
        draggedNode.style.cursor = 'grab';
        draggedNode.style.zIndex = '';
        
        // Save new position back to AppState
        const workflows = AppState.getState('workflows') || [];
        const wfId = activeWorkflowId || workflows[0]?.id;
        const wfIndex = workflows.findIndex(w => w.id === wfId);
        
        if (wfIndex > -1) {
          const wf = workflows[wfIndex];
          const nodeId = draggedNode.dataset.nodeId;
          const nodeData = wf?.nodes?.find(n => n.id === nodeId);
          
          if (nodeData) {
            nodeData.x = parseInt(draggedNode.style.left, 10);
            nodeData.y = parseInt(draggedNode.style.top, 10);
            
            // Save state
            AppState.setState('workflows', [...workflows]);
          }
        }
        
        draggedNode = null;
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Clean up event listeners when navigating away
    const cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      EventBus.off('navigate', cleanup);
    };
    EventBus.on('navigate', cleanup);

    // Palette Drag & Drop Handlers
    document.querySelectorAll('.palette-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('nodeType', item.dataset.type);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });

    canvas.addEventListener('dragover', (e) => {
      e.preventDefault(); // allow drop
      e.dataTransfer.dropEffect = 'copy';
    });

    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData('nodeType');
      if (!nodeType) return;

      const workflows = AppState.getState('workflows') || [];
      const wfId = activeWorkflowId || workflows[0]?.id;
      const wfIndex = workflows.findIndex(w => w.id === wfId);
      
      if (wfIndex > -1) {
        const wf = workflows[wfIndex];
        const rect = canvas.getBoundingClientRect();
        
        // Approximate node width/height for centering
        const nodeWidth = 140;
        const nodeHeight = 70;

        const x = Math.round(e.clientX - rect.left - nodeWidth / 2);
        const y = Math.round(e.clientY - rect.top - nodeHeight / 2);
        
        const newNode = {
          id: `n-${Date.now()}`,
          type: nodeType,
          name: `New ${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}`,
          x: Math.max(0, x),
          y: Math.max(0, y)
        };
        
        wf.nodes = wf.nodes || [];
        wf.nodes.push(newNode);
        
        AppState.setState('workflows', [...workflows]);
        EventBus.emit('navigate', 'workflows');
      }
    });
  }
}

function drawConnections(draft = null) {
  const svg = document.getElementById('wf-connections');
  const canvas = document.getElementById('workflow-canvas');
  if (!svg || !canvas) return;

  const workflows = AppState.getState('workflows') || [];
  const wf = workflows.find(w => w.id === activeWorkflowId) || workflows[0];
  const canvasRect = canvas.getBoundingClientRect();
  let paths = '';

  if (wf && wf.connections) {
    wf.connections.forEach(conn => {
      const fromNode = canvas.querySelector(`[data-node-id="${conn.from}"]`);
      const toNode = canvas.querySelector(`[data-node-id="${conn.to}"]`);
      if (!fromNode || !toNode) return;

      const fromRect = fromNode.getBoundingClientRect();
      const toRect = toNode.getBoundingClientRect();

      const x1 = fromRect.right - canvasRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - canvasRect.top;
      const x2 = toRect.left - canvasRect.left;
      const y2 = toRect.top + toRect.height / 2 - canvasRect.top;

      const cp1x = x1 + (x2 - x1) * 0.4;
      const cp2x = x1 + (x2 - x1) * 0.6;

      paths += `<path class="workflow-connection active" d="M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}" />`;
    });
  }

  // Draw draft connection
  if (draft && draft.active && draft.fromNodeId) {
    const fromNode = canvas.querySelector(`[data-node-id="${draft.fromNodeId}"]`);
    if (fromNode) {
      const fromRect = fromNode.getBoundingClientRect();
      const x1 = fromRect.right - canvasRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - canvasRect.top;
      const x2 = draft.mouseX;
      const y2 = draft.mouseY;
      
      const cp1x = x1 + (x2 - x1) * 0.4;
      const cp2x = x1 + (x2 - x1) * 0.6;
      
      paths += `<path class="workflow-connection" stroke-dasharray="5,5" opacity="0.6" d="M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}" />`;
    }
  }

  svg.innerHTML = paths;
}
