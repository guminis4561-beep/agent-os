import { TaskStateMachine, TASK_STATES, ERROR_TYPES } from './core/state-machine.js';

const fsm = new TaskStateMachine({ taskId: 'test' });
fsm.transition(TASK_STATES.INTENT_CAPTURED, { intent: 'test' });
fsm.transition(TASK_STATES.PLANNING);
fsm.transition(TASK_STATES.ROUTING, { plan: { actions: [{ id: 'a1', description: 'test' }], assignedAgent: 'Agent' } });
fsm.transition(TASK_STATES.EXECUTING, { routedAgent: 'Agent', domainEngine: 'coding' });

console.log("State before fail:", fsm.state);
const failResult = fsm.fail(ERROR_TYPES.EXECUTION_FAILURE, 'test error');
console.log("Fail result:", failResult);
console.log("State after fail:", fsm.state);
console.log("Retry safe:", fsm.isRetrySafe());

const recResult = fsm.transition(TASK_STATES.RECOVERY, {});
console.log("Recovery result:", recResult);
console.log("State after recovery:", fsm.state);
