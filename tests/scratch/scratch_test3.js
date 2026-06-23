import { runTask } from './server/orchestrator.js';
import EventBus from './core/events.js';

EventBus.on('task:stateChange', (e) => console.log('State:', e.from, '->', e.to));
EventBus.on('task:error', (e) => console.log('Error:', e.message));

async function main() {
  try {
    const res = await runTask({ intent: 'test', domainEngine: 'coding' });
    console.log('Task started:', res);
  } catch (e) {
    console.error('Run failed:', e);
  }
}

main();
