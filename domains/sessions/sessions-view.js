// ═══════════════════════════════════════════════════
// DOMAIN: Sessions View — task istorija kaip pokalbiai
// ═══════════════════════════════════════════════════

import EventBus from '../../core/events.js';
import * as Api from '../../core/api-client.js';
import { showToast } from '../../components/toast.js';

// ─── Module state ─────────────────────────────────
let _tasks      = [];
let _selectedId = null;
let _filter     = 'all';
let _stateFilter = 'all';
let _loading    = true;
let _sseUnsub   = null;

// ─── Render ───────────────────────────────────────

export function renderSessions() {
  const visible = _filtered();
  const selected = _selectedId
    ? _tasks.find(t => t.taskId === _selectedId)
    : visible[0] || null;

  return `
    <div style="display:flex;height:100%;overflow:hidden;">

      <!-- SESSION LIST -->
      <div style="width:300px;flex-shrink:0;border-right:1px solid var(--border-default);display:flex;flex-direction:column;overflow:hidden;">

        <div style="padding:var(--space-4) var(--space-4) var(--space-3);border-bottom:1px solid var(--border-default);flex-shrink:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
            <h2 style="font-size:var(--text-md);font-weight:700;color:var(--text-primary);">🕒 Sessions</h2>
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn--ghost btn--sm" id="btn-sess-refresh">⟳</button>
              <button class="btn btn--primary btn--sm" id="btn-sess-new">＋ Nauja</button>
            </div>
          </div>

          <div style="display:flex;gap:4px;margin-bottom:var(--space-2);flex-wrap:wrap;">
            ${['all','coding','trading','creation'].map(f => `
              <div class="tab ${_filter === f ? 'active' : ''}" data-df="${f}"
                style="font-size:10px;padding:3px 8px;cursor:pointer;">
                ${f === 'all' ? `Visi (${_tasks.length})` : `${_domainIcon(f)} ${f}`}
              </div>
            `).join('')}
          </div>

          <div style="display:flex;gap:4px;">
            ${['all','running','completed','failed'].map(f => `
              <div class="tab ${_stateFilter === f ? 'active' : ''}" data-sf="${f}"
                style="font-size:10px;padding:3px 8px;cursor:pointer;">
                ${f}
              </div>
            `).join('')}
          </div>
        </div>

        <div style="flex:1;overflow-y:auto;">
          ${_loading ? _skeletonList() : _renderList(visible, selected?.taskId)}
        </div>
      </div>

      <!-- CONVERSATION PANEL -->
      <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
        ${selected ? _renderThread(selected) : _renderEmpty()}
      </div>

    </div>
  `;
}

// ─── List ─────────────────────────────────────────

function _renderList(tasks, activeId) {
  if (!tasks.length) {
    return `
      <div style="padding:var(--space-6);text-align:center;">
        <div style="font-size:2rem;opacity:.3;margin-bottom:var(--space-3);">🕒</div>
        <div style="font-size:var(--text-sm);color:var(--text-muted);">Nėra sessions</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:var(--space-2);">Paleisk užduotį Task FSM arba Coding Engine</div>
      </div>`;
  }
  return tasks.map(t => {
    const isActive = t.taskId === activeId;
    const isRunning = _isRunning(t.state);
    const stateColor = _stateColor(t.state);
    const score = t.validationResult?.score;
    const dur = t.completedAt
      ? ((t.completedAt - t.startedAt) / 1000).toFixed(1) + 's'
      : isRunning ? 'vyksta…' : '—';

    return `
      <div class="sess-item" data-task-id="${t.taskId}"
        style="padding:var(--space-3) var(--space-4);cursor:pointer;border-bottom:1px solid var(--border-default);
               border-left:3px solid ${isActive ? 'var(--accent-primary)' : 'transparent'};
               background:${isActive ? 'rgba(79,142,247,.08)' : 'transparent'};">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-2);margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;">
            <span style="font-size:13px;flex-shrink:0;">${_domainIcon(t.domainEngine)}</span>
            <span style="font-size:var(--text-xs);font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:155px;">${_escHtml(t.intent || '(be tikslo)')}</span>
          </div>
          <span style="font-size:9px;flex-shrink:0;padding:2px 5px;border-radius:3px;border:1px solid ${stateColor};color:${stateColor};">${_shortState(t.state)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-3);font-size:10px;color:var(--text-muted);">
          <span>${_ago(t.startedAt)}</span>
          <span>⏱ ${dur}</span>
          ${score != null ? `<span style="color:${score>=75?'var(--success)':'var(--warning)'};">★ ${score}</span>` : ''}
          ${isRunning ? `<span style="color:var(--warning);">●</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ─── Conversation thread ──────────────────────────

function _renderThread(task) {
  const messages = _toMessages(task);
  const isRunning = _isRunning(task.state);
  const isReview  = task.state === 'REVIEW_REQUIRED';

  return `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">

      <div style="padding:var(--space-4);border-bottom:1px solid var(--border-default);flex-shrink:0;display:flex;align-items:center;gap:var(--space-3);">
        <span style="font-size:1.4rem;">${_domainIcon(task.domainEngine)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:var(--text-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_escHtml(task.intent || '—')}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
            ${task.domainEngine} · ${_ago(task.startedAt)}
            ${task.completedAt ? ` · ${((task.completedAt - task.startedAt)/1000).toFixed(1)}s` : ''}
          </div>
        </div>
        <span class="badge badge--${_stateBadgeType(task.state)}" style="flex-shrink:0;">${task.state}</span>
      </div>

      <div style="flex:1;overflow-y:auto;padding:var(--space-5) var(--space-5);display:flex;flex-direction:column;gap:var(--space-4);">
        ${messages.map(m => _renderMessage(m, task.domainEngine)).join('')}
        ${isRunning ? `
          <div style="display:flex;align-items:center;gap:var(--space-2);color:var(--text-muted);font-size:var(--text-xs);">
            <span class="spinner" style="width:12px;height:12px;border-width:2px;"></span>
            Vykdoma…
          </div>` : ''}
      </div>

      ${isReview ? `
        <div style="padding:var(--space-4);border-top:1px solid var(--border-default);background:rgba(253,203,110,.06);flex-shrink:0;">
          <div style="font-size:var(--text-xs);color:var(--warning);font-weight:600;margin-bottom:var(--space-3);">⚠ Laukia jūsų peržiūros</div>
          <div style="display:flex;gap:var(--space-3);align-items:center;">
            <input id="sess-feedback-input" type="text" placeholder="Neprivalomas komentaras…"
              style="flex:1;padding:var(--space-2) var(--space-3);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:var(--text-xs);">
            <button class="btn btn--error btn--sm" id="btn-sess-rework">↩ Rework</button>
            <button class="btn btn--success btn--sm" id="btn-sess-approve">✓ Patvirtinti</button>
          </div>
        </div>
      ` : `
        <div style="padding:var(--space-3) var(--space-5);border-top:1px solid var(--border-default);display:flex;gap:var(--space-3);align-items:center;flex-shrink:0;">
          <button class="btn btn--ghost btn--sm" id="btn-sess-copy" ${!task.finalOutput ? 'disabled' : ''}>📋 Kopijuoti</button>
          <button class="btn btn--ghost btn--sm" id="btn-sess-fsm">⚙ Task FSM</button>
          <span style="margin-left:auto;font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">${task.taskId}</span>
        </div>
      `}
    </div>
  `;
}

function _renderMessage(msg, domain) {
  if (msg.role === 'user') {
    return `
      <div style="display:flex;justify-content:flex-end;">
        <div style="max-width:72%;background:var(--accent-primary);color:#fff;border-radius:var(--radius-lg) var(--radius-lg) 4px var(--radius-lg);padding:var(--space-3) var(--space-4);">
          <div style="font-size:var(--text-sm);line-height:1.5;word-break:break-word;">${_escHtml(msg.content)}</div>
          <div style="font-size:10px;opacity:.7;margin-top:4px;text-align:right;">Jūs</div>
        </div>
      </div>`;
  }

  const { icon, name, color, bg } = _agentMeta(msg.role, domain);
  return `
    <div style="display:flex;gap:var(--space-3);align-items:flex-start;">
      <div style="width:30px;height:30px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;border:1px solid ${color}40;">${icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:5px;">
          <span style="font-size:11px;font-weight:700;color:${color};">${name}</span>
          ${msg.label ? `<span style="font-size:10px;color:var(--text-muted);">${_escHtml(msg.label)}</span>` : ''}
          ${msg.score  != null ? `<span class="badge badge--${msg.score>=75?'success':'warning'}" style="font-size:9px;">★ ${msg.score}/100</span>` : ''}
          ${msg.passed === true  ? `<span class="badge badge--success" style="font-size:9px;">Patvirtinta</span>` : ''}
          ${msg.passed === false ? `<span class="badge badge--error"   style="font-size:9px;">Atmesta</span>` : ''}
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border-default);border-radius:4px var(--radius-lg) var(--radius-lg) var(--radius-lg);padding:var(--space-3) var(--space-4);">
          ${msg.preformatted
            ? `<pre style="white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);font-size:11px;line-height:1.6;margin:0;color:var(--text-primary);max-height:320px;overflow-y:auto;">${_escHtml(msg.content)}</pre>`
            : `<div style="font-size:var(--text-sm);line-height:1.6;color:var(--text-primary);word-break:break-word;">${_escHtml(msg.content)}</div>`}
        </div>
      </div>
    </div>`;
}

// ─── Data → messages ──────────────────────────────

function _toMessages(task) {
  const msgs = [];

  msgs.push({ role: 'user', content: task.intent || '(nėra tikslo)' });

  if (task.plan) {
    const planText = [
      task.plan.summary,
      task.plan.actions?.length
        ? 'Žingsniai:\n' + task.plan.actions.map((a, i) => `${i+1}. ${a.description}`).join('\n')
        : null,
    ].filter(Boolean).join('\n\n');
    msgs.push({ role: 'supervisor', content: planText || 'Planas sudarytas.', label: task.routedAgent ? `→ ${task.routedAgent}` : '' });
  }

  if (task.keyOutputs) {
    for (const [phase, out] of Object.entries(task.keyOutputs)) {
      if (out?.output) msgs.push({ role: 'worker', label: phase, content: out.output, preformatted: true });
    }
  }

  if (task.validationResult) {
    const vr = task.validationResult;
    const body = [
      vr.passed ? `✓ Patvirtinta — ${vr.score}/100` : `✗ Atmesta — ${vr.score}/100`,
      vr.reasons || '',
      vr.checks?.length ? 'Kriterijai:\n' + vr.checks.map(c => `${c.passed?'✓':'✗'} ${c.name}`).join('\n') : '',
    ].filter(Boolean).join('\n\n');
    msgs.push({ role: 'judge', content: body, score: vr.score, passed: vr.passed });
  }

  if (task.finalOutput && task.state === 'COMPLETED') {
    msgs.push({ role: 'result', content: task.finalOutput, preformatted: true });
  }

  if (['FAILED','CANCELLED'].includes(task.state)) {
    msgs.push({ role: 'error', content: task.state === 'CANCELLED' ? 'Atšaukta.' : (task.errorMessage || 'Klaida.') });
  }

  if (task.state === 'REVIEW_REQUIRED') {
    msgs.push({ role: 'review', content: 'Judge nepatvirtino, bet rework limitai baigėsi. Jūsų sprendimas — patvirtinti arba grąžinti.' });
  }

  return msgs;
}

function _agentMeta(role, domain) {
  const dc = domain === 'trading' ? 'var(--trading-accent)' : domain === 'creation' ? 'var(--creation-accent)' : 'var(--coding-accent)';
  const db = domain === 'trading' ? 'var(--trading-bg)' : domain === 'creation' ? 'var(--creation-bg)' : 'var(--coding-bg)';
  switch (role) {
    case 'supervisor': return { icon:'🧭', name:'Supervisor',  color:'var(--accent-secondary)', bg:'rgba(108,92,231,.12)' };
    case 'worker':     return { icon: _domainIcon(domain), name: _workerName(domain), color: dc, bg: db };
    case 'judge':      return { icon:'⚖️', name:'Judge',       color:'var(--warning)',           bg:'rgba(253,203,110,.12)' };
    case 'result':     return { icon:'✓',  name:'Rezultatas',  color:'var(--success)',           bg:'rgba(0,184,148,.1)' };
    case 'error':      return { icon:'✕',  name:'Klaida',      color:'var(--error)',             bg:'rgba(214,48,49,.1)' };
    case 'review':     return { icon:'⚠',  name:'Peržiūra',    color:'var(--warning)',           bg:'rgba(253,203,110,.1)' };
    default:           return { icon:'⚙',  name: role,         color:'var(--text-muted)',        bg:'var(--bg-elevated)' };
  }
}

function _renderEmpty() {
  return `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:var(--space-4);opacity:.6;">
      <div style="font-size:3rem;">🕒</div>
      <div style="text-align:center;">
        <div style="font-size:var(--text-md);font-weight:600;margin-bottom:var(--space-2);">Pasirinkite session</div>
        <div style="font-size:var(--text-sm);color:var(--text-muted);">arba paleiskite naują užduotį</div>
      </div>
      <button class="btn btn--primary" id="btn-sess-new-empty">＋ Nauja Užduotis</button>
    </div>`;
}

// ─── Events ───────────────────────────────────────

export function initSessionsEvents() {
  // Refresh
  document.getElementById('btn-sess-refresh')?.addEventListener('click', () => {
    _loading = true;
    _loadAndPaint();
  });

  // New task
  document.getElementById('btn-sess-new')?.addEventListener('click', () => EventBus.emit('navigate', 'task-execution'));
  document.getElementById('btn-sess-new-empty')?.addEventListener('click', () => EventBus.emit('navigate', 'task-execution'));

  // Domain filter
  document.querySelectorAll('[data-df]').forEach(el => {
    el.addEventListener('click', () => {
      _filter = el.dataset.df;
      EventBus.emit('navigate', 'sessions');
    });
  });

  // State filter
  document.querySelectorAll('[data-sf]').forEach(el => {
    el.addEventListener('click', () => {
      _stateFilter = el.dataset.sf;
      EventBus.emit('navigate', 'sessions');
    });
  });

  // Session click
  document.querySelectorAll('.sess-item[data-task-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.taskId;
      if (_selectedId !== id) {
        _selectedId = id;
        EventBus.emit('navigate', 'sessions');
      }
    });
  });

  // Action buttons
  document.getElementById('btn-sess-approve')?.addEventListener('click', () => _resume('approve'));
  document.getElementById('btn-sess-rework')?.addEventListener('click', () => {
    _resume('rework', document.getElementById('sess-feedback-input')?.value.trim() || '');
  });
  document.getElementById('btn-sess-copy')?.addEventListener('click', () => {
    const task = _tasks.find(t => t.taskId === _selectedId);
    if (task?.finalOutput) navigator.clipboard.writeText(task.finalOutput).then(() => showToast('Nukopijuota', 'success'));
  });
  document.getElementById('btn-sess-fsm')?.addEventListener('click', () => EventBus.emit('navigate', 'task-execution'));

  // SSE
  _startSse();

  // Load on first mount
  if (_loading) _loadAndPaint();
}

// ─── Data ─────────────────────────────────────────

async function _loadAndPaint() {
  try {
    const res = await Api.getTasks();
    _tasks = (res.tasks || []).slice().reverse();
    _loading = false;
    if (!_selectedId && _tasks.length) _selectedId = _tasks[0].taskId;
  } catch (err) {
    _loading = false;
    showToast(`Klaida: ${err.message}`, 'error');
  }
  EventBus.emit('navigate', 'sessions');
}

async function _refreshTask(taskId) {
  try {
    const fresh = await Api.getTask(taskId);
    _tasks = _tasks.map(t => t.taskId === taskId ? fresh : t);
    EventBus.emit('navigate', 'sessions');
  } catch { /* ignore */ }
}

// ─── Resume ───────────────────────────────────────

async function _resume(action, feedback = '') {
  if (!_selectedId) return;
  try {
    await Api.resumeTask(_selectedId, { action, feedback });
    showToast(action === 'approve' ? 'Patvirtinta!' : 'Grąžinta rework', 'success');
    await _refreshTask(_selectedId);
  } catch (err) {
    showToast(`Klaida: ${err.message}`, 'error');
  }
}

// ─── SSE ──────────────────────────────────────────

function _startSse() {
  if (_sseUnsub) return;
  _sseUnsub = Api.subscribeEvents((name, data) => {
    if (name === 'task:created') {
      if (!_tasks.find(t => t.taskId === data.taskId)) {
        _tasks.unshift({
          taskId: data.taskId, intent: data.intent,
          domainEngine: data.domainEngine || 'coding',
          state: 'INTENT_CAPTURED', startedAt: Date.now(),
          plan: null, keyOutputs: {}, validationResult: null, finalOutput: null,
        });
        if (!_selectedId) _selectedId = data.taskId;
        EventBus.emit('navigate', 'sessions');
      }
    } else if (['task:stateChange','task:done','task:error'].includes(name) && data.taskId) {
      _refreshTask(data.taskId);
    }
  });
}

EventBus.on('navigate', route => {
  if (route !== 'sessions') { if (_sseUnsub) { _sseUnsub(); _sseUnsub = null; } }
});

// ─── Helpers ─────────────────────────────────────

function _filtered() {
  return _tasks.filter(t => {
    const domOk = _filter === 'all' || t.domainEngine === _filter;
    const stOk  = _stateFilter === 'all'
      || (_stateFilter === 'running'   && _isRunning(t.state))
      || (_stateFilter === 'completed' && t.state === 'COMPLETED')
      || (_stateFilter === 'failed'    && ['FAILED','CANCELLED'].includes(t.state));
    return domOk && stOk;
  });
}

function _skeletonList() {
  return Array.from({length:4}, () => `
    <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-default);">
      <div style="height:36px;background:var(--bg-elevated);border-radius:var(--radius-md);opacity:.4;"></div>
    </div>`).join('');
}

function _isRunning(s) { return !['COMPLETED','FAILED','CANCELLED','REVIEW_REQUIRED'].includes(s||''); }
function _stateColor(s) {
  if (s==='COMPLETED') return 'var(--success)';
  if (s==='FAILED')    return 'var(--error)';
  if (s==='CANCELLED') return 'var(--text-muted)';
  if (s==='REVIEW_REQUIRED') return 'var(--warning)';
  return 'var(--accent-primary)';
}
function _stateBadgeType(s) {
  if (s==='COMPLETED') return 'success';
  if (['FAILED','CANCELLED'].includes(s)) return 'error';
  if (s==='REVIEW_REQUIRED') return 'warning';
  return 'info';
}
function _shortState(s) {
  return {COMPLETED:'DONE',FAILED:'ERR',CANCELLED:'STOP',REVIEW_REQUIRED:'REV',
    INTENT_CAPTURED:'INIT',PLANNING:'PLAN',ROUTING:'ROUT',EXECUTING:'EXEC',
    VALIDATING:'JUDG',PERSISTING:'SAVE',REWORK:'REDO'}[s] || (s||'?').slice(0,4);
}
function _domainIcon(d) { return d==='trading'?'◇':d==='creation'?'✦':'⟨/⟩'; }
function _workerName(d) { return d==='trading'?'MarketSense':d==='creation'?'StoryTeller':'CodeWeaver'; }
function _ago(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now()-ts)/1000);
  if (s<60)    return `${s}s`;
  if (s<3600)  return `${Math.floor(s/60)}min`;
  if (s<86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}
function _escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
