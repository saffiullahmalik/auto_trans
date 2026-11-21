// Read and write the coordinator's teacher-assignment sheet (same layout as
// "Urdu_Translation_Teacher_Assignments.xlsx"). Works on plain 2-D arrays so it
// can be used from the extension (with SheetJS) and from Node scripts.

export const HEADER = ['Teacher Name', 'Translation Status', 'Subject', 'Class', 'Unit Name', 'Unit Questions'];

const LANG_LABEL = { urdu: 'Urdu', sindhi: 'Sindhi' };

const norm = (c) => String(c ?? '').trim().toLowerCase();

/** rows: array of arrays (cells). Returns { title, teachers: [{ name, units: [{subject, grade, unit, count}] }] }. */
export function parseAssignmentRows(rows) {
  let header = -1;
  let cols = {};
  rows.forEach((row, n) => {
    if (header !== -1) return;
    const cells = (row ?? []).map(norm);
    const find = (...names) => cells.findIndex((c) => names.includes(c));
    if (find('teacher name', 'teacher') !== -1 && find('unit name', 'unit', 'chapter name', 'chapter') !== -1) {
      header = n;
      cols = {
        teacher: find('teacher name', 'teacher'),
        subject: find('subject', 'book'),
        grade: find('class', 'grade'),
        unit: find('unit name', 'unit', 'chapter name', 'chapter'),
        count: find('unit questions', 'questions', 'question count'),
      };
    }
  });
  if (header === -1) throw new Error('No header row with "Teacher Name" and "Unit Name" columns was found.');

  const teachers = new Map();
  for (const row of rows.slice(header + 1)) {
    const get = (k) => (cols[k] >= 0 ? String(row?.[cols[k]] ?? '').trim() : '');
    const name = get('teacher');
    const unit = get('unit');
    if (!name || !unit) continue;
    const count = Number.parseInt(get('count'), 10);
    if (!teachers.has(name)) teachers.set(name, { name, units: [] });
    teachers.get(name).units.push({
      subject: get('subject'),
      grade: get('grade').replace(/^(grade|class)\s*/i, ''),
      unit,
      count: Number.isFinite(count) ? count : null,
    });
  }
  const title = String(rows.find((r) => String(r?.[0] ?? '').trim())?.[0] ?? '').trim();
  return { title: header > 0 ? title : '', teachers: [...teachers.values()] };
}

/** Build the sheet rows: title, summary line, header, one row per teacher-unit, and instructions. */
export function buildAssignmentRows({ title, language = 'urdu', teachers }) {
  const label = LANG_LABEL[language] ?? language;
  const rows = teachers.flatMap((t) => t.units.map((u) => [
    t.name, `Pending for ${label} translation`, u.subject, Number(u.grade) || u.grade, u.unit, u.count ?? '',
  ]));
  const unitCount = rows.length;
  const questions = rows.reduce((n, r) => n + (Number(r[5]) || 0), 0);
  const perTeacher = teachers.length ? Math.round((unitCount / teachers.length) * 10) / 10 : 0;
  return [
    [],
    [title || `${label} Translation — Teacher Assignments`],
    [`${unitCount} units  |  ${questions.toLocaleString('en-US')} questions  |  ${teachers.length} teachers  |  ${perTeacher} units per teacher`],
    [],
    HEADER,
    ...rows,
    [],
    [],
    ['How to find and translate your assigned questions'],
    [],
    ['1. Open the SundarSTEM Translation Assistant extension and log in with your translator account.'],
    ['2. On "Assigned units", click "Import sheet" and choose this file (only needed when you receive a new sheet).'],
    ['3. Choose your name, keep the units you want to work on ticked, and press "Load questions".'],
    [`4. Check each ${label} suggestion, correct it, and press Ctrl+Enter to send it for review.`],
    ['Without the extension: in the portal question bank set Translation Status, Subject, Class (the number, e.g. 4) and the exact Unit Name shown above.'],
  ];
}

export function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => (r ?? []).map(cell).join(',')).join('\r\n');
}

/** Minimal CSV parser (quotes, commas, CRLF) for imported .csv sheets. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
