// Helpers for the LaTeX math embedded in question HTML as $...$ or $$...$$.
// Math is swapped for placeholder tokens before AI translation so the model
// cannot change a formula, then restored afterwards.

const MATH_RE = /(?<!\\)\$\$[\s\S]+?(?<!\\)\$\$|(?<!\\)\$[^$]+?(?<!\\)\$/g;
const TOKEN_RE = /⟦M(\d+)⟧/g;

export function extractMath(html) {
  return String(html ?? '').match(MATH_RE) ?? [];
}

/** Replace each formula with ⟦M1⟧, ⟦M2⟧ … and return the list of formulas. */
export function protectMath(html) {
  const math = [];
  const text = String(html ?? '').replace(MATH_RE, (m) => {
    math.push(m);
    return `⟦M${math.length}⟧`;
  });
  return { text, math };
}

/** Put the formulas back. Throws if any placeholder is missing, repeated or unknown. */
export function restoreMath(text, math) {
  const counts = new Map();
  const out = String(text ?? '').replace(TOKEN_RE, (_, n) => {
    const i = Number(n);
    counts.set(i, (counts.get(i) ?? 0) + 1);
    if (i < 1 || i > math.length) throw new Error(`Unknown math placeholder ⟦M${n}⟧`);
    return math[i - 1];
  });
  for (let i = 1; i <= math.length; i++) {
    const c = counts.get(i) ?? 0;
    if (c !== 1) throw new Error(`Math placeholder ⟦M${i}⟧ appears ${c} times (expected 1)`);
  }
  return out;
}

const norm = (m) => m.replace(/\s+/g, '');

/**
 * Compare the formulas in the English source and the translation.
 * Returns formulas that are missing from, or extra in, the translation.
 */
export function compareMath(sourceHtml, translatedHtml) {
  const remaining = new Map();
  for (const m of extractMath(sourceHtml)) {
    const k = norm(m);
    remaining.set(k, [...(remaining.get(k) ?? []), m]);
  }
  const extra = [];
  for (const m of extractMath(translatedHtml)) {
    const k = norm(m);
    const list = remaining.get(k);
    if (list && list.length) list.pop();
    else extra.push(m);
  }
  const missing = [...remaining.values()].flat();
  return { missing, extra, ok: missing.length === 0 && extra.length === 0 };
}

/** Text content of an HTML fragment with tags removed (for emptiness checks). */
export function plainText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
