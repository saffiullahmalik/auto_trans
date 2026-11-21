// Convert the coordinator's assignment sheet into extension/assignments.json.
//   npm run assignments -- "Urdu_Translation_Teacher_Assignments.xlsx" [urdu|sindhi]
// Expects a header row with: Teacher Name | Translation Status | Subject | Class | Unit Name | Unit Questions
import XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';

const [file, language = 'urdu'] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run assignments -- <sheet.xlsx> [urdu|sindhi]');
  process.exit(1);
}

const wb = XLSX.readFile(file);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

// Locate the header row and its columns.
let header = -1;
let cols = {};
rows.forEach((row, n) => {
  if (header !== -1) return;
  const cells = row.map((c) => String(c).trim().toLowerCase());
  const find = (...names) => cells.findIndex((c) => names.includes(c));
  if (find('teacher name', 'teacher') !== -1 && find('unit name', 'unit', 'chapter name', 'chapter') !== -1) {
    header = n;
    cols = {
      teacher: find('teacher name', 'teacher'),
      subject: find('subject'),
      grade: find('class', 'grade'),
      unit: find('unit name', 'unit', 'chapter name', 'chapter'),
      count: find('unit questions', 'questions', 'question count'),
    };
  }
});
if (header === -1) throw new Error('Could not find a header row with "Teacher Name" and "Unit Name" columns.');

const teachers = new Map();
rows.slice(header + 1).forEach((row) => {
  const get = (k) => (cols[k] >= 0 ? String(row[cols[k]] ?? '').trim() : '');
  const name = get('teacher');
  const unit = get('unit');
  if (!name || !unit) return;
  const count = Number.parseInt(get('count'), 10);
  if (!teachers.has(name)) teachers.set(name, { name, units: [] });
  teachers.get(name).units.push({
    subject: get('subject'),
    grade: get('grade'),
    unit,
    count: Number.isFinite(count) ? count : null,
  });
});

const out = {
  title: String(rows.find((r) => String(r[0]).trim())?.[0] ?? '').trim() || 'Teacher assignments',
  language,
  generatedFrom: file.split(/[\\/]/).pop().replace(/^[0-9a-f]{8}-/, ''),
  teachers: [...teachers.values()],
};
writeFileSync('extension/assignments.json', JSON.stringify(out, null, 2) + '\n');
const units = out.teachers.reduce((n, t) => n + t.units.length, 0);
console.log(`Wrote extension/assignments.json: ${out.teachers.length} teachers, ${units} units.`);
