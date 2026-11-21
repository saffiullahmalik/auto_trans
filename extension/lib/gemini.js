// Draft translation with Google Gemini (Generative Language API, REST).
// Key: Google AI Studio → "Get API key" (https://aistudio.google.com/apikey).

import { protectMath, restoreMath } from './math.js';
import { systemPrompt, userPayload, parseReply } from './prompt.js';

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
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

export async function geminiTranslate({ apiKey, model, language, glossary, question }, fetchImpl = fetch) {
  if (!apiKey) throw new Error('No Gemini API key is set. Add one in Settings.');
  const q = protectMath(question.html);
  const steps = question.steps.map((s) => protectMath(s));

  const res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model || GEMINI_DEFAULT_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(language, glossary) }] },
      contents: [{ role: 'user', parts: [{ text: userPayload(question, q.text, steps.map((s) => s.text)) }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini error: ${body?.error?.message || `HTTP ${res.status}`}`);
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
