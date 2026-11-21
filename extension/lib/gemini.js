// Draft translation with Google Gemini (Generative Language API, REST).
// Key: Google AI Studio → "Get API key" (https://aistudio.google.com/apikey).

import { protectMath, restoreMath } from './math.js';
import { systemPrompt, userPayload, parseReply } from './prompt.js';

export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Gemini's responseSchema uses the OpenAPI subset (uppercase type names).
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    question_html: { type: 'STRING' },
    steps_html: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['question_html', 'steps_html'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST, retrying when Google is overloaded (503/500) or briefly rate-limiting (429). */
async function postWithRetry(fetchImpl, url, headers, body, { attempts = 4, timeoutMs = 120000, baseDelayMs = 4000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body, signal: ctrl?.signal });
      const json = await res.json().catch(() => ({}));
      last = { res, body: json };
      if (![429, 500, 503].includes(res.status)) return last;
      // A daily quota won't recover by waiting; only retry short-term limits.
      if (res.status === 429 && /per day|daily/i.test(json?.error?.message ?? '')) return last;
    } catch (e) {
      if (i === attempts - 1) throw new Error(e?.name === 'AbortError' ? 'Gemini took too long to answer. Try "Regenerate".' : `Could not reach Gemini: ${e.message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
  }
  return last;
}

export async function geminiTranslate({ apiKey, model, language, glossary, question }, fetchImpl = fetch) {
  if (!apiKey) throw new Error('No Gemini API key is set. Add one in Settings.');
  const q = protectMath(question.html);
  const steps = question.steps.map((s) => protectMath(s));

  const modelName = model || GEMINI_DEFAULT_MODEL;
  const generationConfig = { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA };
  // Translation needs little reasoning; Gemini 3 models otherwise think at length (slow, billed as output).
  if (/^gemini-3/.test(modelName)) generationConfig.thinkingConfig = { thinkingLevel: 'low' };

  const request = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt(language, glossary) }] },
    contents: [{ role: 'user', parts: [{ text: userPayload(question, q.text, steps.map((s) => s.text)) }] }],
    generationConfig,
  });

  const { res, body } = await postWithRetry(
    fetchImpl,
    `${ENDPOINT}/${encodeURIComponent(modelName)}:generateContent`,
    { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    request,
  );
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 429) throw new Error(`Gemini quota or rate limit reached: ${msg}`);
    throw new Error(`Gemini error: ${msg}`);
  }
  if (body?.promptFeedback?.blockReason) {
    throw new Error(`Gemini declined this question (${body.promptFeedback.blockReason}). Please translate it manually.`);
  }
  const cand = body?.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('The Gemini response was cut off. Try "Regenerate".');
  if (cand?.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(cand.finishReason)) {
    throw new Error(`Gemini stopped early (${cand.finishReason}). Please translate this question manually.`);
  }
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const out = parseReply(text, steps.length);
  return {
    questionHtml: restoreMath(out.question_html, q.math),
    stepsHtml: out.steps_html.map((s, i) => restoreMath(s, steps[i].math)),
  };
}
