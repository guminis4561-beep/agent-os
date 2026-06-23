import { runTask } from './server/orchestrator.js';
import EventBus from './core/events.js';
import * as Registry from './server/agent-registry.js';

EventBus.on('task:stateChange', (e) => console.log('State:', e.from, '->', e.to));
EventBus.on('task:error', (e) => console.log('Error:', e.message));
EventBus.on('task:log', (e) => console.log('Log:', e.phase, e.status, e.message));

// Mock a failure
const oldGetWorker = Registry.getWorker;
Registry.getWorker = () => {
  throw new Error("Simulated worker crash");
};

async function main() {
  try {
    const res = await runTask({ intent: 'test', domainEngine: 'coding' });
    console.log('Task started:', res);
  } catch (e) {
    console.error('Run failed:', e);
  }
}

main();
