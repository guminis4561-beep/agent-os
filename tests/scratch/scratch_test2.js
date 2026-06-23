import { TaskStateMachine, TASK_STATES, ERROR_TYPES } from './core/state-machine.js';
import EventBus from './core/events.js';

// Stub out EventBus to avoid missing handlers
EventBus.emit = console.log;

// Copy handleDriveError logic here to see what it does
function handleDriveError(fsm, control, err) {
  const aborted = control.cancelled || (err.code === 'ABORTED');
  if (aborted) {
    if (fsm.state !== TASK_STATES.REVIEW_REQUIRED) {
      fsm.transition(TASK_STATES.CANCELLED, {});
    }
    return;
  }

  const errorType = ERROR_TYPES.EXECUTION_FAILURE;

  const failableStates = [TASK_STATES.PLANNING, TASK_STATES.ROUTING, TASK_STATES.EXECUTING,
    TASK_STATES.VALIDATING, TASK_STATES.PERSISTING];
  if (!failableStates.includes(fsm.state)) return;

  console.log("State before fail:", fsm.state);
  const failResult = fsm.fail(errorType, err.message);
  console.log("Fail result:", failResult);
  console.log("State after fail:", fsm.state);

  if (fsm.isRetrySafe()) {
    console.log("Attempting recovery transition...");
    const recovery = fsm.transition(TASK_STATES.RECOVERY, {});
    console.log("Recovery result:", recovery);
    if (recovery.success) {
      console.log("runRecovery would be called here");
      return;
    }
  }

  console.log("Terminal failure");
}

const fsm = new TaskStateMachine({ taskId: 'test' });
fsm.transition(TASK_STATES.INTENT_CAPTURED, { intent: 'test' });
fsm.transition(TASK_STATES.PLANNING);
fsm.transition(TASK_STATES.ROUTING, { plan: { actions: [{ id: 'a1', description: 'test' }], assignedAgent: 'Agent' } });
fsm.transition(TASK_STATES.EXECUTING, { routedAgent: 'Agent', domainEngine: 'coding' });

handleDriveError(fsm, { cancelled: false, ctx: {} }, new Error("Crash"));
