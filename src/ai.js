// AI draft translation via the Claude API. Bundled into extension/lib/ai.bundle.js
// by scripts/build.mjs (the extension has no runtime module resolution).

import Anthropic from '@anthropic-ai/sdk';
import { protectMath, restoreMath } from '../extension/lib/math.js';
import { systemPrompt, OUTPUT_SCHEMA, userPayload, parseReply } from '../extension/lib/prompt.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * question: { html, steps: string[], grade, subject, topic }
 * Returns { questionHtml, stepsHtml: string[] } with math restored.
 */
export async function suggestTranslation({ apiKey, model, language, glossary, question }) {
  if (!apiKey) throw new Error('No Claude API key is set. Add one in Settings to get AI suggestions.');

  const client = new Anthropic({
    apiKey,
    // The key is entered by the teacher or admin in the extension settings and
    // only ever sent to api.anthropic.com from this browser.
    dangerouslyAllowBrowser: true,
    maxRetries: 3,
  });

  const q = protectMath(question.html);
  const steps = question.steps.map((s) => protectMath(s));

  const response = await client.beta.messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: systemPrompt(language, glossary),
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    messages: [{ role: 'user', content: userPayload(question, q.text, steps.map((s) => s.text)) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The AI declined to translate this question. Please translate it manually.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The AI response was cut off. Try "Regenerate" or translate manually.');
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const out = parseReply(text, steps.length);

  return {
    questionHtml: restoreMath(out.question_html, q.math),
    stepsHtml: out.steps_html.map((s, i) => restoreMath(s, steps[i].math)),
  };
}
