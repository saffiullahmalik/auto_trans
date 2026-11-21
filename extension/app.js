import { parseQuestionIds } from './lib/ids.js';
import { compareMath, extractMath, plainText } from './lib/math.js';
import { memoryKey, memoryValue, applyMemory } from './lib/memory.js';
import {
  LANGUAGES, PortalClient, SessionExpiredError, login, translationStatus, isTranslatable,
  rejectionComment, imageUrl, fetchImageFile, buildSubmitForm,
} from './lib/portal.js';
import { suggestTranslation, DEFAULT_MODEL } from './lib/ai.bundle.js';

// ---------------------------------------------------------------- storage
const store = {
  async get(key, fallback = null) {
    const r = await chrome.storage.local.get(key);
    return r[key] ?? fallback;
  },
  set(key, value) { return chrome.storage.local.set({ [key]: value }); },
  remove(key) { return chrome.storage.local.remove(key); },
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
};

// ---------------------------------------------------------------- state
const state = {
  auth: null,          // { token, user, identifier }
  settings: null,      // { language, aiEnabled, apiKey, model, glossary }
  client: null,
  queue: null,         // { language, ids, items: { [id]: { progress, message } }, index }
  questions: new Map(),  // id -> question | { error }
  aiJobs: new Map(),     // `${lang}:${id}` -> Promise
  imageFiles: new Map(), // path -> Promise<File>
  memory: {},            // memoryKey -> value
};

const PROGRESS_LABEL = {
  todo: ['To do', ''],
  draft: ['Draft saved', 'info'],
  submitted: ['Sent for review', 'ok'],
  skipped: ['Skipped', 'warn'],
  failed: ['Failed', 'err'],
  unavailable: ['Not available', 'err'],
  done_before: ['Already sent', 'ok'],
};

// ---------------------------------------------------------------- utils
function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  const loggedIn = !!state.auth;
  $('#btn-settings').hidden = !loggedIn;
  $('#btn-logout').hidden = !loggedIn;
  $('#user-label').textContent = loggedIn ? (state.auth.user?.name || state.auth.identifier) : '';
}

const ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'OL', 'UL', 'LI', 'SUB', 'SUP', 'PRE', 'CODE', 'SPAN', 'DIV']);
/** Keep only simple formatting tags, with no attributes. */
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html ?? ''}</div>`, 'text/html');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          walk(node);
          return;
        }
        for (const a of [...child.attributes]) child.removeAttribute(a.name);
        walk(child);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    }
  };
  const root = doc.body.firstChild;
  walk(root);
  // DIVs produced by contenteditable become paragraphs.
  return root.innerHTML.replace(/<div>/g, '<p>').replace(/<\/div>/g, '</p>');
}

function renderMath(node) {
  if (typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(node, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
    });
  } catch { /* leave raw LaTeX visible */ }
}

function htmlBlock(html, cls = 'content') {
  const d = el('div', { class: cls });
  d.innerHTML = sanitizeHtml(html);
  renderMath(d);
  return d;
}

async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

const lang = () => LANGUAGES[state.queue?.language ?? state.settings.language];
const draftKey = (id, language) => `draft:${language}:${id}`;
const englishSteps = (q) => (Array.isArray(q.solution_steps) ? q.solution_steps : []);

// ---------------------------------------------------------------- session handling
let reloginWaiter = null;
async function withSession(fn) {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof SessionExpiredError)) throw e;
      await relogin();
    }
  }
}
function relogin() {
  if (reloginWaiter) return reloginWaiter.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  reloginWaiter = { promise, resolve };
  const dlg = $('#dlg-relogin');
  $('#relogin-error').hidden = true;
  dlg.showModal();
  return promise;
}
$('#relogin-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const password = new FormData(ev.target).get('password');
  try {
    const { token, user } = await login(state.auth.identifier, password);
    await setAuth({ token, user, identifier: state.auth.identifier });
    ev.target.reset();
    $('#dlg-relogin').close();
    const w = reloginWaiter;
    reloginWaiter = null;
    w.resolve();
  } catch (e) {
    $('#relogin-error').textContent = e.message;
    $('#relogin-error').hidden = false;
  }
});
$('#dlg-relogin').addEventListener('cancel', (ev) => ev.preventDefault());

async function setAuth(auth) {
  state.auth = auth;
  state.client = auth ? new PortalClient(auth.token) : null;
  if (auth) await store.set('auth', auth);
  else await store.remove('auth');
}

// ---------------------------------------------------------------- login view
$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const identifier = String(fd.get('identifier')).trim();
  const btn = ev.target.querySelector('button');
  btn.disabled = true;
  $('#login-error').hidden = true;
  try {
    const { token, user } = await login(identifier, fd.get('password'));
    if (user?.role && user.role !== 'translator' && user.role !== 'admin') {
      throw new Error(`This account's role is "${user.role}". A translator account is needed.`);
    }
    await setAuth({ token, user, identifier });
    ev.target.reset();
    await openSetup();
  } catch (e) {
    $('#login-error').textContent = e.message;
    $('#login-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await setAuth(null);
  show('login');
});

// ---------------------------------------------------------------- setup view
function updateParsePreview() {
  const { ids, duplicates, ignored } = parseQuestionIds($('#setup-ids').value);
  const parts = [];
  if (ids.length) parts.push(`${ids.length} question ID${ids.length === 1 ? '' : 's'} found`);
  if (duplicates.length) parts.push(`${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'} removed`);
  if (ignored.length) parts.push(`ignored: ${ignored.slice(0, 3).map((t) => `"${t}"`).join(', ')}${ignored.length > 3 ? '…' : ''}`);
  $('#setup-parse').textContent = parts.join(' · ');
  $('#btn-load').disabled = ids.length === 0;
}
$('#setup-ids').addEventListener('input', updateParsePreview);

async function openSetup() {
  $('#setup-language').value = state.settings.language;
  const saved = await store.get('queue');
  $('#btn-resume').hidden = !saved?.ids?.length;
  if (saved?.ids?.length) {
    $('#btn-resume').textContent = `Resume previous list (${saved.ids.length} questions, ${LANGUAGES[saved.language].label})`;
  }
  updateParsePreview();
  show('setup');
}

$('#btn-load').addEventListener('click', async () => {
  const { ids } = parseQuestionIds($('#setup-ids').value);
  const language = $('#setup-language').value;
  state.settings.language = language;
  await store.set('settings', state.settings);
  state.queue = {
    language,
    ids,
    index: 0,
    items: Object.fromEntries(ids.map((id) => [id, { progress: 'todo' }])),
  };
  await saveQueue();
  $('#setup-ids').value = '';
  await openQueue(true);
});

$('#btn-resume').addEventListener('click', async () => {
  state.queue = await store.get('queue');
  await openQueue(true);
});

$('#btn-new-list').addEventListener('click', openSetup);

const saveQueue = () => store.set('queue', state.queue);

// ---------------------------------------------------------------- queue view
async function openQueue(fetchAll = false) {
  state.memory = await store.get(`tm:${state.queue.language}`, {});
  show('queue');
  $('#queue-title').textContent = `${state.queue.ids.length} questions · ${lang().label}`;
  renderQueue();
  if (fetchAll) await loadAllQuestions();
}

async function loadAllQuestions() {
  const missing = state.queue.ids.filter((id) => !state.questions.has(id));
  let done = 0;
  await pool(missing, 4, async (id) => {
    await loadQuestion(id);
    done++;
    if (done % 5 === 0 || done === missing.length) renderQueue();
  });
  renderQueue();
}

async function loadQuestion(id, force = false) {
  if (!force && state.questions.has(id) && !state.questions.get(id).error) return state.questions.get(id);
  let q;
  try {
    q = await withSession(() => state.client.getQuestion(id));
    if (!q || q.id == null) throw new Error('Question not found');
  } catch (e) {
    q = { error: e.status === 404 ? 'Question not found' : e.message };
  }
  state.questions.set(id, q);
  const item = state.queue.items[id];
  if (q.error) {
    item.progress = 'unavailable';
    item.message = q.error;
  } else {
    const st = translationStatus(q, state.queue.language);
    if (!isTranslatable(st) && item.progress !== 'submitted') {
      item.progress = 'done_before';
      item.message = st;
    } else if (item.progress === 'unavailable' || item.progress === 'done_before') {
      item.progress = 'todo';
      item.message = '';
    }
    if (item.progress === 'todo' && (await store.get(draftKey(id, state.queue.language)))) item.progress = 'draft';
  }
  await saveQueue();
  return q;
}

function portalStatusPill(q) {
  if (!q) return el('span', { class: 'pill' }, 'Loading…');
  if (q.error) return el('span', { class: 'pill err' }, q.error);
  const st = translationStatus(q, state.queue.language) ?? 'unknown';
  const cls = st === 'approved' ? 'ok' : st === 'pending_review' ? 'info' : st === 'rejected' ? 'err' : '';
  return el('span', { class: `pill ${cls}` }, st.replace(/_/g, ' '));
}

function renderQueue() {
  const body = $('#queue-body');
  body.replaceChildren();
  const counts = {};
  state.queue.ids.forEach((id, i) => {
    const item = state.queue.items[id];
    counts[item.progress] = (counts[item.progress] ?? 0) + 1;
    const q = state.questions.get(id);
    const [label, cls] = PROGRESS_LABEL[item.progress] ?? [item.progress, ''];
    const workable = workableIndex(i);
    body.append(el('tr', {},
      el('td', {}, i + 1),
      el('td', {}, id),
      el('td', {}, q && !q.error ? (q.topic?.topic_name ?? '') : ''),
      el('td', {}, portalStatusPill(q)),
      el('td', {}, el('span', { class: `pill ${cls}`, title: item.message ?? '' }, label)),
      el('td', {}, workable ? el('button', { class: 'small', type: 'button', onclick: () => openEditor(i) }, 'Open') : ''),
    ));
  });
  const parts = Object.entries(counts).map(([k, n]) => `${PROGRESS_LABEL[k]?.[0] ?? k}: ${n}`);
  $('#queue-summary').textContent = parts.join(' · ');
  $('#btn-start').disabled = nextWorkable(0) === -1;
}

function workableIndex(i) {
  const id = state.queue.ids[i];
  const q = state.questions.get(id);
  const p = state.queue.items[id].progress;
  return q && !q.error && ['todo', 'draft', 'skipped', 'failed'].includes(p);
}
function nextWorkable(from, includeSkipped = false) {
  for (let i = from; i < state.queue.ids.length; i++) {
    const p = state.queue.items[state.queue.ids[i]].progress;
    if (workableIndex(i) && (includeSkipped || p !== 'skipped')) return i;
  }
  return -1;
}

$('#btn-start').addEventListener('click', () => {
  let i = nextWorkable(0);
  if (i === -1) i = nextWorkable(0, true);
  if (i !== -1) openEditor(i);
});

$('#btn-export').addEventListener('click', () => {
  const rows = [['question_id', 'language', 'result', 'portal_status', 'message']];
  for (const id of state.queue.ids) {
    const item = state.queue.items[id];
    const q = state.questions.get(id);
    rows.push([id, state.queue.language, PROGRESS_LABEL[item.progress]?.[0] ?? item.progress,
      q && !q.error ? translationStatus(q, state.queue.language) ?? '' : '', item.message ?? '']);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: `translations-${state.queue.language}-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------------------------------------------------------- AI + memory
function fromMemory(englishHtml) {
  const key = memoryKey(state.queue.language, englishHtml);
  const v = state.memory[key];
  return v ? applyMemory(englishHtml, v) : null;
}

function aiInput(q) {
  return {
    html: q.question_text ?? '',
    steps: englishSteps(q).map((s) => s.explanation ?? ''),
    grade: q.topic?.unit?.subject?.grade?.name,
    subject: q.topic?.unit?.subject?.subject,
    topic: q.topic?.topic_name,
  };
}

/** Initial translation for a question: memory first, then AI for whatever is left. */
function suggestion(id, { useMemory = true } = {}) {
  const key = `${state.queue.language}:${id}`;
  if (useMemory && state.aiJobs.has(key)) return state.aiJobs.get(key);
  const job = (async () => {
    const q = state.questions.get(id);
    const input = aiInput(q);
    const result = {
      questionHtml: useMemory ? fromMemory(input.html) : null,
      stepsHtml: input.steps.map((s) => (useMemory ? fromMemory(s) : null)),
      source: 'memory',
      error: null,
    };
    const needAi = result.questionHtml == null || result.stepsHtml.some((s, i) => s == null && plainText(input.steps[i]));
    if (needAi && state.settings.aiEnabled) {
      try {
        const ai = await suggestTranslation({
          apiKey: state.settings.apiKey,
          model: state.settings.model || DEFAULT_MODEL,
          language: state.queue.language,
          glossary: state.settings.glossary,
          question: input,
        });
        result.questionHtml ??= ai.questionHtml;
        result.stepsHtml = result.stepsHtml.map((s, i) => s ?? ai.stepsHtml[i]);
        result.source = 'ai';
      } catch (e) {
        result.error = e.message;
      }
    }
    result.questionHtml ??= '';
    result.stepsHtml = result.stepsHtml.map((s) => s ?? '');
    return result;
  })();
  state.aiJobs.set(key, job);
  job.then((r) => { if (r.error) state.aiJobs.delete(key); });
  return job;
}

/** Warm up the next few questions so the teacher never waits. */
function prefetchAhead(index) {
  let found = 0;
  for (let i = index + 1; i < state.queue.ids.length && found < 2; i++) {
    if (!workableIndex(i)) continue;
    found++;
    const id = state.queue.ids[i];
    store.get(draftKey(id, state.queue.language)).then((d) => { if (!d) suggestion(id); });
    for (const s of englishSteps(state.questions.get(id))) for (const p of s.images ?? []) imageFile(p).catch(() => {});
  }
}

function imageFile(path) {
  if (!state.imageFiles.has(path)) {
    const p = fetchImageFile(path);
    state.imageFiles.set(path, p);
    p.catch(() => state.imageFiles.delete(path));
  }
  return state.imageFiles.get(path);
}

// ---------------------------------------------------------------- editor
const editor = { index: -1, id: null, fields: [], dirty: false, saveTimer: null, busy: false };

async function openEditor(index) {
  if (editor.id != null) await saveDraft();
  const id = state.queue.ids[index];
  const q = state.questions.get(id) ?? (await loadQuestion(id));
  if (!q || q.error) { toast(`Question ${id} could not be loaded.`); return; }
  state.queue.index = index;
  await saveQueue();
  Object.assign(editor, { index, id, fields: [], dirty: false });
  show('editor');
  window.scrollTo(0, 0);

  const L = lang();
  const total = state.queue.ids.length;
  const submitted = state.queue.ids.filter((x) => ['submitted', 'done_before'].includes(state.queue.items[x].progress)).length;
  $('#ed-position').textContent = `Question ${index + 1} of ${total} (${submitted} sent)`;
  $('#ed-id').textContent = `ID ${id}`;
  const grade = q.topic?.unit?.subject?.grade?.name;
  $('#ed-meta').textContent = [grade && `Grade ${grade}`, q.topic?.unit?.unit_name, q.topic?.topic_name].filter(Boolean).join(' › ');
  const st = translationStatus(q, state.queue.language);
  $('#ed-badges').replaceChildren(
    el('span', { class: 'pill' }, q.question_type?.replace(/_/g, ' ') ?? ''),
    el('span', { class: 'pill info' }, `${L.label} — ${L.native}`),
    st ? el('span', { class: `pill ${st === 'rejected' ? 'err' : ''}` }, st.replace(/_/g, ' ')) : null,
  );

  const notice = $('#ed-notice');
  const comment = rejectionComment(q, state.queue.language);
  notice.hidden = !(st === 'rejected');
  notice.className = 'notice err';
  notice.textContent = st === 'rejected' ? `Reviewer rejected the previous translation${comment ? `: “${comment}”` : '.'}` : '';

  const container = $('#ed-fields');
  container.replaceChildren();

  // Question prompt
  container.append(buildPair({
    title: 'Question',
    englishHtml: q.question_text,
    englishExtra: [
      imagesBlock(Array.isArray(q.question_image) ? q.question_image : q.question_image ? [q.question_image] : [], null),
      optionsBlock(q),
    ],
    copyImages: [],
  }));

  // Solution steps
  englishSteps(q).forEach((s, i) => {
    container.append(buildPair({
      title: `Solution step ${i + 1}`,
      englishHtml: s.explanation,
      englishExtra: [],
      copyImages: s.images ?? [],
    }));
  });

  // Fill the editors: saved draft > existing translation (rejected) > memory/AI.
  const draft = await store.get(draftKey(id, state.queue.language));
  if (draft) {
    fillEditors(draft.questionHtml, draft.stepsHtml, 'Your saved draft');
    draft.imageChoices?.forEach((choices, i) => editor.fields[i + 1]?.setImageChoices(choices));
  } else if (st === 'rejected' && q[L.textField]) {
    const existingSteps = Array.isArray(q[L.stepsField]) ? q[L.stepsField].map((s) => s?.explanation ?? '') : [];
    fillEditors(q[L.textField], englishSteps(q).map((_, i) => existingSteps[i] ?? ''), 'Previous translation (rejected)');
  } else {
    editor.fields.forEach((f) => f.setLoading(state.settings.aiEnabled ? 'Preparing AI suggestion…' : ''));
    const thisId = id;
    suggestion(id).then((r) => {
      if (editor.id !== thisId) return;
      fillEditors(r.questionHtml, r.stepsHtml, r.source === 'ai' ? 'AI suggestion — please check' : 'From your translation memory');
      if (r.error) showNotice(`AI suggestion unavailable: ${r.error}`, 'warn');
      editor.dirty = false;
    });
  }

  editor.fields[0]?.focus();
  prefetchAhead(index);
  $('#btn-prev').disabled = index === 0;
}

function showNotice(text, kind = 'warn') {
  const n = $('#ed-notice');
  n.className = `notice ${kind === 'warn' ? '' : kind}`;
  n.textContent = text;
  n.hidden = false;
}

function fillEditors(questionHtml, stepsHtml, sourceLabel) {
  editor.fields[0]?.setValue(questionHtml, sourceLabel);
  stepsHtml.forEach((h, i) => editor.fields[i + 1]?.setValue(h, sourceLabel));
}

function imagesBlock(paths, choices) {
  if (!paths.length) return null;
  const wrap = el('div', { class: 'images' });
  paths.forEach((p, i) => {
    const fig = el('figure', {}, el('img', { src: imageUrl(p), alt: '', loading: 'lazy' }));
    if (choices) {
      const cb = el('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', () => {
        choices[i] = cb.checked;
        fig.classList.toggle('off', !cb.checked);
        markDirty();
      });
      choices.inputs.push(cb);
      fig.append(el('label', {}, cb, 'Copy into translation'));
    }
    wrap.append(fig);
  });
  return wrap;
}

function optionsBlock(q) {
  if (!Array.isArray(q.options) || !q.options.length) return null;
  const correct = new Set((q.correct_answers ?? []).map(String));
  const list = el('ol', { class: 'options' });
  for (const o of q.options) {
    const li = el('li', { class: correct.has(String(o.id)) ? 'correct' : '' });
    if (o.text) li.append(htmlBlock(o.text, 'content'));
    else if (o.image) li.append(el('img', { src: imageUrl(o.image), alt: '' }));
    list.append(li);
  }
  return el('div', {}, el('div', { class: 'field-src' }, 'Answer options (not translated by translators)'), list);
}

function buildPair({ title, englishHtml, englishExtra, copyImages }) {
  const L = lang();
  const choices = copyImages.map(() => true);
  choices.inputs = [];

  const editable = el('div', {
    class: `editable ${L.fontClass}`, contenteditable: 'true', dir: 'rtl', lang: L.key === 'urdu' ? 'ur' : 'sd', spellcheck: 'false',
  });
  const source = el('span', { class: 'field-src' });
  const preview = el('div', { class: `preview ${L.fontClass}`, dir: 'rtl' });
  const warn = el('div', { class: 'field-warn', hidden: true });

  const updatePreview = () => {
    preview.innerHTML = sanitizeHtml(editable.innerHTML);
    renderMath(preview);
    const cmp = compareMath(englishHtml, editable.innerHTML);
    const msgs = [];
    if (cmp.missing.length) msgs.push(`Missing formula: ${cmp.missing.join('  ')}`);
    if (cmp.extra.length) msgs.push(`Formula not in English: ${cmp.extra.join('  ')}`);
    warn.textContent = msgs.join(' · ');
    warn.hidden = msgs.length === 0;
  };
  editable.addEventListener('input', () => { updatePreview(); markDirty(); });
  editable.addEventListener('paste', (ev) => {
    ev.preventDefault();
    const text = ev.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  const toolbar = el('div', { class: 'toolbar' },
    el('button', { class: 'small', type: 'button', title: 'Bold', onclick: () => { editable.focus(); document.execCommand('bold'); } }, el('strong', {}, 'B')),
    el('button', {
      class: 'small', type: 'button', title: 'Insert a formula, e.g. $5$',
      onclick: () => { editable.focus(); document.execCommand('insertText', false, ' $ $ '); },
    }, '∑ $…$'),
    el('button', {
      class: 'small', type: 'button', title: 'Copy the English formulas in order to the clipboard',
      onclick: async () => {
        await navigator.clipboard.writeText(extractMath(englishHtml).join('  '));
        toast('English formulas copied');
      },
    }, 'Copy formulas'),
  );

  const englishPane = el('div', { class: 'pane' },
    el('div', { class: 'pane-title' }, `${title} — English`),
    htmlBlock(englishHtml),
    ...englishExtra,
    copyImages.length ? imagesBlock(copyImages, null) : null,
  );
  const transPane = el('div', { class: 'pane' },
    el('div', { class: 'pane-title' }, el('span', {}, `${title} — ${L.label}`), toolbar),
    source,
    editable,
    warn,
    el('div', { class: 'preview-label' }, 'Preview'),
    preview,
    copyImages.length ? el('div', { class: 'field-src' }, 'Images that will be attached to this step:') : null,
    imagesBlock(copyImages, choices),
  );

  const field = {
    englishHtml,
    copyImages,
    choices,
    getValue: () => sanitizeHtml(editable.innerHTML).trim(),
    setValue(html, label) {
      editable.innerHTML = sanitizeHtml(html);
      source.textContent = label ?? '';
      updatePreview();
    },
    setLoading(text) { editable.innerHTML = ''; source.textContent = text; source.classList.toggle('loading', !!text); },
    setImageChoices(saved) {
      saved?.forEach((v, i) => {
        if (choices.inputs[i]) {
          choices[i] = v;
          choices.inputs[i].checked = v;
          choices.inputs[i].closest('figure').classList.toggle('off', !v);
        }
      });
    },
    focus: () => editable.focus(),
  };
  editor.fields.push(field);
  return el('div', { class: 'pair' }, englishPane, transPane);
}

function markDirty() {
  editor.dirty = true;
  clearTimeout(editor.saveTimer);
  editor.saveTimer = setTimeout(saveDraft, 800);
}

async function saveDraft() {
  clearTimeout(editor.saveTimer);
  if (editor.id == null || !editor.dirty) return;
  const [qf, ...steps] = editor.fields;
  await store.set(draftKey(editor.id, state.queue.language), {
    questionHtml: qf.getValue(),
    stepsHtml: steps.map((f) => f.getValue()),
    imageChoices: steps.map((f) => [...f.choices]),
    savedAt: Date.now(),
  });
  const item = state.queue.items[editor.id];
  if (item.progress === 'todo') { item.progress = 'draft'; await saveQueue(); }
  editor.dirty = false;
}

function validate() {
  const problems = [];
  const [qf, ...steps] = editor.fields;
  if (!plainText(qf.getValue())) problems.push('The question translation is empty.');
  steps.forEach((f, i) => {
    if (plainText(f.englishHtml) && !plainText(f.getValue())) problems.push(`Solution step ${i + 1} is empty.`);
  });
  const mathIssues = editor.fields.filter((f) => !compareMath(f.englishHtml, f.getValue()).ok).length;
  return { problems, mathIssues };
}

async function submitCurrent() {
  if (editor.busy || editor.id == null) return;
  const { problems, mathIssues } = validate();
  if (problems.length) { showNotice(problems.join(' '), 'err'); return; }
  if (mathIssues && !confirm(`${mathIssues} field(s) have formulas that differ from the English. Send for review anyway?`)) return;

  editor.busy = true;
  const btn = $('#btn-submit');
  btn.disabled = true;
  const id = editor.id;
  const language = state.queue.language;
  const item = state.queue.items[id];
  try {
    const [qf, ...steps] = editor.fields;
    const stepPayload = [];
    for (const f of steps) {
      const files = [];
      for (let i = 0; i < f.copyImages.length; i++) if (f.choices[i]) files.push(await imageFile(f.copyImages[i]));
      stepPayload.push({ html: f.getValue(), images: files });
    }
    const form = () => buildSubmitForm(language, qf.getValue(), stepPayload);
    await withSession(() => state.client.submitTranslation(id, form()));

    // Learn from what the teacher finalised.
    const pairs = [[qf.englishHtml, qf.getValue()], ...steps.map((f) => [f.englishHtml, f.getValue()])];
    for (const [en, tr] of pairs) {
      try {
        if (plainText(en) && plainText(tr)) state.memory[memoryKey(language, en)] = memoryValue(en, tr);
      } catch { /* formulas changed; don't store */ }
    }
    await store.set(`tm:${language}`, state.memory);

    // Verify the portal now shows it as pending review.
    const fresh = await loadQuestion(id, true).catch(() => null);
    const st = fresh && !fresh.error ? translationStatus(fresh, language) : null;
    item.progress = 'submitted';
    item.message = st === 'pending_review' ? 'pending_review (verified)' : `sent; portal status: ${st ?? 'unknown'}`;
    await store.remove(draftKey(id, language));
    editor.dirty = false;
    await saveQueue();
    toast(st === 'pending_review' ? `Question ${id} sent for review ✓` : `Question ${id} sent (portal shows "${st}")`);
    goNext();
  } catch (e) {
    item.progress = 'failed';
    item.message = e.message;
    await saveQueue();
    showNotice(`Could not send question ${id}: ${e.message} — your draft is saved; try again.`, 'err');
  } finally {
    editor.busy = false;
    btn.disabled = false;
  }
}

function goNext() {
  let i = nextWorkable(editor.index + 1);
  if (i === -1) i = nextWorkable(0);
  if (i === -1) {
    editor.id = null;
    toast('All questions in this list are done.');
    openQueue();
  } else {
    openEditor(i);
  }
}

$('#btn-submit').addEventListener('click', submitCurrent);
$('#btn-skip').addEventListener('click', async () => {
  await saveDraft();
  const item = state.queue.items[editor.id];
  if (item.progress !== 'submitted') item.progress = 'skipped';
  await saveQueue();
  goNext();
});
$('#btn-prev').addEventListener('click', async () => {
  for (let i = editor.index - 1; i >= 0; i--) if (workableIndex(i)) return openEditor(i);
  toast('No earlier question to edit.');
});
$('#btn-back').addEventListener('click', async () => {
  await saveDraft();
  editor.id = null;
  openQueue();
});
$('#btn-regen').addEventListener('click', async () => {
  if (!state.settings.aiEnabled) { toast('AI suggestions are turned off in Settings.'); return; }
  if (editor.dirty && !confirm('Replace your edits with a new AI suggestion?')) return;
  const id = editor.id;
  state.aiJobs.delete(`${state.queue.language}:${id}`);
  await store.remove(draftKey(id, state.queue.language));
  const job = suggestion(id, { useMemory: false });
  editor.fields.forEach((f) => f.setLoading('Preparing AI suggestion…'));
  const r = await job;
  if (editor.id !== id) return;
  fillEditors(r.questionHtml, r.stepsHtml, 'AI suggestion — please check');
  if (r.error) showNotice(`AI suggestion unavailable: ${r.error}`, 'warn');
});

document.addEventListener('keydown', (ev) => {
  if ($('#view-editor').hidden) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); submitCurrent(); }
});
window.addEventListener('beforeunload', () => { saveDraft(); });

// ---------------------------------------------------------------- settings
$('#btn-settings').addEventListener('click', () => {
  const f = $('#settings-form');
  f.aiEnabled.checked = !!state.settings.aiEnabled;
  f.apiKey.value = state.settings.apiKey ?? '';
  f.model.value = state.settings.model ?? DEFAULT_MODEL;
  f.glossary.value = state.settings.glossary ?? '';
  $('#tm-count').textContent = `Translation memory (${lang().label}): ${Object.keys(state.memory).length} saved sentences.`;
  $('#dlg-settings').showModal();
});
$('#dlg-settings').addEventListener('close', async () => {
  if ($('#dlg-settings').returnValue !== 'save') return;
  const f = $('#settings-form');
  Object.assign(state.settings, {
    aiEnabled: f.aiEnabled.checked,
    apiKey: f.apiKey.value.trim(),
    model: f.model.value.trim() || DEFAULT_MODEL,
    glossary: f.glossary.value,
  });
  await store.set('settings', state.settings);
  state.aiJobs.clear();
  toast('Settings saved');
});
$('#btn-clear-tm').addEventListener('click', async () => {
  if (!confirm('Delete all saved sentences for this language?')) return;
  state.memory = {};
  await store.set(`tm:${lang().key}`, {});
  $('#tm-count').textContent = 'Translation memory cleared.';
});

// ---------------------------------------------------------------- boot
async function loadDefaults() {
  try {
    const res = await fetch(chrome.runtime.getURL('config.json'));
    return await res.json();
  } catch {
    return {};
  }
}

(async function boot() {
  const defaults = await loadDefaults();
  delete defaults._comment;
  state.settings = { language: 'urdu', aiEnabled: true, apiKey: '', model: DEFAULT_MODEL, glossary: '', ...defaults, ...(await store.get('settings', {})) };
  state.memory = await store.get(`tm:${state.settings.language}`, {});
  const auth = await store.get('auth');
  if (!auth) { show('login'); return; }
  await setAuth(auth);
  try {
    await state.client.me();
  } catch (e) {
    if (e instanceof SessionExpiredError) { await setAuth(null); show('login'); return; }
  }
  await openSetup();
})();
