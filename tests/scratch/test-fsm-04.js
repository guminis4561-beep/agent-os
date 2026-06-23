import { runTask } from './server/orchestrator.js';
import { TASK_STATES } from './core/state-machine.js';
import EventBus from './core/events.js';
import * as Registry from './server/agent-registry.js';

let transitions = [];
EventBus.on('task:stateChange', (e) => transitions.push(`${e.from} -> ${e.to}`));

// Mock a failure
const oldGetWorker = Registry.getWorker;
Registry.getWorker = () => {
  return { id: 'w1', name: 'Worker', engine: 'engine', temperature: 0.5 };
};

import { callModel } from './server/model-adapter.js';
import * as ModelAdapter from './server/model-adapter.js';

ModelAdapter.callModel = async () => {
  throw new Error("Crash during execution");
};

async function main() {
  try {
    await runTask({ intent: 'test', domainEngine: 'coding' });
    // Wait for async events to settle
    setTimeout(() => {
      console.log('Transitions:', transitions);
      process.exit(0);
    }, 2000);
  } catch (e) {
    console.error('Run failed:', e);
  }
}

main();
