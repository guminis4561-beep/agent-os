// ═══════════════════════════════════════════════════
// DOMAIN: Task Execution Deep-Dive View
// ═══════════════════════════════════════════════════
//
// Full-page view for monitoring a task's FSM lifecycle:
// - FSM Pipeline visualization
// - Domain sub-state progress
// - Checkpoint timeline
// - Error & Recovery panel
// - Live execution logs
// - Task history

import AppState from '../../core/state.js';
import EventBus from '../../core/events.js';
import TaskRunner from '../../core/live-runner.js';
import { TASK_STATES, DOMAIN_SUB_STATES } from '../../core/state-machine.js';
import { TASK_EXECUTION_CONFIG, SAMPLE_TASKS } from '../../data/mock-data.js';
import { showToast } from '../../components/toast.js';
import { openModal, closeModal } from '../../components/modal.js';

// Internal log buffer for live-log display
let logEntries = [];
const MAX_LOG_ENTRIES = 100;

// ───────────────────────────────────────
// MAIN RENDER
// ───────────────────────────────────────

export function renderTaskExecution() {
  const task = AppState.getState('taskExecution');
  const history = _getDisplayHistory();

  return `
    <div>
      <div class="section-header">
        <div class="section-header__left">
          <div class="section-header__icon" style="background:rgba(79,142,247,0.12);">⚙</div>
          <div>
            <h2 class="section-header__title">Task Execution</h2>
            <p class="section-header__subtitle">Monitor FSM state machine, checkpoints, and domain engine pipelines</p>
          </div>
        </div>
        <div class="section-header__actions">
          <button class="btn btn--secondary" id="btn-demo-coding">▶ Demo Coding</button>
          <button class="btn btn--secondary" id="btn-demo-trading">▶ Demo Trading</button>
          <button class="btn btn--secondary" id="btn-demo-creation">▶ Demo Creation</button>
        </div>
      </div>

      <!-- Real task launcher (server-driven, GLM 5.2) -->
      <div class="card" style="padding:var(--space-4);margin-bottom:var(--space-5);">
        <div class="dashboard__section-title" style="margin-bottom:var(--space-3);">
          <span>Run a real task</span>
          <span style="font-size:var(--text-xs);color:var(--text-muted);font-weight:normal;">Streams live from the engine</span>
        </div>
        <textarea id="task-intent-input" rows="2"
          placeholder="Describe the goal, e.g. 'Write a Python function that parses ISO timestamps'"
          style="width:100%;box-sizing:border-box;resize:vertical;padding:var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-input,var(--bg-elevated));color:var(--text);font-family:inherit;font-size:var(--text-sm);"></textarea>
        <div style="display:flex;gap:var(--space-3);align-items:center;margin-top:var(--space-3);flex-wrap:wrap;">
          <select id="task-domain-select" class="btn btn--secondary" style="padding:var(--space-2) var(--space-3);">
            <option value="coding">Coding</option>
            <option value="trading">Trading</option>
            <option value="creation">Creation</option>
          </select>
          <button class="btn btn--primary" id="btn-run-task">▶ Run task</button>
        </div>
        <!-- Workspace path — only meaningful for the Coding domain -->
        <div id="workspace-input-row" style="margin-top:var(--space-3);display:flex;align-items:center;gap:var(--space-2);">
          <span style="font-size:var(--text-xs);color:var(--text-muted);white-space:nowrap;">📁 Workspace</span>
          <input id="task-workspace-input" type="text"
            placeholder="Absolute path to project folder (coding only, optional)"
            style="flex:1;padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-input,var(--bg-elevated));color:var(--text);font-family:inherit;font-size:var(--text-sm);" />
        </div>
      </div>

      ${task ? renderActiveTask(task) : renderNoActiveTask()}

      <!-- Task History -->
      <div style="margin-top:var(--space-6);">
        <div class="dashboard__section-title">
          <span>Task History</span>
          <span style="font-size:var(--text-xs);color:var(--text-muted);font-weight:normal;">${history.length} tasks</span>
        </div>
        ${history.length === 0
          ? '<div style="color:var(--text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-5);">No tasks executed yet. Click a Demo button above to start.</div>'
          : history.map(t => renderHistoryItem(t)).join('')
        }
      </div>
    </div>
  `;
}

// ───────────────────────────────────────
// ACTIVE TASK COMPONENTS
// ───────────────────────────────────────

function renderActiveTask(task) {
  const engineConfig = TASK_EXECUTION_CONFIG.domainEngines[task.domainEngine] || {};
  const subStates = DOMAIN_SUB_STATES[task.domainEngine] || [];

  return `
    <!-- Task Header -->
    <div class="task-header">
      <div class="task-header__icon task-header__icon--${task.domainEngine}">
        ${engineConfig.icon || '⚙'}
      </div>
      <div class="task-header__info">
        <div class="task-header__title">
          ${engineConfig.name || 'Task'} 
          <span class="badge badge--${getStateBadge(task.state)}" style="margin-left:var(--space-2);font-size:10px;">
            ${task.state}
          </span>
          ${task.retryCount > 0 ? `<span class="badge badge--warning" style="margin-left:var(--space-1);font-size:10px;">Retry #${task.retryCount}</span>` : ''}
        </div>
        <div class="task-header__intent">"${task.intent}"</div>
      </div>
      <div class="task-header__controls">
        ${task.state === 'HUMAN_REVIEW' 
          ? `<button class="btn btn--primary btn--sm" id="btn-approve-task">✓ Approve</button>
             <button class="btn btn--secondary btn--sm" id="btn-reject-task">✕ Reject</button>`
          : isTerminal(task.state) 
            ? ''
            : `<button class="btn btn--ghost btn--sm" id="btn-cancel-task">✕ Cancel</button>`
        }
      </div>
    </div>

    <!-- FSM Pipeline -->
    ${renderFSMPipeline(task)}

    <!-- Domain Sub-States (during EXECUTING) -->
    ${subStates.length > 0 ? renderSubStateProgress(task, subStates) : ''}

    <!-- Error Panel (if failed) -->
    ${task.errorType ? renderErrorPanel(task) : ''}

    <!-- Grid: Checkpoints + Live Log -->
    <div class="task-exec-grid">
      <!-- Checkpoints -->
      <div>
        <div class="dashboard__section-title" style="margin-bottom:var(--space-3);">
          <span>Checkpoint Timeline</span>
        </div>
        <div id="checkpoint-container" style="max-height:400px;overflow-y:auto;">
          ${renderCheckpoints(task)}
        </div>
      </div>

      <!-- Live Log -->
      <div class="live-log">
        <div class="live-log__header">
          <div class="live-log__title">
            <div class="live-log__dot"></div>
            Live Execution Log
          </div>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">${logEntries.length} entries</span>
        </div>
        <div class="live-log__body" id="live-log-body">
          ${logEntries.length === 0
            ? '<div style="color:var(--text-muted);text-align:center;padding:var(--space-4);">Waiting for task events...</div>'
            : logEntries.map(e => `
              <div class="live-log__entry">
                <span class="live-log__timestamp">${e.time}</span>
                <span class="live-log__message live-log__message--${e.type}">${e.message}</span>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>

    <!-- Validation Result (if available) -->
    ${task.validationResult ? renderValidationResult(task.validationResult) : ''}
  `;
}

function renderNoActiveTask() {
  return `
    <div class="card" style="text-align:center;padding:var(--space-8);">
      <div style="font-size:3rem;margin-bottom:var(--space-3);opacity:0.5;">⚙</div>
      <div style="font-size:var(--text-md);font-weight:var(--weight-semibold);margin-bottom:var(--space-2);">No Active Task</div>
      <div style="color:var(--text-muted);font-size:var(--text-sm);max-width:400px;margin:0 auto;">
        Start a demo task using the buttons above to see the State Machine in action. 
        Each task progresses through: IDLE → INTENT → PLANNING → ROUTING → EXECUTING → VALIDATING → PERSISTING → COMPLETED
      </div>
    </div>
  `;
}

// ───────────────────────────────────────
// FSM PIPELINE
// ───────────────────────────────────────

const PIPELINE_STATES = [
  'IDLE', 'INTENT_CAPTURED', 'PLANNING', 'ROUTING', 
  'EXECUTING', 'VALIDATING', 'PERSISTING', 'COMPLETED'
];

const STATE_ICONS = {
  IDLE: '○', INTENT_CAPTURED: '◎', PLANNING: '◈', ROUTING: '⤳',
  EXECUTING: '⚡', VALIDATING: '✓', PERSISTING: '⬡', COMPLETED: '●',
  FAILED: '✕', RECOVERY: '⟳', HUMAN_REVIEW: '👤', REVIEW_REQUIRED: '⏸',
};

const STATE_SHORT_LABELS = {
  IDLE: 'Idle', INTENT_CAPTURED: 'Intent', PLANNING: 'Plan', ROUTING: 'Route',
  EXECUTING: 'Execute', VALIDATING: 'Validate', PERSISTING: 'Persist', COMPLETED: 'Done',
  FAILED: 'Failed', RECOVERY: 'Recovery', HUMAN_REVIEW: 'Review', REVIEW_REQUIRED: 'Review',
};

function renderFSMPipeline(task) {
  const currentIdx = PIPELINE_STATES.indexOf(task.state);
  const isFailed = task.state === 'FAILED' || task.state === 'RECOVERY' || task.state === 'HUMAN_REVIEW';

  return `
    <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2);">
      <span style="font-size:var(--text-xs); color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:var(--weight-semibold);">FSM Pipeline</span>
      <span class="badge badge--info" style="font-size:10px; font-family:var(--font-mono);">Step ${task.stepIndex || 0}</span>
    </div>
    <div class="fsm-pipeline" style="margin-bottom:var(--space-4);">
      ${PIPELINE_STATES.map((state, i) => {
        let cls = '';
        if (isFailed && i <= currentIdx) {
          // If failed, show completed up to the last good state
          cls = i < currentIdx ? 'fsm-state--completed' : '';
        } else if (i < currentIdx) {
          cls = 'fsm-state--completed';
        } else if (i === currentIdx) {
          cls = task.state === 'COMPLETED' ? 'fsm-state--completed' : 'fsm-state--active';
        }

        // Handle non-pipeline states
        if (task.state === 'FAILED' && state === task.state) {
          cls = 'fsm-state--failed';
        }

        const connectorCls = i < currentIdx
          ? 'fsm-connector--completed'
          : i === currentIdx && !isTerminal(task.state)
            ? 'fsm-connector--active'
            : '';

        return `
          <div class="fsm-state ${cls}">
            <div class="fsm-state__dot">${STATE_ICONS[state] || '○'}</div>
            <div class="fsm-state__label">${STATE_SHORT_LABELS[state]}</div>
          </div>
          ${i < PIPELINE_STATES.length - 1 ? `<div class="fsm-connector ${connectorCls}"></div>` : ''}
        `;
      }).join('')}

      ${isFailed ? `
        <div class="fsm-connector fsm-connector--active" style="background:var(--error);"></div>
        <div class="fsm-state fsm-state--${task.state === 'RECOVERY' ? 'recovery' : task.state === 'HUMAN_REVIEW' ? 'recovery' : 'failed'}">
          <div class="fsm-state__dot">${STATE_ICONS[task.state]}</div>
          <div class="fsm-state__label">${STATE_SHORT_LABELS[task.state]}</div>
        </div>
      ` : ''}
    </div>
  `;
}

// ───────────────────────────────────────
// SUB-STATE PROGRESS
// ───────────────────────────────────────

const SUB_STATE_ICONS = {
  // Coding
  SCAN_REPO: '🔍', PATCH_CODE: '✏️', RUN_TESTS: '🧪', FIX_ERRORS: '🔧',
  // Trading
  MARKET_READ: '📊', SENTIMENT_CHECK: '🧠', SETUP_GRADE: '⭐', RISK_APPROVAL: '🛡️',
  // Creation
  IDEATE: '💡', DRAFT: '📝', CRITIQUE: '🎯', POLISH: '✨',
};

function renderSubStateProgress(task, subStates) {
  return `
    <div class="sub-state-progress sub-state-progress--${task.domainEngine}">
      ${subStates.map((ss, i) => {
        const output = task.keyOutputs?.[ss];
        const isCompleted = !!output;
        const isActive = task.subState === ss && task.state === 'EXECUTING';

        return `
          <div class="sub-state-item ${isCompleted ? 'sub-state-item--completed' : ''} ${isActive ? 'sub-state-item--active' : ''}">
            <div class="sub-state-item__icon">${isCompleted ? '✓' : isActive ? '⚡' : SUB_STATE_ICONS[ss] || '○'}</div>
            <div class="sub-state-item__name">${ss.replace(/_/g, ' ')}</div>
            ${output 
              ? `<div class="sub-state-item__duration">${output.duration}ms</div>` 
              : isActive 
                ? '<div class="sub-state-item__duration" style="color:var(--accent-primary);">running...</div>'
                : '<div class="sub-state-item__duration">waiting</div>'
            }
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ───────────────────────────────────────
// CHECKPOINTS
// ───────────────────────────────────────

function renderCheckpoints(task) {
  // Use sample data checkpoints or generate from task context
  const checkpoints = _buildCheckpointsFromTask(task);
  
  if (checkpoints.length === 0) {
    return '<div style="color:var(--text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-4);">No checkpoints yet</div>';
  }

  return checkpoints.map((cp, i) => `
    <div class="checkpoint-card">
      <div class="checkpoint-card__index">${i + 1}</div>
      <div class="checkpoint-card__body">
        <div class="checkpoint-card__state">
          <span class="badge badge--${getStateBadge(cp.currentState)}" style="font-size:10px;">${cp.currentState}</span>
          ${cp.subState ? `<span style="margin-left:var(--space-1);font-size:10px;color:var(--text-muted);">» ${cp.subState}</span>` : ''}
        </div>
        <div class="checkpoint-card__meta">
          <div class="checkpoint-card__meta-item">
            <span>Step:</span> <span style="color:var(--text-primary);">${cp.stepIndex}</span>
          </div>
          <div class="checkpoint-card__meta-item">
            <span>Retry safe:</span> 
            <span style="color:${cp.retrySafe ? 'var(--success)' : 'var(--error)'};">${cp.retrySafe ? 'Yes' : 'No'}</span>
          </div>
          <div class="checkpoint-card__meta-item">
            <span>Next:</span> <span style="color:var(--text-secondary);">${cp.nextRecommendedAction}</span>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function _buildCheckpointsFromTask(task) {
  // Build synthetic checkpoints from task's current state
  const checkpoints = [];
  const states = ['IDLE', 'INTENT_CAPTURED', 'PLANNING', 'ROUTING', 'EXECUTING', 'VALIDATING', 'PERSISTING', 'COMPLETED'];
  const currentIdx = states.indexOf(task.state);
  const maxIdx = currentIdx >= 0 ? currentIdx : states.length - 1;

  const nextActions = {
    IDLE: 'Capture user intent',
    INTENT_CAPTURED: 'Begin planning',
    PLANNING: 'Route to domain engine',
    ROUTING: 'Execute assigned work',
    EXECUTING: 'Validate execution result',
    VALIDATING: 'Persist validated result',
    PERSISTING: 'Mark as completed',
    COMPLETED: 'Task finished',
  };

  for (let i = 0; i <= maxIdx && i < states.length; i++) {
    checkpoints.push({
      currentState: states[i],
      stepIndex: i + 1,
      retrySafe: i < 5,  // Safe up to EXECUTING
      nextRecommendedAction: nextActions[states[i]] || 'Unknown',
      subState: states[i] === 'EXECUTING' && task.subState ? task.subState : null,
    });
  }

  // If in sub-states, add sub-state checkpoints
  if (task.state === 'EXECUTING' && task.keyOutputs) {
    const subStates = DOMAIN_SUB_STATES[task.domainEngine] || [];
    subStates.forEach((ss, i) => {
      if (task.keyOutputs[ss]) {
        checkpoints.push({
          currentState: 'EXECUTING',
          stepIndex: maxIdx + i + 2,
          retrySafe: true,
          nextRecommendedAction: `Complete ${ss.replace(/_/g, ' ').toLowerCase()}`,
          subState: ss,
        });
      }
    });
  }

  // Add error checkpoint if failed
  if (task.state === 'FAILED' || task.errorType) {
    checkpoints.push({
      currentState: 'FAILED',
      stepIndex: task.stepIndex || checkpoints.length + 1,
      retrySafe: task.retryCount < 3,
      nextRecommendedAction: 'Initiate recovery',
      subState: null,
    });
  }

  return checkpoints;
}

// ───────────────────────────────────────
// ERROR PANEL
// ───────────────────────────────────────

const ERROR_TYPE_LABELS = {
  LOGIC_FAILURE: 'Logic Failure',
  EXECUTION_FAILURE: 'Execution Failure',
  VALIDATION_FAILURE: 'Validation Failure',
  GOVERNANCE_FAILURE: 'Governance Failure',
};

const RECOVERY_PATHS = {
  LOGIC_FAILURE: 'Return to PLANNING for re-analysis',
  EXECUTION_FAILURE: 'Restore last safe checkpoint and retry',
  VALIDATION_FAILURE: 'Rework output in EXECUTING phase',
  GOVERNANCE_FAILURE: 'Escalate to HUMAN_REVIEW for approval',
};

function renderErrorPanel(task) {
  const isWarning = task.errorType === 'GOVERNANCE_FAILURE';
  
  return `
    <div class="error-panel ${isWarning ? 'error-panel--warning' : ''}">
      <div class="error-panel__header">
        <div class="error-panel__icon">${isWarning ? '⚠' : '✕'}</div>
        <div class="error-panel__title">${ERROR_TYPE_LABELS[task.errorType] || task.errorType}</div>
        ${task.retryCount > 0 ? `<span class="badge badge--warning" style="font-size:10px;margin-left:auto;">Retry ${task.retryCount}/3</span>` : ''}
      </div>
      <div class="error-panel__message">${task.errorMessage || 'Unknown error'}</div>
      <div class="error-panel__recovery">
        <span class="error-panel__recovery-label">Recovery Path:</span>
        <span>${RECOVERY_PATHS[task.errorType] || 'Manual intervention required'}</span>
      </div>
    </div>
  `;
}

// ───────────────────────────────────────
// VALIDATION RESULT
// ───────────────────────────────────────

function renderValidationResult(result) {
  return `
    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header">
        <div class="card__title">Validation Result</div>
        <span class="badge badge--${result.passed ? 'success' : 'error'}" style="font-size:var(--text-xs);">
          ${result.passed ? 'PASSED' : 'FAILED'} – Score: ${result.score}/100
        </span>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-3);">
          ${(result.checks || []).map(check => `
            <div style="flex:1;padding:var(--space-3);background:var(--bg-elevated);border-radius:var(--radius-md);border:1px solid ${check.passed ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'};display:flex;align-items:center;gap:var(--space-2);">
              <span style="color:${check.passed ? 'var(--success)' : 'var(--error)'};">${check.passed ? '✓' : '✕'}</span>
              <span style="font-size:var(--text-sm);">${check.name}</span>
            </div>
          `).join('')}
        </div>
        ${result.reasons ? `
          <div style="margin-top:var(--space-3);padding:var(--space-3);background:var(--bg-elevated);border-radius:var(--radius-md);border-left:3px solid var(--warning);">
            <div style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-1);text-transform:uppercase;">Judge Reasons</div>
            <div style="font-size:var(--text-sm);">${result.reasons}</div>
          </div>
        ` : ''}
        ${result.feedback ? `
          <div style="margin-top:var(--space-3);padding:var(--space-3);background:var(--bg-elevated);border-radius:var(--radius-md);border-left:3px solid var(--accent-primary);">
            <div style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-1);text-transform:uppercase;">Feedback for Rework</div>
            <div style="font-size:var(--text-sm);">${result.feedback}</div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ───────────────────────────────────────
// HISTORY ITEMS
// ───────────────────────────────────────

function renderHistoryItem(task) {
  const engineConfig = TASK_EXECUTION_CONFIG.domainEngines[task.domainEngine] || {};
  const statusCls = task.state === 'COMPLETED' ? 'completed' 
    : task.state === 'FAILED' ? 'failed' 
    : 'running';
  const elapsed = task.completedAt 
    ? `${((task.completedAt - task.startedAt) / 1000).toFixed(1)}s` 
    : 'in progress';

  return `
    <div class="task-history-item" data-task-id="${task.taskId}">
      <div class="task-history-item__status task-history-item__status--${statusCls}"></div>
      <div style="font-size:var(--text-sm);margin-right:var(--space-2);">${engineConfig.icon || '⚙'}</div>
      <div class="task-history-item__info">
        <div class="task-history-item__intent">${task.intent}</div>
        <div class="task-history-item__meta">
          <span>${task.routedAgent || 'Auto'}</span>
          <span>•</span>
          <span>${task.domainEngine}</span>
          <span>•</span>
          <span>${elapsed}</span>
          <span>•</span>
          <span>Steps: ${task.stepIndex}</span>
          ${task.retryCount > 0 ? `<span>• Retries: ${task.retryCount}</span>` : ''}
        </div>
      </div>
      <span class="badge badge--${getStateBadge(task.state)}" style="font-size:10px;">${task.state}</span>
    </div>
  `;
}

// ───────────────────────────────────────
// HELPERS
// ───────────────────────────────────────

function getStateBadge(state) {
  switch (state) {
    case 'COMPLETED': return 'success';
    case 'FAILED': return 'error';
    case 'EXECUTING': case 'VALIDATING': case 'PERSISTING': return 'info';
    case 'RECOVERY': case 'HUMAN_REVIEW': return 'warning';
    default: return 'info';
  }
}

function isTerminal(state) {
  return state === 'COMPLETED' || state === 'REVIEW_REQUIRED' || state === 'FAILED';
}

function _getDisplayHistory() {
  const stored = AppState.getState('taskHistory') || [];
  // Merge sample tasks for demo purposes (if no real history)
  if (stored.length === 0) {
    return SAMPLE_TASKS;
  }
  return stored;
}

// ───────────────────────────────────────
// EVENT LISTENERS
// ───────────────────────────────────────

export function initTaskExecutionEvents() {
  // Demo buttons
  ['coding', 'trading', 'creation'].forEach(domain => {
    document.getElementById(`btn-demo-${domain}`)?.addEventListener('click', () => {
      const intents = {
        coding: 'Refactor user authentication module to use JWT tokens',
        trading: 'Analyze ETH/USD 4H chart and generate swing trade setup',
        creation: 'Generate hero banner and product copy for Q3 campaign',
      };
      
      logEntries = []; // Reset log
      TaskRunner.startTask({
        intent: intents[domain],
        domainEngine: domain,
      }).catch((err) => showToast(`Could not start task: ${err.message}`, 'error'));
      showToast(`Started ${domain} task — watch the FSM pipeline!`, 'success');
    });
  });

  // Show workspace row only for coding domain
  const domainSel = document.getElementById('task-domain-select');
  const wsRow = document.getElementById('workspace-input-row');
  function _syncWsRow() {
    if (wsRow) wsRow.style.display = domainSel?.value === 'coding' ? 'flex' : 'none';
  }
  domainSel?.addEventListener('change', _syncWsRow);
  _syncWsRow(); // initial state

  // Real task launcher
  document.getElementById('btn-run-task')?.addEventListener('click', () => {
    const input = document.getElementById('task-intent-input');
    const domain = document.getElementById('task-domain-select')?.value || 'coding';
    const intent = (input?.value || '').trim();
    const workspacePath = (document.getElementById('task-workspace-input')?.value || '').trim();
    if (!intent) {
      showToast('Enter a goal first', 'warning');
      return;
    }
    logEntries = []; // Reset log
    TaskRunner.startTask({
      intent, domainEngine: domain,
      workspaceId: (domain === 'coding' && workspacePath) ? workspacePath : null,
    }).then(() => showToast(`Running ${domain} task — streaming live…`, 'success'))
      .catch((err) => showToast(`Could not start task: ${err.message}`, 'error'));
  });

  // Cancel button
  document.getElementById('btn-cancel-task')?.addEventListener('click', () => {
    const task = AppState.getState('taskExecution');
    if (task) {
      TaskRunner.cancelTask(task.taskId);
      showToast('Task cancelled', 'warning');
    }
  });

  // Human review buttons
  document.getElementById('btn-approve-task')?.addEventListener('click', () => {
    const task = AppState.getState('taskExecution');
    if (task) {
      TaskRunner.resolveHumanReview(task.taskId, true);
      showToast('Task approved — resuming execution', 'success');
    }
  });

  document.getElementById('btn-reject-task')?.addEventListener('click', () => {
    const task = AppState.getState('taskExecution');
    if (task) {
      TaskRunner.resolveHumanReview(task.taskId, false);
      showToast('Task rejected', 'warning');
    }
  });

  // Debounced re-render — collapses rapid bursts of events into one repaint
  let _renderPending = false;
  function _scheduleRender() {
    if (_renderPending) return;
    _renderPending = true;
    requestAnimationFrame(() => {
      _renderPending = false;
      EventBus.emit('navigate', 'task-execution');
    });
  }

  // Surgical log-only DOM update — appends one row without re-rendering the page
  function _appendLogDom(type, message) {
    _addLogEntry(type, message);
    const body = document.getElementById('live-log-body');
    if (!body) return;
    // Remove placeholder if present
    const placeholder = body.querySelector('[style*="Waiting"]');
    if (placeholder) placeholder.remove();
    const entry = logEntries[logEntries.length - 1];
    const row = document.createElement('div');
    row.className = 'live-log__entry';
    row.innerHTML = `<span class="live-log__timestamp">${entry.time}</span><span class="live-log__message live-log__message--${entry.type}">${entry.message}</span>`;
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  // Subscribe to FSM events for live updates
  const unsubState = EventBus.on('task:stateChange', (data) => {
    _addLogEntry('info', `State: ${data.from} → ${data.to}`);
    _scheduleRender();
  });

  const unsubSub = EventBus.on('task:subStateChange', (data) => {
    _addLogEntry('success', `Sub-state: ${data.subState} (${data.subStateIndex + 1}/${data.totalSubStates})`);
    _scheduleRender();
  });

  const unsubCancel = EventBus.on('task:cancelled', (data) => {
    _addLogEntry('warning', `Task ${data.taskId} cancelled by user`);
  });

  // Live engine logs — append directly to DOM, no full re-render
  const unsubLog = EventBus.on('task:log', (data) => {
    const tag = data.phase ? `[${data.phase}${data.status ? `:${data.status}` : ''}]` : '';
    const body = data.message || data.preview || (data.plan && data.plan.summary) || '';
    if (tag || body) _appendLogDom(data.status === 'fail' ? 'warning' : 'info', `${tag} ${body}`.trim());
  });

  const unsubErr = EventBus.on('task:error', (data) => {
    _appendLogDom('error', `Error${data.code ? ` (${data.code})` : ''}: ${data.message || 'unknown'}`);
    _scheduleRender();
  });

  const unsubDone = EventBus.on('task:done', (data) => {
    _appendLogDom('success', `Done: ${data.state}${typeof data.score === 'number' ? ` (score ${data.score})` : ''}`);
    _scheduleRender();
  });

  // Cleanup on navigate away
  const cleanup = EventBus.on('navigate', (route) => {
    if (route !== 'task-execution') {
      unsubState();
      unsubSub();
      unsubCancel();
      unsubLog();
      unsubErr();
      unsubDone();
      cleanup();
    }
  });
}

function _addLogEntry(type, message) {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  logEntries.push({ type, message, time });
  
  // FIFO
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.shift();
  }
}
