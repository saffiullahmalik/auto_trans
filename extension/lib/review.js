// Reviewer side: the translation review queue, automatic checks, progress
// counts and the approve / send-back call, using the portal's reviewer API.

import { LANGUAGES } from './portal.js';
import { plainText } from './math.js';
import { looseKey, nameKey, belongsToUnit } from './units.js';

const LIST = '/question-review/pending';

export async function reviewPage(client, params) {
  const qs = new URLSearchParams(params);
  const d = await client.request('GET', `${LIST}?${qs}`);
  const page = d?.data ?? {};
  return {
    questions: Array.isArray(page.data) ? page.data : [],
    lastPage: page.last_page ?? 1,
    total: page.total ?? 0,
    filters: d?.filters ?? page.filters ?? {},
  };
}

async function allPages(client, params, onProgress) {
  const all = [];
  let page = 1;
  let last = 1;
  do {
    const r = await reviewPage(client, [['page', page], ['per_page', 100], ...params]);
    all.push(...r.questions);
    last = r.lastPage;
    onProgress?.(page, last, r.total);
    page++;
  } while (page <= last);
  return all;
}

/** Every question whose translation in `language` is waiting for review (optionally one portal unit). */
export function loadReviewQueue(client, language, { portalUnit } = {}, onProgress) {
  const params = [['translation_status[]', `pending_${language}_review`]];
  if (portalUnit) params.push(['unit[]', portalUnit]);
  return allPages(client, params, onProgress);
}

/** Filter options of the reviewer list (units, subjects, classes, ...). */
export async function reviewFilterOptions(client) {
  const { filters } = await reviewPage(client, [['page', 1], ['per_page', 1]]);
  const o = filters?.options ?? {};
  const values = (list) => [...new Set((list ?? []).map((x) => x?.value ?? x).filter(Boolean))];
  return { units: values(o.unit), subjects: values(o.subject), grades: values(o.grade) };
}

export function pendingTranslation(question, language) {
  return (question?.translations ?? []).find((t) => t.language === language && t.status === 'pending_review') ?? null;
}

/** The submitted translation for review: question HTML and steps. */
export function reviewContent(question, language) {
  const L = LANGUAGES[language];
  const t = pendingTranslation(question, language);
  const steps = t?.translated_solution_steps ?? question?.[L.stepsField] ?? [];
  return {
    translation: t,
    questionHtml: t?.translated_text ?? question?.[L.textField] ?? '',
    steps: Array.isArray(steps) ? steps : [],
  };
}

const latinWords = (html) => {
  const text = String(html ?? '')
    .replace(/(?<!\\)\$\$[\s\S]+?\$\$|(?<!\\)\$[^$]+?\$/g, ' ')
    .replace(/<code>[\s\S]*?<\/code>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\([^)]*\)/g, ' '); // "(Rotational Symmetry)" glosses are fine
  return (text.match(/[A-Za-z]{3,}/g) ?? []);
};

const MATH_RE = /(?<!\\)\$\$[\s\S]+?(?<!\\)\$\$|(?<!\\)\$[^$]+?(?<!\\)\$/g;

// Numbers in a fragment, wherever they are (text or formulas); "4{,}878" and "4,878" → "4878".
const numbersIn = (html) => (String(html ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\{,\}/g, '')
  .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
  .match(/\d+(?:\.\d+)?/g) ?? []);

const bareNumber = (m) => {
  const s = m.replace(/^\$+|\$+$/g, '').replace(/[{}\s]/g, '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return /^-?\d+(?:\.\d+)?$/.test(s) ? s.replace(/^-/, '') : null;
};

/**
 * Compare the English and the translation by their numbers, which survives
 * rewording, translated units inside \text{…} and reshaped formulas:
 * missing = numbers of the English that appear nowhere in the translation,
 * extra = numbers in the translation that the English doesn't have,
 * unstyled = bare-number formulas like $6$ that the translation writes as plain text.
 */
export function compareNumbers(sourceHtml, translatedHtml) {
  const src = new Set(numbersIn(sourceHtml));
  const dst = new Set(numbersIn(translatedHtml));
  const dstMath = new Set((String(translatedHtml ?? '').match(MATH_RE) ?? []).flatMap((m) => numbersIn(m)));
  const unstyled = [...new Set((String(sourceHtml ?? '').match(MATH_RE) ?? []).map(bareNumber).filter(Boolean))]
    .filter((n) => dst.has(n) && !dstMath.has(n));
  return {
    missing: [...src].filter((n) => !dst.has(n)),
    extra: [...dst].filter((n) => !src.has(n)),
    unstyled,
  };
}

/** Automatic checks shown to the reviewer. Each: { level: 'error' | 'warn', text }. */
export function reviewFlags(question, language) {
  const flags = [];
  const { questionHtml, steps } = reviewContent(question, language);
  const en = Array.isArray(question?.solution_steps) ? question.solution_steps : [];

  if (!plainText(questionHtml)) flags.push({ level: 'error', text: 'Question translation is empty' });
  if (steps.length < en.filter((s) => plainText(s?.explanation)).length) {
    flags.push({ level: 'error', text: `Only ${steps.length} of ${en.length} solution steps translated` });
  }

  const fields = [['Question', question?.question_text, questionHtml], ...en.map((s, i) => [`Step ${i + 1}`, s?.explanation, steps[i]?.explanation])];
  for (const [name, source, target] of fields) {
    if (!plainText(source)) continue;
    if (steps.length && name !== 'Question' && !plainText(target)) {
      flags.push({ level: 'error', text: `${name}: empty` });
      continue;
    }
    const cmp = compareNumbers(source, target);
    const list = (xs) => xs.slice(0, 5).join(', ') + (xs.length > 5 ? '…' : '');
    if (cmp.missing.length) flags.push({ level: 'error', text: `${name}: number${cmp.missing.length > 1 ? 's' : ''} missing ${list(cmp.missing)}` });
    if (cmp.extra.length) flags.push({ level: 'warn', text: `${name}: number${cmp.extra.length > 1 ? 's' : ''} not in English ${list(cmp.extra)}` });
    if (cmp.unstyled.length) flags.push({ level: 'warn', text: `${name}: ${cmp.unstyled.length} number${cmp.unstyled.length > 1 ? 's' : ''} not formatted as math (${list(cmp.unstyled)})` });
    const words = latinWords(target);
    if (words.length >= 3) flags.push({ level: 'warn', text: `${name}: English words left (${words.slice(0, 4).join(', ')})` });
    for (const tag of ['strong', 'ol', 'ul']) {
      if (new RegExp(`<${tag}[\\s>]`, 'i').test(source ?? '') && !new RegExp(`<${tag}[\\s>]`, 'i').test(target ?? '')) {
        flags.push({ level: 'warn', text: `${name}: ${tag === 'strong' ? 'bold' : 'list'} formatting lost` });
      }
    }
  }

  en.forEach((s, i) => {
    const want = (s?.images ?? []).length;
    const have = (steps[i]?.images ?? []).length;
    if (want > have) flags.push({ level: 'error', text: `Step ${i + 1}: ${want - have} image${want - have > 1 ? 's' : ''} missing` });
  });
  return flags;
}

/** Approve, or send back with a reason. */
export function submitReview(client, translationId, approve, comment = '') {
  const body = approve ? { status: 'approved' } : { status: 'rejected', rejection_comment: comment };
  if (!approve && !comment.trim()) throw new Error('A reason is required when sending a translation back.');
  return client.request('POST', `/question-translations/${encodeURIComponent(translationId)}/review`, body);
}

export const STATUS_KEYS = ['pending_translation', 'pending_review', 'approved', 'rejected'];

/**
 * Progress of one assigned unit in `language`: how many questions are still to
 * translate, waiting for review, approved and sent back, plus who translated them.
 */
export async function unitProgress(client, language, assignment, portalUnit) {
  const qs = await allPages(client, [
    ['unit[]', portalUnit],
    ['translation_status[]', `pending_${language}_translation`],
    ['translation_status[]', `pending_${language}_review`],
    ['translation_status[]', `${language}_approved`],
    ['translation_status[]', `${language}_rejected`],
  ]);
  const counts = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
  const translators = {};
  for (const q of qs) {
    if (!belongsToUnit(q, assignment)) continue;
    const st = q.translation_statuses?.[language] ?? q[`${language}_translation_status`];
    if (st in counts) counts[st]++;
    const t = (q.translations ?? []).find((x) => x.language === language && x.translator);
    if (t && st !== 'pending_translation') translators[t.translator.name] = (translators[t.translator.name] ?? 0) + 1;
  }
  const total = STATUS_KEYS.reduce((n, k) => n + counts[k], 0);
  return { ...counts, total, translators };
}

/**
 * Units that still need translation in `language`, across all books, with
 * question counts: [{ subject, grade, unit, count }], for building new assignments.
 */
export async function unitsNeedingTranslation(client, language, onProgress) {
  const qs = await allPages(client, [['translation_status[]', `pending_${language}_translation`]], onProgress);
  const map = new Map();
  for (const q of qs) {
    const u = q.topic?.unit;
    const subject = String(u?.subject?.subject ?? '').replace(/\s+/g, ' ').trim();
    const grade = String(u?.subject?.grade?.name ?? '');
    const unit = String(u?.unit_name ?? '').replace(/\s+/g, ' ').trim();
    const key = `${nameKey(subject)}|${nameKey(grade)}|${looseKey(unit)}`;
    if (!map.has(key)) map.set(key, { subject, grade, unit, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].sort((a, b) => a.subject.localeCompare(b.subject) || a.unit.localeCompare(b.unit));
}
