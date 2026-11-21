// AI draft translation via the Claude API. Bundled into extension/lib/ai.bundle.js
// by scripts/build.mjs (the extension has no runtime module resolution).

import Anthropic from '@anthropic-ai/sdk';
import { protectMath, restoreMath } from '../extension/lib/math.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

const LANGUAGE_NAMES = { urdu: 'Urdu', sindhi: 'Sindhi' };

function systemPrompt(language, glossary) {
  const name = LANGUAGE_NAMES[language];
  const lines = [
    `You translate school mathematics questions and worked solutions from English into ${name} for students in Pakistan.`,
    `A teacher will review and edit your draft before it is published, so aim for the wording a good ${name}-medium math textbook would use.`,
    '',
    'Rules:',
    '- The input is HTML. Keep the same HTML structure and tags (<p>, <br>, <strong>, <ol>, <ul>, <li>, ...). Translate only the human-readable text. Do not add attributes, styles or new tags.',
    '- Tokens like ⟦M1⟧, ⟦M2⟧ stand for math formulas. Copy every token exactly once, unchanged, at the place where that formula belongs in the translated sentence. Never translate, rewrite or drop a token.',
    '- Use simple, natural sentences suitable for the given grade, and the standard mathematical terminology used in Pakistani textbooks.',
    '- Write numbers that appear outside the tokens as Western digits (0-9), as in the source.',
    '- Transliterate people\'s names (e.g. Ali → علی) rather than translating them.',
    '- Return the question and every solution step, in the same order, with the same number of steps as the input.',
  ];
  if (glossary?.trim()) {
    lines.push('', 'Glossary (always use these translations):', glossary.trim());
  }
  return lines.join('\n');
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    question_html: { type: 'string' },
    steps_html: { type: 'array', items: { type: 'string' } },
  },
  required: ['question_html', 'steps_html'],
  additionalProperties: false,
};

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

  const input = {
    grade: question.grade ?? null,
    subject: question.subject ?? null,
    topic: question.topic ?? null,
    question_html: q.text,
    steps_html: steps.map((s) => s.text),
  };

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
    messages: [{ role: 'user', content: JSON.stringify(input) }],
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
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error('The AI returned an unreadable response. Try "Regenerate".');
  }
  if (!Array.isArray(out.steps_html) || out.steps_html.length !== steps.length) {
    throw new Error(`The AI returned ${out.steps_html?.length ?? 0} steps instead of ${steps.length}. Try "Regenerate".`);
  }

  return {
    questionHtml: restoreMath(out.question_html, q.math),
    stepsHtml: out.steps_html.map((s, i) => restoreMath(s, steps[i].math)),
  };
}
