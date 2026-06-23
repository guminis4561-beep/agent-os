// ═══════════════════════════════════════════════════
// SERVER: Agent Registry (Hermes profiles over GLM 5.2)
// ═══════════════════════════════════════════════════
//
// "Hermes" is the agent layer: a set of named personas/profiles that the
// orchestrator plays at each phase of a task. Every profile runs on an engine
// (GLM 5.2 by default) and can be pointed at a different engine without touching
// orchestration code — that is how a separate "Hermes" model would be added.
//
// Profiles:
//   - supervisor        plans the task graph (PLANNING)
//   - one domain worker per engine, with a persona per sub-state (EXECUTING)
//   - judge             strict validator that drives the REWORK loop (VALIDATING)

import { DOMAIN_SUB_STATES } from '../core/state-machine.js';

const DEFAULT_ENGINE = 'glm';

const SUPERVISOR = {
  id: 'supervisor',
  name: 'Hermes Supervisor',
  role: 'supervisor',
  type: 'meta',
  icon: '🧭',
  engine: DEFAULT_ENGINE,
  temperature: 0.2,
  capabilities: ['Planning', 'Decomposition', 'Routing'],
  persona:
    'You are the Supervisor. Break the user goal into a small ordered task graph. ' +
    'Be concrete and minimal — no busywork steps.',
};

const JUDGE = {
  id: 'judge',
  name: 'Hermes Judge',
  role: 'judge',
  type: 'meta',
  icon: '⚖️',
  engine: DEFAULT_ENGINE,
  temperature: 0.2,
  capabilities: ['Validation', 'Critique', 'Quality Gate'],
  persona:
    'You are the Judge: a strict output validator. You return work for rework unless it genuinely ' +
    'satisfies the goal. Be skeptical. "Good enough" is not good enough.',
};

// One worker profile per domain engine. `steps` carries the persona for each
// FSM sub-state so a single agent fully owns its domain pipeline.
const WORKERS = {
  coding: {
    id: 'codeweaver',
    name: 'CodeWeaver',
    role: 'worker',
    type: 'coding',
    icon: '💻',
    engine: DEFAULT_ENGINE,
    temperature: 0.6,
    capabilities: ['Code Generation', 'Refactoring', 'Testing', 'Debugging'],
    description: 'Full-stack coding agent: surveys, patches, tests, and fixes code.',
    steps: {
      SCAN_REPO:
        'You are a repository analyst with REAL access to the workspace files shown below. ' +
        'Analyse the current code thoroughly. Identify exactly which files and lines need to change ' +
        'to satisfy the goal. Be specific: name files, function signatures, line ranges.',

      PATCH_CODE:
        'You are a senior software engineer with REAL write access to the workspace. ' +
        'You MUST return ONLY a JSON object — no prose before or after. Schema:\n' +
        '{"files":[{"path":"<relative path>","content":"<COMPLETE file content — not a diff>"}],' +
        '"explanation":"<1–3 sentences on what changed and why>"}\n' +
        'Rules: (1) Write the FULL new content of every file you change — never partial snippets. ' +
        '(2) Only include files that actually change. (3) Paths are relative to the workspace root.',

      RUN_TESTS:
        // In real-tool mode this step is handled by the runner, not the LLM.
        // This persona is only used when falling back to text-only mode (no workspace).
        'You are a test engineer. Given the goal and the code produced so far, predict which tests ' +
        'pass or fail and explain your reasoning.',

      FIX_ERRORS:
        'You are a debugger with REAL write access to the workspace. ' +
        'The test output is shown below. Identify the root cause of each failure and fix it. ' +
        'Return ONLY a JSON object with the same schema as PATCH_CODE:\n' +
        '{"files":[{"path":"<relative path>","content":"<COMPLETE corrected file content>"}],' +
        '"explanation":"<what was broken and what was fixed>"}\n' +
        'Fix every failing test. Write complete file contents — no partial patches.',
    },
  },
  trading: {
    id: 'marketsense',
    name: 'MarketSense',
    role: 'worker',
    type: 'trading',
    icon: '📈',
    engine: DEFAULT_ENGINE,
    temperature: 0.4,
    capabilities: ['Market Read', 'Sentiment', 'Setup Grading', 'Risk Control'],
    description: 'Trading analyst: reads the market, grades setups, and gates on risk.',
    steps: {
      MARKET_READ:     'You are a market analyst. State the relevant market facts; do not invent prices you were not given.',
      SENTIMENT_CHECK: 'You are a sentiment analyst. Assess prevailing sentiment relevant to the request.',
      SETUP_GRADE:     'You are a setup grader. Grade the trade setup (A–F) with explicit reasoning.',
      RISK_APPROVAL:   'You are a risk officer. Approve or reject the setup against prudent risk limits; output the entry proposal.',
    },
  },
  creation: {
    id: 'storyteller',
    name: 'StoryTeller',
    role: 'worker',
    type: 'creation',
    icon: '🎨',
    engine: DEFAULT_ENGINE,
    temperature: 0.8,
    capabilities: ['Ideation', 'Drafting', 'Critique', 'Polishing'],
    description: 'Creative agent: ideates, drafts, critiques, and polishes content.',
    steps: {
      IDEATE:   'You are an ideation agent. Produce distinct concept directions for the brief.',
      DRAFT:    'You are a writer. Produce a complete first draft from the chosen direction.',
      CRITIQUE: 'You are an editor/critic. Critique the draft against the brief and quality bar.',
      POLISH:   'You are an editor. Produce the final polished, reusable result.',
    },
  },
};

// ───────────────────────────────────────
// LOOKUPS
// ───────────────────────────────────────

export function getSupervisor() { return SUPERVISOR; }
export function getJudge() { return JUDGE; }

/** The worker profile that owns a domain engine (falls back to coding). */
export function getWorker(domainEngine) {
  return WORKERS[domainEngine] || WORKERS.coding;
}

/** Persona string for a specific sub-state within a domain. */
export function personaForStep(domainEngine, subState) {
  const worker = getWorker(domainEngine);
  return (worker.steps && worker.steps[subState])
    || `You are ${worker.name}. Complete the "${subState}" step of the task precisely.`;
}

/** Every profile by id. */
export function getProfile(id) {
  if (id === SUPERVISOR.id) return SUPERVISOR;
  if (id === JUDGE.id) return JUDGE;
  return Object.values(WORKERS).find((w) => w.id === id) || null;
}

/**
 * Public, client-safe list of all profiles. Includes the domain sub-state names
 * each worker runs so the UI can show the real pipeline an agent drives.
 */
export function listProfiles() {
  const workers = Object.entries(WORKERS).map(([domain, w]) => ({
    id: w.id,
    name: w.name,
    role: w.role,
    type: w.type,
    icon: w.icon,
    engine: w.engine,
    temperature: w.temperature,
    capabilities: w.capabilities,
    description: w.description,
    steps: DOMAIN_SUB_STATES[domain] || Object.keys(w.steps),
    // Default per-sub-state instruction texts, so the Hermes UI can show and
    // override exactly what each worker step tells the model.
    stepPersonas: { ...w.steps },
  }));

  const meta = [SUPERVISOR, JUDGE].map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    type: p.type,
    icon: p.icon,
    engine: p.engine,
    temperature: p.temperature,
    capabilities: p.capabilities,
    description: p.persona,
    steps: [],
  }));

  return [...meta, ...workers];
}
