// Translation memory: sentences a teacher has already finalised are reused for
// identical English text. Math is replaced by placeholders in the key, so
// "order $5$" and "order $2$" share one entry.

import { protectMath, restoreMath } from './math.js';

const normalize = (html) =>
  String(html ?? '')
    .replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

export function memoryKey(language, englishHtml) {
  const { text } = protectMath(normalize(englishHtml));
  return `${language}::${text}`;
}

/** Build the stored value: the translation with the source's math replaced by placeholders. */
export function memoryValue(englishHtml, translatedHtml) {
  const { math } = protectMath(normalize(englishHtml));
  let value = String(translatedHtml ?? '');
  // Replace each source formula (in order of first occurrence) with its token.
  math.forEach((m, i) => {
    const at = value.indexOf(m);
    if (at === -1) throw new Error('Translation does not contain all formulas');
    value = value.slice(0, at) + `⟦M${i + 1}⟧` + value.slice(at + m.length);
  });
  return value;
}

/** Apply a stored value to a new English source; returns null when it doesn't fit. */
export function applyMemory(englishHtml, storedValue) {
  const { math } = protectMath(normalize(englishHtml));
  try {
    return restoreMath(storedValue, math);
  } catch {
    return null;
  }
}
