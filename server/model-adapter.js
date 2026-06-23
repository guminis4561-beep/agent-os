// ═══════════════════════════════════════════════════
// SERVER: Model Adapter (GLM 5.2 engine)
// ═══════════════════════════════════════════════════
//
// Single choke point for talking to the language model. Every agent and engine
// goes through callModel(), so swapping the engine is a config change, not a
// code change. Targets the GLM / Z.ai OpenAI-compatible /chat/completions API.

import { getEngine } from './config-store.js';
import * as Usage from './usage-store.js';

export class ModelError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Call the configured GLM engine with a chat message list.
 * @param {Object} opts
 * @param {Array<{role:string, content:string}>} opts.messages
 * @param {string} [opts.engine] - named engine to route through (default: GLM)
 * @param {string} [opts.model] - override the engine's model id
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ text: string, usage: object|null, model: string, engine: string }>}
 */
export async function callModel({ messages, engine, model, temperature = 0.7, maxTokens, signal, meta } = {}) {
  const eng = await getEngine(engine);

  if (!eng.apiKey) {
    throw new ModelError('NO_API_KEY', 'OpenRouter API key is not configured. Set it via Settings or PUT /api/config.');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ModelError('BAD_REQUEST', 'callModel requires a non-empty messages array.');
  }

  const url = `${eng.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: model || eng.model,
    messages,
    temperature,
  };
  if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${eng.apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Agent OS',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // A user-initiated cancel aborts the in-flight fetch — surface it distinctly
    // so the orchestrator routes to CANCELLED instead of a generic failure.
    if (err.name === 'AbortError') {
      throw new ModelError('ABORTED', 'Model call aborted by cancellation.');
    }
    throw new ModelError('NETWORK', `Could not reach model endpoint: ${err.message}`, err.message);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ModelError('HTTP_' + res.status, `Model endpoint returned ${res.status}`, detail.slice(0, 500));
  }

  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== 'string') {
    throw new ModelError('BAD_RESPONSE', 'Model response had no message content.', JSON.stringify(data).slice(0, 500));
  }
  // Some "reasoning" models (e.g. poolside/laguna) spend the whole token budget
  // thinking and return empty content. Surface that clearly instead of letting an
  // empty output silently fail downstream validation in confusing rework loops.
  if (text.trim() === '') {
    const hint = choice?.finish_reason === 'length'
      ? ' Token limitas išnaudotas mąstymui — padidinkite maxTokens arba rinkitės ne reasoning modelį.'
      : '';
    throw new ModelError('EMPTY_RESPONSE', `Modelis "${body.model}" grąžino tuščią turinį.${hint}`, JSON.stringify(data?.usage || {}));
  }

  // Account token + credit usage (non-blocking). meta carries domain/agentId.
  if (data.usage) {
    Usage.record({ domain: meta?.domain, agentId: meta?.agentId, model: body.model, usage: data.usage })
      .catch(() => { /* accounting must never break a task */ });
  }

  return { text, usage: data.usage || null, model: body.model, engine: eng.name };
}

/**
 * Plain chat completion that bypasses the FSM/orchestrator entirely. Uses the
 * default engine + model from config and returns just the assistant's text.
 * Powers the standalone memory-aware Chatbot view.
 * @param {Array<{role:string, content:string}>} messages
 * @returns {Promise<string>}
 */
export async function callChatModel(messages, { maxTokens = 1024, temperature = 0.7, signal, model } = {}) {
  const { text } = await callModel({
    messages, temperature, maxTokens, signal,
    ...(model ? { model } : {}),
    meta: { domain: 'chat', agentId: 'chatbot' },
  });
  return text;
}

/**
 * Call the model and parse a JSON object out of the reply. Tolerant of models
 * that wrap JSON in prose or markdown fences.
 * @returns {Promise<{ json: object, text: string, usage: object|null, model: string }>}
 */
export async function callModelJson(opts) {
  const result = await callModel({ ...opts, temperature: opts.temperature ?? 0.2 });
  const json = extractJson(result.text);
  if (!json) {
    throw new ModelError('NON_JSON', 'Expected a JSON object but could not parse one.', result.text.slice(0, 500));
  }
  return { ...result, json };
}

/** Best-effort extraction of the first balanced JSON object from arbitrary text. */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { return null; }
      }
    }
  }
  return null;
}
