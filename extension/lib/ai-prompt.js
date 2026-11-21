// "Copy for AI" / "Paste AI answer": a ready prompt the teacher pastes into any
// AI chat (ChatGPT, Gemini, Claude…), and a parser that puts the reply back into
// the question box and each solution-step box.

const LANG = { urdu: 'Urdu', sindhi: 'Sindhi' };
const MARK = { question: '### QUESTION', step: (n) => `### STEP ${n}` };

/** Portal HTML → plain text with paragraphs, **bold**, list items and $math$ kept. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(ol|ul)[^>]*>/gi, '\n')
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text from an AI reply → portal HTML (<p> per paragraph, <br>, <strong>, <ul>/<ol>). */
export function textToHtml(text) {
  const t = String(text ?? '').replace(/\r/g, '').trim();
  if (!t) return '';
  // The AI answered in HTML already: keep it.
  if (/<(p|br|strong|ol|ul|li)\b/i.test(t)) return t;
  const inline = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return t.split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => /^[-*•]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (lines.length && lines.every((l) => /^\d+[.)]\s+/.test(l))) {
      return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

/** The prompt the teacher pastes into an AI chat. q: { html, steps: string[], grade, topic } */
export function buildCopyPrompt(q, language, glossary = '') {
  const name = LANG[language] ?? language;
  const steps = q.steps ?? [];
  const lines = [
    `Translate this school mathematics question and its solution steps from English into ${name} for students in Pakistan${q.grade ? ` (Class ${q.grade})` : ''}${q.topic ? `, topic: ${q.topic}` : ''}.`,
    '',
    'Rules:',
    `- Use simple, natural ${name} that a good ${name}-medium math textbook would use, with standard Pakistani mathematical terms.`,
    '- Keep every formula written between $ signs (for example $5$ or $3x+2$) exactly as it is. Do not translate, change or remove anything inside $…$. Words inside \\text{…} may be translated.',
    '- Write numbers with Western digits (0-9) as in the English. Transliterate names (Ali → علی).',
    '- Keep **bold** markers, list items starting with "-", and paragraph breaks where they are.',
    `- Keep exactly ${steps.length} solution step${steps.length === 1 ? '' : 's'}, in the same order.`,
    '- Reply with ONLY the translation in exactly this format (keep the ### lines in English, no other text):',
    '',
    MARK.question,
    `(${name} question)`,
    ...steps.flatMap((_, i) => ['', MARK.step(i + 1), `(${name} step ${i + 1})`]),
  ];
  if (glossary?.trim()) lines.push('', 'Always use these translations:', glossary.trim());
  lines.push('', '— English to translate —', '', MARK.question, htmlToText(q.html));
  steps.forEach((s, i) => lines.push('', MARK.step(i + 1), htmlToText(s) || '(no text — this step is an image)'));
  return lines.join('\n');
}

/**
 * Split an AI reply into the question and each step.
 * Returns { questionHtml, stepsHtml: (string|null)[], warnings: string[] }.
 */
export function parseAiAnswer(reply, stepCount) {
  const text = String(reply ?? '')
    .replace(/\r/g, '')
    .replace(/^```[a-z]*\n?|```$/gim, '')
    .replace(/\*\*(#{2,}\s*(QUESTION|STEP\s*\d+))\*\*/gi, '$1');
  const re = /^\s*(?:#{1,6}\s*)?\**\s*(QUESTION|STEP\s*(\d+))\s*\**\s*:?\s*$/gim;
  const marks = [];
  let m;
  const echoAt = text.search(/(^|\n)\s*—\s*English to translate/);
  while ((m = re.exec(text))) {
    if (echoAt !== -1 && m.index > echoAt) break; // sections after an echoed English part are not translations
    marks.push({ kind: m[2] ? 'step' : 'question', n: m[2] ? Number(m[2]) : 0, start: m.index, end: re.lastIndex });
  }

  const warnings = [];
  const steps = Array(stepCount).fill(null);
  let questionHtml = null;

  if (!marks.length) {
    // No markers: treat the whole reply as the question (single-field answers).
    if (stepCount > 0) warnings.push('The reply has no "### QUESTION / ### STEP" lines, so everything went into the question box. Check the steps.');
    return { questionHtml: textToHtml(text), stepsHtml: steps, warnings };
  }

  marks.forEach((mk, i) => {
    // If the AI echoed the English part of the prompt back, drop everything from that line on.
    const body = text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : text.length)
      .replace(/(^|\n)\s*—\s*English to translate[\s\S]*$/, '')
      .trim();
    if (!body) return;
    const html = textToHtml(body);
    if (mk.kind === 'question') {
      if (questionHtml == null) questionHtml = html;
    } else if (mk.n >= 1 && mk.n <= stepCount) {
      if (steps[mk.n - 1] == null) steps[mk.n - 1] = html;
    } else {
      warnings.push(`The reply has a step ${mk.n}, but this question has only ${stepCount} step${stepCount === 1 ? '' : 's'}; it was left out.`);
    }
  });
  if (questionHtml == null) warnings.push('The reply has no question part.');
  const missing = steps.map((s, i) => (s == null ? i + 1 : null)).filter(Boolean);
  if (missing.length) warnings.push(`The reply is missing step ${missing.join(', ')}.`);
  return { questionHtml, stepsHtml: steps, warnings };
}
