// Instructions and output shape shared by the LLM providers (Claude, Gemini).

const LANGUAGE_NAMES = { urdu: 'Urdu', sindhi: 'Sindhi' };

export function systemPrompt(language, glossary) {
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
    "- Transliterate people's names (e.g. Ali → علی) rather than translating them.",
    '- Return the question and every solution step, in the same order, with the same number of steps as the input.',
    '- Reply with JSON only: {"question_html": "...", "steps_html": ["...", ...]}.',
  ];
  if (glossary?.trim()) {
    lines.push('', 'Glossary (always use these translations):', glossary.trim());
  }
  return lines.join('\n');
}

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    question_html: { type: 'string' },
    steps_html: { type: 'array', items: { type: 'string' } },
  },
  required: ['question_html', 'steps_html'],
  additionalProperties: false,
};

/** The JSON sent to the model: question and steps with math already replaced by tokens. */
export function userPayload(question, protectedQuestion, protectedSteps) {
  return JSON.stringify({
    grade: question.grade ?? null,
    subject: question.subject ?? null,
    topic: question.topic ?? null,
    question_html: protectedQuestion,
    steps_html: protectedSteps,
  });
}

/** Parse and check the model's JSON reply. */
export function parseReply(text, stepCount) {
  let out;
  try {
    out = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error('The AI returned an unreadable response. Try "Regenerate".');
  }
  if (typeof out?.question_html !== 'string') throw new Error('The AI response had no question text. Try "Regenerate".');
  if (!Array.isArray(out.steps_html) || out.steps_html.length !== stepCount) {
    throw new Error(`The AI returned ${out.steps_html?.length ?? 0} steps instead of ${stepCount}. Try "Regenerate".`);
  }
  return out;
}
