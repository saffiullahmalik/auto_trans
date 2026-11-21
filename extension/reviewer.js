// Reviewer mode: dashboard, side-by-side review with one-key approve / send back,
// and the teacher-assignment builder. Loaded by app.js for reviewer accounts.

import { LANGUAGES, imageUrl } from './lib/portal.js';
import { resolveUnit, unitLabel, looseKey, nameKey } from './lib/units.js';
import {
  loadReviewQueue, reviewFilterOptions, reviewContent, reviewFlags, submitReview,
  unitProgress, unitsNeedingTranslation, pendingTranslation,
} from './lib/review.js';
import { buildAssignmentRows, parseAssignmentRows } from './lib/assign-sheet.js';
import { readSheetFile, downloadXlsx, downloadCsv } from './lib/sheet-io.js';

const REASONS = [
  'Formula missing or changed',
  'Wrong math term',
  'Image missing',
  'Incomplete translation',
  'Unnatural or unclear Urdu',
  'English words left untranslated',
];

export function initReviewer(ctx) {
  const { state, store, $, el, toast, show, withSession, htmlBlock, getAssignments, setAssignments } = ctx;

  const rv = {
    tab: 'dashboard',
    language: 'urdu',
    options: null,
    queue: null,          // questions waiting for review
    session: null,        // { items, index, results: Map(id -> 'approved'|'rejected'|'skipped') }
    assign: null,         // assignments being edited
    units: null,          // units needing translation
    busy: false,
  };

  const L = () => LANGUAGES[rv.language];
  const client = () => state.client;
  const today = () => new Date().toISOString().slice(0, 10);

  async function options() {
    if (!rv.options) rv.options = await withSession(() => reviewFilterOptions(client()));
    return rv.options;
  }

  // ------------------------------------------------------------ tabs
  for (const t of document.querySelectorAll('[data-rtab]')) t.addEventListener('click', () => selectTab(t.dataset.rtab));
  function selectTab(tab) {
    rv.tab = tab;
    for (const t of document.querySelectorAll('[data-rtab]')) t.setAttribute('aria-selected', String(t.dataset.rtab === tab));
    for (const id of ['dashboard', 'review', 'assign']) $(`#rtab-${id}`).hidden = id !== tab;
    if (tab === 'assign') renderAssign();
  }
  $('#rv-language').addEventListener('change', async () => {
    rv.language = $('#rv-language').value;
    await store.set('reviewerLanguage', rv.language);
    rv.queue = null;
    $('#rv-groups').replaceChildren();
    $('#rv-queue-status').textContent = 'Loads every translation waiting for your review.';
    $('#rv-progress').replaceChildren();
    loadStats();
  });

  async function openReviewer() {
    rv.language = (await store.get('reviewerLanguage')) || 'urdu';
    $('#rv-language').value = rv.language;
    show('reviewer');
    selectTab(rv.tab);
    loadStats();
  }

  // ------------------------------------------------------------ dashboard
  async function loadStats() {
    const box = $('#rv-stats');
    box.replaceChildren(el('p', { class: 'muted' }, 'Loading totals…'));
    try {
      const d = await withSession(() => client().request('GET', '/admin/questions/statistics'));
      const data = d?.data ?? {};
      const k = rv.language;
      const lang = data[k] ?? {};
      const byLang = data.by_language?.[k] ?? {};
      const n = (a, b) => Number(lang[a] ?? byLang[b] ?? 0);
      const s = {
        left: n(`pending_${k}_translation`, 'pending_translation'),
        review: n(`pending_${k}_review`, 'pending_review'),
        approved: n(`approved_${k}_translation`, 'approved'),
        rejected: n(`rejected_${k}_translation`, 'rejected'),
      };
      const total = s.left + s.review + s.approved + s.rejected;
      const done = s.review + s.approved;
      const pct = (x) => (total ? Math.round((x / total) * 100) : 0);
      const stat = (num, lbl, sub) => el('div', { class: 'stat' }, el('div', { class: 'num' }, num.toLocaleString('en-US')), el('div', { class: 'lbl' }, lbl), sub ? el('div', { class: 'lbl' }, sub) : null);
      box.replaceChildren(
        stat(total, `${L().label} questions in total`),
        stat(done, 'Translated', `${pct(done)}% of all`),
        stat(s.review, 'Waiting for review'),
        stat(s.approved, 'Approved', `${pct(s.approved)}% of all`),
        stat(s.rejected, 'Sent back'),
        stat(s.left, 'Left to translate', `${pct(s.left)}% of all`),
      );
    } catch (e) {
      box.replaceChildren(el('p', { class: 'error' }, `Could not load totals: ${e.message}`));
    }
  }

  $('#rv-load-progress').addEventListener('click', async () => {
    if (rv.busy) return;
    rv.busy = true;
    const status = $('#rv-progress-status');
    const table = $('#rv-progress');
    try {
      const { teachers } = await getAssignments();
      const { units } = await options();
      const rows = teachers.flatMap((t) => t.units.map((u) => ({ teacher: t.name, u })));
      let done = 0;
      const results = new Map();
      const queue = [...rows];
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const r = queue.shift();
          const portalUnit = resolveUnit(units, r.u.unit);
          try {
            results.set(r, portalUnit ? await withSession(() => unitProgress(client(), rv.language, r.u, portalUnit)) : { error: 'unit not found on portal' });
          } catch (e) {
            results.set(r, { error: e.message });
          }
          status.textContent = `Loading progress… ${++done} of ${rows.length} units`;
        }
      }));

      const head = el('tr', {}, ...['Teacher', 'Unit', 'Questions', 'Left', 'Waiting review', 'Approved', 'Sent back', 'Progress', 'Translated by'].map((h) => el('th', {}, h)));
      const body = [];
      const sum = { total: 0, pending_translation: 0, pending_review: 0, approved: 0, rejected: 0 };
      for (const t of teachers) {
        const tSum = { total: 0, pending_translation: 0, pending_review: 0, approved: 0, rejected: 0 };
        for (const u of t.units) {
          const r = results.get(rows.find((x) => x.teacher === t.name && x.u === u));
          if (!r || r.error) {
            body.push(el('tr', {}, el('td', {}, t.name), el('td', {}, unitLabel(u)), el('td', { colspan: 7, class: 'error' }, r?.error ?? 'not loaded')));
            continue;
          }
          for (const key of Object.keys(tSum)) { tSum[key] += r[key]; sum[key] += r[key]; }
          body.push(progressRow(t.name, unitLabel(u), r, Object.entries(r.translators).map(([n, c]) => `${n} (${c})`).join(', ')));
        }
        body.push(progressRow(el('strong', {}, `${t.name} — total`), '', tSum, '', true));
      }
      body.push(progressRow(el('strong', {}, 'All teachers'), '', sum, '', true));
      table.replaceChildren(el('thead', {}, head), el('tbody', {}, body));
      status.textContent = `${rows.length} assigned units · updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      status.textContent = `Could not load progress: ${e.message}`;
    } finally {
      rv.busy = false;
    }
  });

  function progressRow(teacher, unit, r, by, strong = false) {
    const pct = (x) => (r.total ? (x / r.total) * 100 : 0);
    const bar = el('div', { class: 'bar', title: `${Math.round(pct(r.approved))}% approved, ${Math.round(pct(r.pending_review))}% waiting review` },
      el('span', { class: 'b-approved', style: `width:${pct(r.approved)}%` }),
      el('span', { class: 'b-review', style: `width:${pct(r.pending_review)}%` }),
      el('span', { class: 'b-rejected', style: `width:${pct(r.rejected)}%` }));
    const num = (v) => el('td', { class: 'num-cell' }, strong ? el('strong', {}, v) : v);
    return el('tr', {}, el('td', {}, teacher), el('td', {}, unit), num(r.total), num(r.pending_translation), num(r.pending_review), num(r.approved), num(r.rejected),
      el('td', {}, bar, el('span', { class: 'muted' }, ` ${Math.round(pct(r.pending_review + r.approved))}% translated`)), el('td', { class: 'muted' }, by));
  }

  // ------------------------------------------------------------ review queue
  const groupKey = (q, by) => {
    if (by === 'translator') return pendingTranslation(q, rv.language)?.translator?.name ?? '(unknown translator)';
    const u = q.topic?.unit;
    return `Class ${u?.subject?.grade?.name} · ${String(u?.unit_name ?? '').replace(/\s+/g, ' ')}`;
  };

  $('#rv-load-queue').addEventListener('click', async () => {
    if (rv.busy) return;
    rv.busy = true;
    const status = $('#rv-queue-status');
    try {
      rv.queue = await withSession(() => loadReviewQueue(client(), rv.language, {}, (page, last, total) => {
        status.textContent = `Loading… page ${page} of ${last} (${total} translations waiting)`;
      }));
      renderGroups();
    } catch (e) {
      status.textContent = `Could not load the review queue: ${e.message}`;
    } finally {
      rv.busy = false;
    }
  });
  for (const r of document.querySelectorAll('input[name=rv-group]')) r.addEventListener('change', () => rv.queue && renderGroups());

  function renderGroups() {
    const by = document.querySelector('input[name=rv-group]:checked').value;
    const groups = new Map();
    for (const q of rv.queue) {
      const k = groupKey(q, by);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(q);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    $('#rv-queue-status').textContent = rv.queue.length
      ? `${rv.queue.length} ${L().label} translations waiting for review · choose a group to start`
      : `No ${L().label} translations are waiting for review.`;
    $('#rv-groups').replaceChildren(...sorted.map(([name, items]) => {
      const flagged = items.filter((q) => reviewFlags(q, rv.language).some((f) => f.level === 'error')).length;
      return el('button', { type: 'button', class: 'group-item', onclick: () => startSession(items) },
        el('span', {}, el('strong', {}, name)),
        el('span', { class: 'row' },
          flagged ? el('span', { class: 'pill err' }, `${flagged} with problems`) : null,
          el('span', { class: 'pill' }, `${items.length} to review`)));
    }));
  }

  function startSession(items) {
    rv.session = { items: [...items], index: 0, results: new Map() };
    openItem(0);
  }

  // ------------------------------------------------------------ review screen
  function openItem(index) {
    const s = rv.session;
    if (index >= s.items.length) return finishSession();
    s.index = index;
    closeSendBack();
    show('review');
    window.scrollTo(0, 0);

    const q = s.items[index];
    const { translation, questionHtml, steps } = reviewContent(q, rv.language);
    const done = [...s.results.values()].filter((x) => x !== 'skipped').length;
    $('#rv-position').textContent = `Question ${index + 1} of ${s.items.length} (${done} reviewed)`;
    $('#rv-id').textContent = `ID ${q.id}`;
    const u = q.topic?.unit;
    $('#rv-meta').textContent = [u?.subject?.grade?.name && `Class ${u.subject.grade.name}`, u?.unit_name, q.topic?.topic_name].filter(Boolean).join(' › ');
    const result = s.results.get(q.id);
    $('#rv-badges').replaceChildren(...[
      el('span', { class: 'pill info' }, `${L().label} — ${L().native}`),
      translation?.translator ? el('span', { class: 'pill' }, `Translated by ${translation.translator.name}`) : null,
      translation?.submitted_at ? el('span', { class: 'pill' }, `Sent ${translation.submitted_at.slice(0, 16)}`) : null,
      result ? el('span', { class: `pill ${result === 'approved' ? 'ok' : result === 'rejected' ? 'err' : 'warn'}` }, result === 'approved' ? 'Approved' : result === 'rejected' ? 'Sent back' : 'Skipped') : null,
    ].filter(Boolean));

    const flags = reviewFlags(q, rv.language);
    $('#rv-flags').replaceChildren(...(flags.length
      ? flags.map((f) => el('span', { class: `flag ${f.level}` }, f.text))
      : [el('span', { class: 'flag ok' }, 'No problems found by the automatic checks')]));

    const enSteps = Array.isArray(q.solution_steps) ? q.solution_steps : [];
    const qImages = Array.isArray(q.question_image) ? q.question_image : q.question_image ? [q.question_image] : [];
    const fields = [pair('Question', q.question_text, questionHtml, qImages, [], optionsList(q))];
    const n = Math.max(enSteps.length, steps.length);
    for (let i = 0; i < n; i++) {
      fields.push(pair(`Solution step ${i + 1}`, enSteps[i]?.explanation ?? '', steps[i]?.explanation ?? '', enSteps[i]?.images ?? [], steps[i]?.images ?? []));
    }
    $('#rv-fields').replaceChildren(...fields);
    $('#rv-prev').disabled = index === 0;
    $('#rv-approve').disabled = !translation || result === 'approved' || result === 'rejected';
    $('#rv-reject').disabled = $('#rv-approve').disabled;
  }

  function images(paths) {
    if (!paths?.length) return null;
    return el('div', { class: 'images' }, ...paths.map((p) => el('figure', {}, el('img', { src: imageUrl(p), alt: '', loading: 'lazy' }))));
  }

  function optionsList(q) {
    if (!Array.isArray(q.options) || !q.options.length) return null;
    const correct = new Set((q.correct_answers ?? []).map(String));
    return el('ol', { class: 'options' }, ...q.options.map((o) => {
      const li = el('li', { class: correct.has(String(o.id)) ? 'correct' : '' });
      if (o.text) li.append(htmlBlock(o.text));
      else if (o.image) li.append(el('img', { src: imageUrl(o.image), alt: '' }));
      return li;
    }));
  }

  function pair(title, englishHtml, translatedHtml, enImages, trImages, extra = null) {
    const tr = htmlBlock(translatedHtml || '<p>—</p>', `content rtl-view ${L().fontClass}`);
    tr.setAttribute('dir', 'rtl');
    return el('div', { class: 'pair' },
      el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, `${title} — English`), htmlBlock(englishHtml), extra, images(enImages)),
      el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, `${title} — ${L().label}`), tr, images(trImages)));
  }

  async function review(approve, comment = '') {
    const s = rv.session;
    const q = s?.items[s.index];
    if (!q || rv.busy) return;
    const t = pendingTranslation(q, rv.language);
    if (!t) { toast('This translation is no longer waiting for review.'); return; }
    rv.busy = true;
    $('#rv-approve').disabled = true;
    $('#rv-reject').disabled = true;
    try {
      await withSession(() => submitReview(client(), t.id, approve, comment));
      s.results.set(q.id, approve ? 'approved' : 'rejected');
      t.status = approve ? 'approved' : 'rejected';
      toast(approve ? `Question ${q.id} approved ✓` : `Question ${q.id} sent back to ${t.translator?.name ?? 'the translator'}`);
      rv.busy = false;
      openItem(nextOpen(s.index + 1));
    } catch (e) {
      rv.busy = false;
      toast(`Could not save the review for ${q.id}: ${e.message}`, 6000);
      openItem(s.index);
    }
  }

  function nextOpen(from) {
    const s = rv.session;
    for (let i = from; i < s.items.length; i++) if (!s.results.has(s.items[i].id)) return i;
    for (let i = 0; i < from && i < s.items.length; i++) if (!s.results.has(s.items[i].id)) return i;
    return s.items.length;
  }

  function finishSession() {
    const s = rv.session;
    const count = (k) => [...s.results.values()].filter((x) => x === k).length;
    toast(`Done: ${count('approved')} approved, ${count('rejected')} sent back, ${count('skipped')} skipped.`, 6000);
    if (rv.queue) {
      const reviewed = new Set([...s.results.entries()].filter(([, v]) => v !== 'skipped').map(([id]) => id));
      rv.queue = rv.queue.filter((q) => !reviewed.has(q.id));
    }
    show('reviewer');
    selectTab('review');
    if (rv.queue) renderGroups();
  }

  // Send back panel
  function openSendBack() {
    if ($('#rv-reject').disabled) return;
    $('#rv-sendback').hidden = false;
    const chosen = new Set();
    const comment = $('#rv-comment');
    comment.value = '';
    const flags = reviewFlags(rv.session.items[rv.session.index], rv.language).filter((f) => f.level === 'error');
    const chips = REASONS.map((r) => {
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false' }, r);
      b.addEventListener('click', () => {
        if (chosen.has(r)) chosen.delete(r); else chosen.add(r);
        b.setAttribute('aria-pressed', String(chosen.has(r)));
        const typed = comment.value.split('\n').filter((l) => !REASONS.some((x) => l.startsWith('• ' + x)) && !l.startsWith('• Auto-check'));
        comment.value = [...[...chosen].map((x) => `• ${x}`), ...typed].join('\n').trim();
      });
      return b;
    });
    if (flags.length) {
      const b = el('button', { type: 'button', class: 'chip' }, 'Add detected problems');
      b.addEventListener('click', () => { comment.value = [comment.value, ...flags.map((f) => `• Auto-check: ${f.text}`)].filter(Boolean).join('\n'); });
      chips.push(b);
    }
    $('#rv-reasons').replaceChildren(...chips);
    comment.focus();
  }
  function closeSendBack() { $('#rv-sendback').hidden = true; }
  function confirmSendBack() {
    const text = $('#rv-comment').value.trim();
    if (!text) { toast('Please give the translator a reason.'); $('#rv-comment').focus(); return; }
    review(false, text);
  }

  $('#rv-approve').addEventListener('click', () => review(true));
  $('#rv-reject').addEventListener('click', openSendBack);
  $('#rv-sendback-confirm').addEventListener('click', confirmSendBack);
  $('#rv-sendback-cancel').addEventListener('click', closeSendBack);
  $('#rv-skip').addEventListener('click', () => {
    const s = rv.session;
    if (!s.results.has(s.items[s.index].id)) s.results.set(s.items[s.index].id, 'skipped');
    openItem(s.index + 1 < s.items.length ? s.index + 1 : s.items.length);
  });
  $('#rv-prev').addEventListener('click', () => rv.session.index > 0 && openItem(rv.session.index - 1));
  $('#rv-back').addEventListener('click', () => finishSession());

  document.addEventListener('keydown', (ev) => {
    if ($('#view-review').hidden) return;
    if (!(ev.ctrlKey || ev.metaKey) || ev.key !== 'Enter') return;
    ev.preventDefault();
    if (!$('#rv-sendback').hidden) confirmSendBack();
    else if (ev.shiftKey) openSendBack();
    else review(true);
  });

  // ------------------------------------------------------------ assignments
  async function ensureAssign() {
    if (!rv.assign) {
      const a = await getAssignments();
      rv.assign = { title: a.title ?? '', language: a.language ?? 'urdu', teachers: structuredClone(a.teachers ?? []) };
    }
    return rv.assign;
  }

  const assignedKey = (u) => `${nameKey(u.grade)}|${nameKey(u.subject)}|${looseKey(u.unit)}`;

  async function renderAssign() {
    const a = await ensureAssign();
    $('#as-title').value = a.title;
    const box = $('#as-teachers');
    box.replaceChildren(...a.teachers.map((t, ti) => el('div', { class: 'teacher-card' },
      el('div', { class: 'row spread' },
        el('strong', {}, `${t.name} — ${t.units.length} unit${t.units.length === 1 ? '' : 's'}, ${t.units.reduce((n, u) => n + (u.count ?? 0), 0)} questions`),
        el('button', { type: 'button', class: 'small', onclick: () => { if (confirm(`Remove ${t.name} and all their units?`)) { a.teachers.splice(ti, 1); renderAssign(); } } }, 'Remove teacher')),
      ...t.units.map((u, ui) => el('div', { class: 'unit-row' },
        el('span', {}, unitLabel(u), el('span', { class: 'muted' }, ` · ${u.subject}`)),
        el('span', { class: 'row' },
          u.count != null ? el('span', { class: 'pill' }, `${u.count} questions`) : null,
          el('button', { type: 'button', class: 'small', onclick: () => { t.units.splice(ui, 1); renderAssign(); } }, 'Remove'))),
      ),
      t.units.length ? null : el('p', { class: 'muted' }, 'No units yet — add some from “Find units” below.'),
    )));
    if (rv.units) renderUnits();
  }

  $('#as-title').addEventListener('input', () => { if (rv.assign) rv.assign.title = $('#as-title').value; });
  $('#as-add-teacher').addEventListener('click', async () => {
    const name = $('#as-new-teacher').value.trim();
    if (!name) return;
    const a = await ensureAssign();
    if (a.teachers.some((t) => nameKey(t.name) === nameKey(name))) { toast(`${name} is already in the list.`); return; }
    a.teachers.push({ name, units: [] });
    $('#as-new-teacher').value = '';
    renderAssign();
  });

  $('#as-load-units').addEventListener('click', async () => {
    if (rv.busy) return;
    rv.busy = true;
    const status = $('#as-units-status');
    try {
      rv.units = await withSession(() => unitsNeedingTranslation(client(), rv.language, (page, last) => {
        status.textContent = `Loading… page ${page} of ${last}`;
      }));
      const subjects = [...new Set(rv.units.map((u) => u.subject))].sort();
      const sel = $('#as-subject');
      const keep = sel.value;
      sel.replaceChildren(el('option', { value: '' }, 'All books'), ...subjects.map((s) => el('option', { value: s }, s)));
      sel.value = subjects.includes(keep) ? keep : '';
      renderUnits();
    } catch (e) {
      status.textContent = `Could not load units: ${e.message}`;
    } finally {
      rv.busy = false;
    }
  });
  $('#as-subject').addEventListener('change', () => rv.units && renderUnits());
  $('#as-hide-assigned').addEventListener('change', () => rv.units && renderUnits());

  function renderUnits() {
    const a = rv.assign;
    const assigned = new Map();
    for (const t of a.teachers) for (const u of t.units) assigned.set(assignedKey(u), t.name);
    const subject = $('#as-subject').value;
    const hide = $('#as-hide-assigned').checked;
    const list = rv.units.filter((u) => (!subject || u.subject === subject) && !(hide && assigned.has(assignedKey(u))));
    $('#as-units-status').textContent = `${list.length} units shown · ${list.reduce((n, u) => n + u.count, 0)} questions still to translate`;
    const teacherSelect = () => el('select', {}, ...a.teachers.map((t) => el('option', { value: t.name }, t.name)));
    $('#as-units').replaceChildren(
      el('thead', {}, el('tr', {}, ...['Book', 'Class', 'Unit', 'Left to translate', 'Assigned to', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...list.map((u) => {
        const owner = assigned.get(assignedKey(u));
        const sel = teacherSelect();
        return el('tr', {},
          el('td', {}, u.subject), el('td', {}, u.grade), el('td', {}, u.unit), el('td', { class: 'num-cell' }, u.count),
          el('td', {}, owner ? el('span', { class: 'pill info' }, owner) : a.teachers.length ? sel : el('span', { class: 'muted' }, 'add a teacher first')),
          el('td', {}, owner || !a.teachers.length ? '' : el('button', {
            type: 'button', class: 'small',
            onclick: () => {
              const t = a.teachers.find((x) => x.name === sel.value);
              t.units.push({ subject: u.subject, grade: u.grade, unit: u.unit, count: u.count });
              renderAssign();
              toast(`${unitLabel(u)} assigned to ${t.name}`);
            },
          }, 'Assign')));
      })),
    );
  }

  const sheetRows = () => buildAssignmentRows({ title: rv.assign.title, language: rv.language, teachers: rv.assign.teachers.filter((t) => t.units.length) });
  const fileBase = () => `${L().label}_Translation_Teacher_Assignments_${today()}`;
  $('#as-xlsx').addEventListener('click', async () => { await ensureAssign(); downloadXlsx(sheetRows(), `${fileBase()}.xlsx`); });
  $('#as-csv').addEventListener('click', async () => { await ensureAssign(); downloadCsv(sheetRows(), `${fileBase()}.csv`); });
  $('#as-save').addEventListener('click', async () => {
    const a = await ensureAssign();
    await setAssignments({ title: a.title, language: rv.language, teachers: a.teachers.filter((t) => t.units.length || true) });
    toast('Assignments saved. Download the sheet and send it to teachers to “Import sheet”.', 5000);
  });
  $('#as-import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const parsed = parseAssignmentRows(await readSheetFile(file));
      rv.assign = { title: parsed.title, language: rv.language, teachers: parsed.teachers };
      renderAssign();
      toast(`Loaded ${parsed.teachers.length} teachers from ${file.name}. Press “Save assignments” to keep them.`, 5000);
    } catch (e) {
      toast(`Could not read ${file.name}: ${e.message}`, 6000);
    }
  });

  return { openReviewer };
}
