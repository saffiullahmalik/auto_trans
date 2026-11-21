// Draft translation with Google Cloud Translation API (Basic, v2).
// Key: Google Cloud Console → enable "Cloud Translation API" → Credentials → API key.
// Plain machine translation: no grade-level wording, and the glossary is not applied.

import { protectMath, restoreMath } from './math.js';

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const TARGET = { urdu: 'ur', sindhi: 'sd' };

// In HTML mode Google Translate leaves elements marked translate="no" untouched.
const shield = (html) => html.replace(/⟦M(\d+)⟧/g, '<span translate="no">⟦M$1⟧</span>');
const unshield = (html) => html.replace(/<span[^>]*>\s*(⟦M\d+⟧)\s*<\/span>/g, '$1');

export async function googleTranslate({ apiKey, language, question }, fetchImpl = fetch) {
  if (!apiKey) throw new Error('No Google Translate API key is set. Add one in Settings.');
  const target = TARGET[language];
  if (!target) throw new Error(`Google Translate: unsupported language ${language}`);

  const q = protectMath(question.html);
  const steps = question.steps.map((s) => protectMath(s));
  const texts = [q.text, ...steps.map((s) => s.text)].map(shield);

  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ q: texts, source: 'en', target, format: 'html' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Translate error: ${body?.error?.message || `HTTP ${res.status}`}`);
  const out = (body?.data?.translations ?? []).map((t) => unshield(t.translatedText ?? ''));
  if (out.length !== texts.length) throw new Error('Google Translate returned an incomplete result. Try "Regenerate".');

  return {
    questionHtml: restoreMath(out[0], q.math),
    stepsHtml: out.slice(1).map((s, i) => restoreMath(s, steps[i].math)),
  };
}
