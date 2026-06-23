// ═══════════════════════════════════════════════════
// SERVER: Usage Store (token + cost accounting)
// ═══════════════════════════════════════════════════
//
// Accumulates the `usage` object every model call returns (OpenRouter reports
// prompt/completion/total tokens and a `cost` in credits) into durable buckets:
// total, per domain engine, per model, per agent. Surfaced on the dashboard so
// each engine card can show real token + credit consumption.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DATA_DIR } from './paths.js';
import { join } from 'node:path';

const USAGE_FILE = join(DATA_DIR, 'usage.json');

let cache = null;
let writeChain = Promise.resolve();

function zero() {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
}

function blank() {
  return { total: zero(), byDomain: {}, byModel: {}, byAgent: {}, updatedAt: null };
}

async function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(USAGE_FILE, 'utf8'));
    cache = (parsed && typeof parsed === 'object' && parsed.total) ? parsed : blank();
  } catch {
    cache = blank();
  }
  return cache;
}

// Serialize writes so concurrent records can't clobber the file.
function flush() {
  const snapshot = JSON.stringify(cache, null, 2);
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(USAGE_FILE, snapshot, 'utf8');
  }).catch((e) => console.error('[Usage] flush failed:', e.message));
  return writeChain;
}

function addInto(bucket, u) {
  const prompt = Number(u.prompt_tokens) || 0;
  const completion = Number(u.completion_tokens) || 0;
  bucket.calls += 1;
  bucket.promptTokens += prompt;
  bucket.completionTokens += completion;
  bucket.totalTokens += Number(u.total_tokens) || (prompt + completion);
  bucket.cost += Number(u.cost) || 0;
}

/**
 * Record one model call's usage. Tagged with the domain engine, agent id and
 * model so the dashboard can break consumption down per engine. No-ops if the
 * provider returned no usage object.
 */
export async function record({ domain = 'other', agentId = 'unknown', model = 'unknown', usage } = {}) {
  if (!usage || typeof usage !== 'object') return;
  const c = await load();
  if (!c.byDomain[domain]) c.byDomain[domain] = zero();
  if (!c.byModel[model]) c.byModel[model] = zero();
  if (!c.byAgent[agentId]) c.byAgent[agentId] = zero();
  addInto(c.total, usage);
  addInto(c.byDomain[domain], usage);
  addInto(c.byModel[model], usage);
  addInto(c.byAgent[agentId], usage);
  c.updatedAt = Date.now();
  flush();
}

/** Aggregated snapshot for the dashboard / API. */
export async function getSummary() {
  return JSON.parse(JSON.stringify(await load()));
}

/** Wipe all accounting (e.g. a manual reset from the UI). */
export async function reset() {
  cache = blank();
  flush();
  return cache;
}
