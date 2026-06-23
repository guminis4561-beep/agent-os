// ═══════════════════════════════════════════════════
// SERVER: Config Store (holds secrets server-side)
// ═══════════════════════════════════════════════════
//
// The GLM API key lives ONLY here, on disk under .data/, and is never sent to
// the browser. getPublicConfig() returns a masked view safe for the client.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DATA_DIR, CONFIG_FILE } from './paths.js';

const DEFAULTS = Object.freeze({
  // OpenRouter OpenAI-compatible endpoint
  glmBaseUrl: 'https://openrouter.ai/api/v1',
  glmModel: 'nvidia/nemotron-3-super-120b-a12b:free',
  judgeModel: 'nvidia/nemotron-3-super-120b-a12b:free',
  glmApiKey: '',
  // UI access token — protects all /api/* routes. Empty = auth disabled.
  // Can also be set via the API_KEY environment variable (takes precedence).
  uiToken: '',
  qualityThreshold: 75,         // Judge score (0-100) required to pass VALIDATING
  maxReworks: 3,                // rework loops before escalating to human review
  // Named extra engines for per-profile routing (e.g. Hermes via OpenRouter/Ollama).
  // Shape: { hermes: { baseUrl, model, apiKey } }. The implicit "glm" engine is
  // always derived from the glm* fields above, so this can stay empty.
  engines: {},
  // Per-profile engine overrides: { <profileId>: <engineName> }. Empty = every
  // profile uses its built-in default ("glm").
  agentEngines: {},
  // Catalogue of model ids the UI offers in dropdowns (per-task picker + the
  // Hermes per-agent override). The active glmModel/judgeModel are always merged
  // in by getAvailableModels() so the configured models are never missing.
  availableModels: [
    'nvidia/nemotron-3-super-120b-a12b:free',
    'z-ai/glm-4.6',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
    'deepseek/deepseek-chat',
  ],
  // Per-profile tuning overrides for built-in Hermes agents:
  //   { <profileId>: { model?: string, temperature?: number, persona?: string } }
  // model overrides the raw model id; temperature/persona override the built-in
  // defaults from agent-registry.js. Empty fields fall back to the defaults.
  agentTuning: {},
});

let cache = null;

async function load() {
  if (cache) return cache;
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

/** Full config including the secret key — server-side use only. */
export async function getConfig() {
  return { ...(await load()) };
}

/**
 * Resolve a named engine to a concrete endpoint. The implicit "glm" / "default"
 * engine maps to the top-level glm* fields. Other names look up the `engines`
 * map, inheriting the GLM base URL / key when a field is omitted.
 * @returns {Promise<{name:string, baseUrl:string, model:string, apiKey:string}>}
 */
export async function getEngine(name) {
  const c = await load();
  if (!name || name === 'glm' || name === 'default') {
    return { name: 'glm', baseUrl: c.glmBaseUrl, model: c.glmModel, apiKey: c.glmApiKey };
  }
  const e = (c.engines && c.engines[name]) || null;
  if (!e) {
    // Unknown engine name → fall back to GLM so a stale profile never hard-fails.
    return { name: 'glm', baseUrl: c.glmBaseUrl, model: c.glmModel, apiKey: c.glmApiKey };
  }
  return {
    name,
    baseUrl: e.baseUrl || c.glmBaseUrl,
    model: e.model || c.glmModel,
    apiKey: e.apiKey || c.glmApiKey,
  };
}

/** Names of all configured engines (implicit GLM + any named extras). */
export async function listEngineNames() {
  const c = await load();
  return ['glm', ...Object.keys(c.engines || {})];
}

/** Effective engine name for a profile, honoring per-profile overrides. */
export async function getAgentEngineName(profileId, fallback = 'glm') {
  const c = await load();
  return (c.agentEngines && c.agentEngines[profileId]) || fallback;
}

/**
 * The model ids the UI may offer, as a de-duplicated union of the configured
 * availableModels plus the active glmModel/judgeModel (so the running models are
 * always selectable even if removed from the list).
 * @returns {Promise<string[]>}
 */
export async function getAvailableModels() {
  const c = await load();
  const list = Array.isArray(c.availableModels) ? c.availableModels : [];
  const union = new Set([...list, c.glmModel, c.judgeModel].filter(Boolean));
  return [...union];
}

/**
 * Per-agent tuning override ({ model?, temperature?, persona? }) for a built-in
 * profile. Returns an empty object when nothing is overridden.
 * @returns {Promise<{model?:string, temperature?:number, persona?:string}>}
 */
export async function getAgentTuning(profileId) {
  const c = await load();
  return (c.agentTuning && c.agentTuning[profileId]) || {};
}

/** Resolve the active UI token: env var takes precedence over stored config. */
export async function getUiToken() {
  if (process.env.API_KEY) return process.env.API_KEY;
  const c = await load();
  return c.uiToken || '';
}

/** Client-safe view: key is masked, presence is exposed as a boolean. */
export async function getPublicConfig() {
  const c = await load();
  const key = c.glmApiKey || '';
  // Named engines, with keys masked (never expose raw provider keys to the client).
  const engines = {};
  for (const [name, e] of Object.entries(c.engines || {})) {
    const ek = e.apiKey || '';
    engines[name] = {
      baseUrl: e.baseUrl || '',
      model: e.model || '',
      hasApiKey: ek.length > 0,
      apiKeyMasked: ek ? `${ek.slice(0, 4)}…${ek.slice(-4)}` : '',
    };
  }

  const uiToken = process.env.API_KEY || c.uiToken || '';
  // Raw stored catalogue (editable in the Hermes UI). The union with the active
  // glmModel/judgeModel is exposed separately via getAvailableModels() / /api/models.
  const availableModels = [...(Array.isArray(c.availableModels) ? c.availableModels : [])];
  return {
    glmBaseUrl: c.glmBaseUrl,
    glmModel: c.glmModel,
    judgeModel: c.judgeModel,
    qualityThreshold: c.qualityThreshold,
    maxReworks: c.maxReworks,
    hasApiKey: key.length > 0,
    apiKeyMasked: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '',
    hasUiToken: uiToken.length > 0,
    availableModels,
    agentTuning: { ...(c.agentTuning || {}) },
    engines,
    agentEngines: { ...(c.agentEngines || {}) },
  };
}

/** Merge and persist a partial update. Empty/whitespace key updates are ignored. */
export async function setConfig(patch = {}) {
  const current = await load();
  const next = { ...current };

  for (const field of ['glmBaseUrl', 'glmModel', 'judgeModel']) {
    if (typeof patch[field] === 'string' && patch[field].trim()) next[field] = patch[field].trim();
  }
  if (typeof patch.glmApiKey === 'string' && patch.glmApiKey.trim()) {
    next.glmApiKey = patch.glmApiKey.trim();
  }
  // uiToken: allow setting AND clearing (empty string disables auth)
  if (typeof patch.uiToken === 'string') {
    next.uiToken = patch.uiToken.trim();
  }
  if (Number.isFinite(patch.qualityThreshold)) {
    next.qualityThreshold = Math.max(0, Math.min(100, patch.qualityThreshold));
  }
  if (Number.isFinite(patch.maxReworks)) {
    next.maxReworks = Math.max(0, Math.min(10, Math.floor(patch.maxReworks)));
  }

  // Named engines: merge per name. value === null removes the engine. An omitted
  // or empty apiKey preserves the previously stored key (lets the user edit
  // baseUrl/model without re-pasting the secret).
  if (patch.engines && typeof patch.engines === 'object') {
    next.engines = { ...(next.engines || {}) };
    for (const [rawName, val] of Object.entries(patch.engines)) {
      const name = String(rawName).trim();
      if (!name || name === 'glm' || name === 'default') continue; // reserved
      if (val === null) { delete next.engines[name]; continue; }
      if (typeof val !== 'object') continue;
      const prev = next.engines[name] || {};
      next.engines[name] = {
        baseUrl: typeof val.baseUrl === 'string' && val.baseUrl.trim() ? val.baseUrl.trim() : (prev.baseUrl || ''),
        model: typeof val.model === 'string' && val.model.trim() ? val.model.trim() : (prev.model || ''),
        apiKey: typeof val.apiKey === 'string' && val.apiKey.trim() ? val.apiKey.trim() : (prev.apiKey || ''),
      };
    }
  }

  // Per-profile engine overrides. Empty/null/"glm" clears the override.
  if (patch.agentEngines && typeof patch.agentEngines === 'object') {
    next.agentEngines = { ...(next.agentEngines || {}) };
    for (const [profileId, engineName] of Object.entries(patch.agentEngines)) {
      const eng = (engineName == null ? '' : String(engineName)).trim();
      if (!eng || eng === 'glm' || eng === 'default') delete next.agentEngines[profileId];
      else next.agentEngines[profileId] = eng;
    }
  }

  // Catalogue of selectable models. Replace wholesale with a sanitized string list.
  if (Array.isArray(patch.availableModels)) {
    const cleaned = [...new Set(
      patch.availableModels
        .filter((m) => typeof m === 'string')
        .map((m) => m.trim())
        .filter(Boolean),
    )];
    next.availableModels = cleaned;
  }

  // Per-profile tuning overrides. Per field: empty/null clears just that field;
  // value === null for the whole profile removes all its overrides.
  if (patch.agentTuning && typeof patch.agentTuning === 'object') {
    next.agentTuning = { ...(next.agentTuning || {}) };
    for (const [profileId, val] of Object.entries(patch.agentTuning)) {
      if (val === null) { delete next.agentTuning[profileId]; continue; }
      if (typeof val !== 'object') continue;
      const prev = next.agentTuning[profileId] || {};
      const merged = { ...prev };

      if ('model' in val) {
        const m = (val.model == null ? '' : String(val.model)).trim();
        if (m) merged.model = m; else delete merged.model;
      }
      if ('temperature' in val) {
        if (val.temperature == null || val.temperature === '') delete merged.temperature;
        else if (Number.isFinite(Number(val.temperature))) {
          merged.temperature = Math.max(0, Math.min(2, Number(val.temperature)));
        }
      }
      if ('persona' in val) {
        const p = (val.persona == null ? '' : String(val.persona)).trim();
        if (p) merged.persona = p.slice(0, 4000); else delete merged.persona;
      }
      // Per-sub-state instruction overrides for domain workers:
      //   steps: { SCAN_REPO: "…", PATCH_CODE: "…" }. Empty text clears that step.
      if ('steps' in val) {
        if (val.steps == null || typeof val.steps !== 'object') {
          delete merged.steps;
        } else {
          const cleanedSteps = {};
          for (const [sub, txt] of Object.entries(val.steps)) {
            const s = (txt == null ? '' : String(txt)).trim();
            if (s) cleanedSteps[String(sub)] = s.slice(0, 4000);
          }
          if (Object.keys(cleanedSteps).length) merged.steps = cleanedSteps;
          else delete merged.steps;
        }
      }

      if (Object.keys(merged).length) next.agentTuning[profileId] = merged;
      else delete next.agentTuning[profileId];
    }
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  cache = next;
  return getPublicConfig();
}
