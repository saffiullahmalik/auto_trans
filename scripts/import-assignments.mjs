// Convert the coordinator's assignment sheet into extension/assignments.json
// (the copy built into the extension; teachers can also "Import sheet" in the app).
//   npm run assignments -- "Urdu_Translation_Teacher_Assignments.xlsx" [urdu|sindhi]
import XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
import { parseAssignmentRows } from '../extension/lib/assign-sheet.js';

const [file, language = 'urdu'] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run assignments -- <sheet.xlsx> [urdu|sindhi]');
  process.exit(1);
}
const wb = XLSX.readFile(file);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
const { title, teachers } = parseAssignmentRows(rows);
const out = {
  title: title || 'Teacher assignments',
  language,
  generatedFrom: file.split(/[\\/]/).pop().replace(/^[0-9a-f]{8}-/, ''),
  teachers,
};
writeFileSync('extension/assignments.json', JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote extension/assignments.json: ${teachers.length} teachers, ${teachers.reduce((n, t) => n + t.units.length, 0)} units.`);
