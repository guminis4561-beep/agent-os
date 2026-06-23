// ═══════════════════════════════════════════════════
// CORE: Live Runner (server-driven orchestration)
// ═══════════════════════════════════════════════════
//
// Drop-in replacement for the mock TaskRunner. Instead of simulating the FSM in
// the browser, it POSTs intents to the backend and mirrors the real task's
// progress (streamed over SSE) into AppState + EventBus, so the existing views
// update live with no changes to their render logic.

import AppState from './state.js';
import EventBus from './events.js';
import Storage from './storage.js';
import * as Api from './api-client.js';

const LiveRunner = (() => {
  /** @type {Map<string, object>} taskId → latest public context */
  const tasks = new Map();
  let unsubscribe = null;
  let started = false;

  const TERMINAL = new Set(['COMPLETED', 'REVIEW_REQUIRED', 'FAILED', 'CANCELLED']);

  // ─────────────────────────────
  // SSE → AppState/EventBus bridge
  // ─────────────────────────────

  function onServerEvent(name, data) {
    switch (name) {
      case 'task:created':
        tasks.set(data.taskId, {
          taskId: data.taskId,
          state: 'INTENT_CAPTURED',
          subState: null,
          subStateIndex: -1,
          domainEngine: data.domainEngine,
          stepIndex: 0,
          retryCount: 0,
          startedAt: Date.now(),
          completedAt: null,
          intent: data.intent,
          plan: null,
          routedAgent: data.agent,
          executionResult: null,
          validationResult: null,
          errorType: null,
          errorMessage: null,
          keyOutputs: {},
          resourceIds: [],
        });
        _sync();
        break;

      case 'task:stateChange': {
        // Server payload carries the full public context snapshot.
        const ctx = data.context || tasks.get(data.taskId);
        if (ctx) tasks.set(data.taskId, ctx);
        _sync();
        // Re-emit so views listening on the client EventBus re-render.
        EventBus.emit('task:stateChange', data);
        if (TERMINAL.has(data.to)) _saveToHistory(data.taskId);
        break;
      }

      case 'task:subStateChange': {
        const ctx = tasks.get(data.taskId);
        if (ctx) {
          ctx.subState = data.subState;
          ctx.subStateIndex = data.subStateIndex;
          _sync();
        }
        EventBus.emit('task:subStateChange', data);
        break;
      }

      case 'task:log':
        EventBus.emit('task:log', data);
        break;

      case 'task:error': {
        const ctx = tasks.get(data.taskId);
        if (ctx) {
          ctx.errorMessage = data.message;
          ctx.errorCode = data.code;
          _sync();
        }
        EventBus.emit('task:error', data);
        break;
      }

      case 'task:done': {
        const ctx = tasks.get(data.taskId);
        if (ctx) {
          ctx.state = data.state || ctx.state;
          ctx.completedAt = Date.now();
          if (data.output) ctx.finalOutput = data.output;
          if (typeof data.score === 'number') ctx.score = data.score;
          if (data.resourceId) ctx.resourceIds = [...(ctx.resourceIds || []), data.resourceId];
        }
        _saveToHistory(data.taskId);
        _sync();
        EventBus.emit('task:done', data);
        break;
      }

      case 'sys:reconnected': {
        const active = getActiveTask();
        if (active && active.taskId) {
          Api.getTask(active.taskId).then((ctx) => {
            if (ctx) {
              tasks.set(active.taskId, ctx);
              _sync();
              EventBus.emit('task:stateChange', {
                taskId: ctx.taskId, from: active.state, to: ctx.state,
                stepIndex: ctx.stepIndex, subState: ctx.subState, context: ctx
              });
              if (TERMINAL.has(ctx.state)) {
                _saveToHistory(ctx.taskId);
                EventBus.emit('task:done', {
                  taskId: ctx.taskId, state: ctx.state,
                  score: ctx.score || ctx.validationResult?.score,
                  resourceId: ctx.resourceIds?.[ctx.resourceIds.length - 1],
                  output: ctx.finalOutput
                });
              }
            }
          }).catch(() => {});
        }
        break;
      }

      default:
        break;
    }
  }

  // ─────────────────────────────
  // PUBLIC API (mirrors mock TaskRunner)
  // ─────────────────────────────

  /**
   * Start a real task on the server.
   * @returns {Promise<{taskId: string}>}
   */
  async function startTask({ intent, domainEngine = 'coding', agentName = null, workspaceId = null }) {
    try {
      const { taskId } = await Api.startTask({ intent, domainEngine, agentName, workspaceId });
      return { taskId };
    } catch (err) {
      EventBus.emit('task:error', { message: err.message, fatal: true });
      AppState.setState('taskExecution', {
        taskId: `local-${Date.now()}`,
        state: 'FAILED',
        domainEngine,
        intent,
        errorMessage: err.message,
        startedAt: Date.now(),
        completedAt: Date.now(),
        keyOutputs: {},
        resourceIds: [],
      });
      throw err;
    }
  }

  function getActiveTask() {
    for (const ctx of tasks.values()) {
      if (!TERMINAL.has(ctx.state)) return ctx;
    }
    return null;
  }

  function getTask(taskId) {
    return tasks.get(taskId) || null;
  }

  function getAllTasks() {
    return Array.from(tasks.values());
  }

  function getTaskHistory() {
    return Storage.get('taskHistory', []);
  }

  /**
   * Resolve a REVIEW_REQUIRED escalation on the server. `approved === true`
   * persists the output as-is (→COMPLETED); `false` sends it back for another
   * rework round (→EXECUTING). The resulting state arrives over SSE.
   * @returns {Promise<object>}
   */
  async function resolveHumanReview(taskId, approved, feedback = '') {
    return Api.resumeTask(taskId, {
      action: approved ? 'approve' : 'rework',
      feedback,
    });
  }

  /**
   * Cancel a running (or review-paused) task on the server. The CANCELLED state
   * is delivered over SSE (task:done), which updates the view.
   * @returns {Promise<object>}
   */
  async function cancelTask(taskId) {
    return Api.cancelTask(taskId);
  }

  function init() {
    if (started) return;
    started = true;
    AppState.setState('taskHistory', Storage.get('taskHistory', []));
    unsubscribe = Api.subscribeEvents(onServerEvent);
    console.log('[LiveRunner] Subscribed to server event stream');
  }

  function dispose() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    started = false;
  }

  // ─────────────────────────────
  // INTERNAL
  // ─────────────────────────────

  function _sync() {
    const active = getActiveTask();
    AppState.setState('taskExecution', active);
  }

  function _saveToHistory(taskId) {
    const ctx = tasks.get(taskId);
    if (!ctx) return;
    const history = Storage.get('taskHistory', []);
    if (history.find((h) => h.taskId === taskId)) return;
    history.push({ ...ctx });
    if (history.length > 50) history.shift();
    Storage.set('taskHistory', history);
    AppState.setState('taskHistory', history);
  }

  return {
    startTask,
    getActiveTask,
    getTask,
    getAllTasks,
    getTaskHistory,
    resolveHumanReview,
    cancelTask,
    init,
    dispose,
  };
})();

export default LiveRunner;
