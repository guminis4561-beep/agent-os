// ═══════════════════════════════════════════════════
// CORE: Task State Machine (Deterministic FSM)
// ═══════════════════════════════════════════════════
//
// Ensures every task is in exactly ONE state at any time.
// Transitions only occur when strict guard conditions are met.
// Checkpoints are created after every significant step.

import EventBus from './events.js';
import Storage from './storage.js';

// ───────────────────────────────────────
// ENUMS
// ───────────────────────────────────────

/**
 * Primary task states – the main lifecycle
 */
export const TASK_STATES = Object.freeze({
  IDLE:             'IDLE',
  INTENT_CAPTURED:  'INTENT_CAPTURED',
  PLANNING:         'PLANNING',
  ROUTING:          'ROUTING',
  EXECUTING:        'EXECUTING',
  VALIDATING:       'VALIDATING',
  PERSISTING:       'PERSISTING',
  COMPLETED:        'COMPLETED',
  REVIEW_REQUIRED:  'REVIEW_REQUIRED',
  REWORK:           'REWORK',
  FAILED:           'FAILED',
  RECOVERY:         'RECOVERY',
  HUMAN_REVIEW:     'HUMAN_REVIEW',
  CANCELLED:        'CANCELLED',
});

/**
 * Error types that determine recovery path
 */
export const ERROR_TYPES = Object.freeze({
  LOGIC_FAILURE:      'LOGIC_FAILURE',       // Planning failed → re-plan
  EXECUTION_FAILURE:  'EXECUTION_FAILURE',   // Tool call / agent crash → restore checkpoint
  VALIDATION_FAILURE: 'VALIDATION_FAILURE',  // Bad output → rework
  GOVERNANCE_FAILURE: 'GOVERNANCE_FAILURE',  // Missing permissions → human review
});

/**
 * Domain engine sub-states active during EXECUTING
 */
export const DOMAIN_SUB_STATES = Object.freeze({
  coding:   ['SCAN_REPO', 'PATCH_CODE', 'RUN_TESTS', 'FIX_ERRORS'],
  trading:  ['MARKET_READ', 'SENTIMENT_CHECK', 'SETUP_GRADE', 'RISK_APPROVAL'],
  creation: ['IDEATE', 'DRAFT', 'CRITIQUE', 'POLISH'],
});

// ───────────────────────────────────────
// TRANSITION MAP
// ───────────────────────────────────────

/**
 * Allowed transitions: { from: [to1, to2, ...] }
 */
const TRANSITION_MAP = Object.freeze({
  [TASK_STATES.IDLE]:             [TASK_STATES.INTENT_CAPTURED],
  [TASK_STATES.INTENT_CAPTURED]:  [TASK_STATES.PLANNING],
  [TASK_STATES.PLANNING]:         [TASK_STATES.ROUTING, TASK_STATES.FAILED, TASK_STATES.CANCELLED],
  [TASK_STATES.ROUTING]:          [TASK_STATES.EXECUTING, TASK_STATES.FAILED, TASK_STATES.CANCELLED],
  [TASK_STATES.EXECUTING]:        [TASK_STATES.VALIDATING, TASK_STATES.FAILED, TASK_STATES.CANCELLED],
  [TASK_STATES.VALIDATING]:       [TASK_STATES.PERSISTING, TASK_STATES.FAILED, TASK_STATES.REVIEW_REQUIRED, TASK_STATES.REWORK, TASK_STATES.CANCELLED],
  [TASK_STATES.PERSISTING]:       [TASK_STATES.COMPLETED, TASK_STATES.FAILED, TASK_STATES.CANCELLED],
  [TASK_STATES.COMPLETED]:        [],  // Terminal
  // Resumable escalation: user can approve current output (→PERSISTING) or send
  // it back for another rework round (→EXECUTING).
  [TASK_STATES.REVIEW_REQUIRED]:  [TASK_STATES.PERSISTING, TASK_STATES.EXECUTING, TASK_STATES.CANCELLED],
  [TASK_STATES.REWORK]:           [TASK_STATES.EXECUTING, TASK_STATES.FAILED, TASK_STATES.CANCELLED],
  [TASK_STATES.FAILED]:           [TASK_STATES.RECOVERY],
  [TASK_STATES.RECOVERY]:         [TASK_STATES.PLANNING, TASK_STATES.EXECUTING, TASK_STATES.HUMAN_REVIEW],
  [TASK_STATES.HUMAN_REVIEW]:     [TASK_STATES.EXECUTING, TASK_STATES.COMPLETED],
  [TASK_STATES.CANCELLED]:        [],  // Terminal (user aborted)
});

// ───────────────────────────────────────
// GUARD CONDITIONS
// ───────────────────────────────────────

/**
 * Guard functions that must return `true` for a transition to proceed.
 * Key format: "FROM→TO"
 * @type {Object.<string, function(Object): boolean>}
 */
const GUARDS = {
  // User must provide a clear intent string
  [`${TASK_STATES.IDLE}→${TASK_STATES.INTENT_CAPTURED}`]: (ctx) => {
    return typeof ctx.intent === 'string' && ctx.intent.trim().length > 0;
  },

  // Intent must be captured
  [`${TASK_STATES.INTENT_CAPTURED}→${TASK_STATES.PLANNING}`]: (ctx) => {
    return !!ctx.intent;
  },

  // Plan must have at least one action and one responsible agent
  [`${TASK_STATES.PLANNING}→${TASK_STATES.ROUTING}`]: (ctx) => {
    return ctx.plan
      && Array.isArray(ctx.plan.actions)
      && ctx.plan.actions.length > 0
      && typeof ctx.plan.assignedAgent === 'string'
      && ctx.plan.assignedAgent.length > 0;
  },

  // Must have a routed agent assignment
  [`${TASK_STATES.ROUTING}→${TASK_STATES.EXECUTING}`]: (ctx) => {
    return !!ctx.routedAgent && !!ctx.domainEngine;
  },

  // Execution must produce a result
  [`${TASK_STATES.EXECUTING}→${TASK_STATES.VALIDATING}`]: (ctx) => {
    return ctx.executionResult !== undefined && ctx.executionResult !== null;
  },

  // Validation must pass or get explicit human approval
  [`${TASK_STATES.VALIDATING}→${TASK_STATES.PERSISTING}`]: (ctx) => {
    return ctx.validationResult && ctx.validationResult.passed === true;
  },

  // Judge rejected the output → loop back for rework (quality failure, not a crash)
  [`${TASK_STATES.VALIDATING}→${TASK_STATES.REWORK}`]: (ctx) => {
    return ctx.validationResult && ctx.validationResult.passed === false;
  },

  // Rework always re-enters execution (retry cap enforced by orchestrator via isRetrySafe)
  [`${TASK_STATES.REWORK}→${TASK_STATES.EXECUTING}`]: () => true,

  // Human approved the escalated output → persist it as-is.
  [`${TASK_STATES.REVIEW_REQUIRED}→${TASK_STATES.PERSISTING}`]: (ctx) => {
    return ctx.humanApproval === true;
  },

  // Human sent the escalated output back for another rework round.
  [`${TASK_STATES.REVIEW_REQUIRED}→${TASK_STATES.EXECUTING}`]: (ctx) => {
    return ctx.humanApproval === false && !!ctx.routedAgent && !!ctx.domainEngine;
  },

  // Persisting needs a valid result to store
  [`${TASK_STATES.PERSISTING}→${TASK_STATES.COMPLETED}`]: (ctx) => {
    return ctx.persistedResourceId !== undefined;
  },

  // Failed needs an error type for recovery classification
  [`${TASK_STATES.FAILED}→${TASK_STATES.RECOVERY}`]: (ctx) => {
    return !!ctx.errorType && Object.values(ERROR_TYPES).includes(ctx.errorType);
  },

  // Recovery to planning – only for logic failures
  [`${TASK_STATES.RECOVERY}→${TASK_STATES.PLANNING}`]: (ctx) => {
    return ctx.errorType === ERROR_TYPES.LOGIC_FAILURE;
  },

  // Recovery to executing – only for execution/validation failures
  [`${TASK_STATES.RECOVERY}→${TASK_STATES.EXECUTING}`]: (ctx) => {
    return ctx.errorType === ERROR_TYPES.EXECUTION_FAILURE
      || ctx.errorType === ERROR_TYPES.VALIDATION_FAILURE;
  },

  // Recovery to human review – only for governance failures
  [`${TASK_STATES.RECOVERY}→${TASK_STATES.HUMAN_REVIEW}`]: (ctx) => {
    return ctx.errorType === ERROR_TYPES.GOVERNANCE_FAILURE;
  },

  // Human review approval
  [`${TASK_STATES.HUMAN_REVIEW}→${TASK_STATES.EXECUTING}`]: (ctx) => {
    return ctx.humanApproval === true;
  },

  [`${TASK_STATES.HUMAN_REVIEW}→${TASK_STATES.COMPLETED}`]: (ctx) => {
    return ctx.humanApproval === false; // Rejected → mark as done (cancelled)
  },
};

// ───────────────────────────────────────
// TASK STATE MACHINE CLASS
// ───────────────────────────────────────

export class TaskStateMachine {
  /**
   * @param {Object} options
   * @param {string} options.taskId - Unique task identifier
   * @param {string} [options.domainEngine] - 'coding' | 'trading' | 'creation'
   */
  constructor({ taskId, domainEngine = null }) {
    this.taskId = taskId;
    this.state = TASK_STATES.IDLE;
    this.domainEngine = domainEngine;
    this.subState = null;
    this.subStateIndex = -1;
    this.stepIndex = 0;
    this.startedAt = Date.now();
    this.completedAt = null;
    this.retryCount = 0;
    this.maxRetries = 3;

    // Execution context – accumulates data as task progresses
    this.context = {
      intent: null,
      plan: null,
      routedAgent: null,
      domainEngine: domainEngine,
      executionResult: null,
      validationResult: null,
      persistedResourceId: null,
      errorType: null,
      errorMessage: null,
      humanApproval: null,
      finalOutput: null,
      keyOutputs: {},
      resourceIds: [],
    };

    // Checkpoint history
    this.checkpoints = [];
    this.maxCheckpoints = 20;

    // Transition history (for audit)
    this.history = [
      { from: null, to: TASK_STATES.IDLE, timestamp: Date.now(), stepIndex: 0 },
    ];
  }

  // ─────────────────────────────
  // PUBLIC API
  // ─────────────────────────────

  /**
   * Attempt a state transition.
   * @param {string} targetState - The target TASK_STATES value
   * @param {Object} [contextUpdates={}] - Partial context updates
   * @returns {{ success: boolean, error?: string }}
   */
  transition(targetState, contextUpdates = {}) {
    const from = this.state;
    const to = targetState;

    // 1. Check if transition is structurally allowed
    const allowed = TRANSITION_MAP[from];
    if (!allowed || !allowed.includes(to)) {
      const error = `[FSM] Transition ${from} → ${to} is not allowed`;
      console.warn(error);
      return { success: false, error };
    }

    // 2. Apply context updates before guard check
    Object.assign(this.context, contextUpdates);

    // 3. Check guard condition
    const guardKey = `${from}→${to}`;
    const guardFn = GUARDS[guardKey];
    if (guardFn && !guardFn(this.context)) {
      const error = `[FSM] Guard condition failed for ${from} → ${to}`;
      console.warn(error);
      return { success: false, error };
    }

    // 4. Execute transition
    const previousState = this.state;
    this.state = to;
    this.stepIndex++;

    // 5. Handle sub-states for EXECUTING
    if (to === TASK_STATES.EXECUTING && this.domainEngine) {
      const subStates = DOMAIN_SUB_STATES[this.domainEngine];
      if (subStates) {
        this.subStateIndex = 0;
        this.subState = subStates[0];
      }
    } else if (to !== TASK_STATES.EXECUTING) {
      this.subState = null;
      this.subStateIndex = -1;
    }

    // 6. Handle terminal states
    if (to === TASK_STATES.COMPLETED || to === TASK_STATES.REVIEW_REQUIRED || to === TASK_STATES.CANCELLED) {
      this.completedAt = Date.now();
    }

    // 7. Track retry on recovery or rework loop
    if (from === TASK_STATES.RECOVERY || from === TASK_STATES.REWORK) {
      this.retryCount++;
    }

    // 8. Record history
    this.history.push({
      from: previousState,
      to,
      timestamp: Date.now(),
      stepIndex: this.stepIndex,
      contextSnapshot: { ...contextUpdates },
    });

    // 9. Create checkpoint
    this._createCheckpoint();

    // 10. Emit event for UI
    EventBus.emit('task:stateChange', {
      taskId: this.taskId,
      from: previousState,
      to,
      stepIndex: this.stepIndex,
      subState: this.subState,
      context: this.getPublicContext(),
      timestamp: Date.now(),
    });

    console.log(`[FSM] ${this.taskId}: ${previousState} → ${to}${this.subState ? ` (sub: ${this.subState})` : ''}`);
    return { success: true };
  }

  /**
   * Advance to the next domain engine sub-state during EXECUTING.
   * @returns {{ success: boolean, subState?: string, completed?: boolean }}
   */
  advanceSubState() {
    if (this.state !== TASK_STATES.EXECUTING || !this.domainEngine) {
      return { success: false };
    }

    const subStates = DOMAIN_SUB_STATES[this.domainEngine];
    if (!subStates) return { success: false };

    const nextIndex = this.subStateIndex + 1;
    if (nextIndex >= subStates.length) {
      // All sub-states completed
      this.subState = null;
      this.subStateIndex = subStates.length;
      return { success: true, completed: true };
    }

    this.subStateIndex = nextIndex;
    this.subState = subStates[nextIndex];
    this.stepIndex++;

    // Checkpoint on sub-state advance
    this._createCheckpoint();

    // Emit sub-state change
    EventBus.emit('task:subStateChange', {
      taskId: this.taskId,
      subState: this.subState,
      subStateIndex: this.subStateIndex,
      totalSubStates: subStates.length,
      domainEngine: this.domainEngine,
      timestamp: Date.now(),
    });

    console.log(`[FSM] ${this.taskId}: Sub-state → ${this.subState} (${this.subStateIndex + 1}/${subStates.length})`);
    return { success: true, subState: this.subState, completed: false };
  }

  /**
   * Trigger failure from any failing state.
   * @param {string} errorType - One of ERROR_TYPES
   * @param {string} errorMessage - Human-readable error description
   * @returns {{ success: boolean, error?: string }}
   */
  fail(errorType, errorMessage) {
    const failableStates = [
      TASK_STATES.PLANNING,
      TASK_STATES.ROUTING,
      TASK_STATES.EXECUTING,
      TASK_STATES.VALIDATING,
      TASK_STATES.PERSISTING,
      TASK_STATES.RECOVERY,
    ];

    if (!failableStates.includes(this.state)) {
      return { success: false, error: `Cannot fail from state ${this.state}` };
    }

    return this.transition(TASK_STATES.FAILED, { errorType, errorMessage });
  }

  /**
   * Check if the task can be safely retried without data corruption.
   * @returns {boolean}
   */
  isRetrySafe() {
    // Not safe if we've exhausted retries
    if (this.retryCount >= this.maxRetries) return false;

    // Not safe if we've persisted (would duplicate)
    if (this.context.persistedResourceId) return false;

    return true;
  }

  /**
   * Get a safe public snapshot of current context (no internal refs).
   * @returns {Object}
   */
  getPublicContext() {
    return {
      taskId: this.taskId,
      state: this.state,
      subState: this.subState,
      subStateIndex: this.subStateIndex,
      domainEngine: this.domainEngine,
      stepIndex: this.stepIndex,
      retryCount: this.retryCount,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      intent: this.context.intent,
      plan: this.context.plan,
      routedAgent: this.context.routedAgent,
      executionResult: this.context.executionResult,
      validationResult: this.context.validationResult,
      errorType: this.context.errorType,
      errorMessage: this.context.errorMessage,
      humanApproval: this.context.humanApproval,
      finalOutput: this.context.finalOutput,
      keyOutputs: { ...this.context.keyOutputs },
      resourceIds: [...this.context.resourceIds],
    };
  }

  /**
   * Serialize the entire FSM state for persistence.
   * @returns {Object}
   */
  serialize() {
    return {
      taskId: this.taskId,
      state: this.state,
      domainEngine: this.domainEngine,
      subState: this.subState,
      subStateIndex: this.subStateIndex,
      stepIndex: this.stepIndex,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      retryCount: this.retryCount,
      context: { ...this.context },
      checkpoints: [...this.checkpoints],
      history: [...this.history],
    };
  }

  /**
   * Restore FSM from serialized data.
   * @param {Object} data
   * @returns {TaskStateMachine}
   */
  static deserialize(data) {
    const fsm = new TaskStateMachine({
      taskId: data.taskId,
      domainEngine: data.domainEngine,
    });
    fsm.state = data.state;
    fsm.subState = data.subState;
    fsm.subStateIndex = data.subStateIndex;
    fsm.stepIndex = data.stepIndex;
    fsm.startedAt = data.startedAt;
    fsm.completedAt = data.completedAt;
    fsm.retryCount = data.retryCount;
    fsm.context = { ...data.context };
    fsm.checkpoints = [...(data.checkpoints || [])];
    fsm.history = [...(data.history || [])];
    return fsm;
  }

  // ─────────────────────────────
  // CHECKPOINT SYSTEM
  // ─────────────────────────────

  /**
   * Create a checkpoint with the 7 required fields.
   * @private
   */
  _createCheckpoint() {
    const checkpoint = {
      // 1. Current state
      currentState: this.state,
      // 2. Step index
      stepIndex: this.stepIndex,
      // 3. Key outputs (accumulated results)
      keyOutputs: { ...this.context.keyOutputs },
      // 4. Created resource IDs
      createdResourceIds: [...this.context.resourceIds],
      // 5. Validation result
      validationResult: this.context.validationResult
        ? { ...this.context.validationResult }
        : null,
      // 6. Retry safety
      retrySafe: this.isRetrySafe(),
      // 7. Next recommended action
      nextRecommendedAction: this._getNextRecommendedAction(),
      // Metadata
      timestamp: Date.now(),
      subState: this.subState,
      domainEngine: this.domainEngine,
    };

    this.checkpoints.push(checkpoint);

    // FIFO rotation – keep max N checkpoints
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints.shift();
    }

    // Persist to storage
    this._persistCheckpoints();
  }

  /**
   * Determine the next recommended action based on current state.
   * @private
   * @returns {string}
   */
  _getNextRecommendedAction() {
    const nextMap = {
      [TASK_STATES.IDLE]:             'Capture user intent',
      [TASK_STATES.INTENT_CAPTURED]:  'Begin planning',
      [TASK_STATES.PLANNING]:         'Route to domain engine',
      [TASK_STATES.ROUTING]:          'Execute assigned work',
      [TASK_STATES.EXECUTING]:        'Validate execution result',
      [TASK_STATES.VALIDATING]:       'Persist validated result',
      [TASK_STATES.PERSISTING]:       'Mark as completed',
      [TASK_STATES.COMPLETED]:        'Task finished — no action needed',
      [TASK_STATES.REVIEW_REQUIRED]:  'Awaiting user review',
      [TASK_STATES.REWORK]:           'Rework execution per validator feedback',
      [TASK_STATES.FAILED]:           'Initiate recovery',
      [TASK_STATES.RECOVERY]:         'Retry or escalate',
      [TASK_STATES.HUMAN_REVIEW]:     'Awaiting human approval',
      [TASK_STATES.CANCELLED]:        'Task cancelled — no action needed',
    };
    return nextMap[this.state] || 'Unknown';
  }

  /**
   * Persist checkpoints to localStorage via Storage module.
   * @private
   */
  _persistCheckpoints() {
    const storageKey = `checkpoint_${this.taskId}`;
    Storage.set(storageKey, this.checkpoints);
  }

  /**
   * Load checkpoints from localStorage.
   * @param {string} taskId
   * @returns {Array}
   */
  static loadCheckpoints(taskId) {
    return Storage.get(`checkpoint_${taskId}`, []);
  }

  /**
   * Get the last checkpoint (for recovery).
   * @returns {Object|null}
   */
  getLastCheckpoint() {
    return this.checkpoints.length > 0
      ? this.checkpoints[this.checkpoints.length - 1]
      : null;
  }

  /**
   * Get the last safe checkpoint (where retrySafe === true).
   * @returns {Object|null}
   */
  getLastSafeCheckpoint() {
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      if (this.checkpoints[i].retrySafe) {
        return this.checkpoints[i];
      }
    }
    return null;
  }
}

export default TaskStateMachine;
