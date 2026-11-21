// Read an uploaded .xlsx/.csv assignment sheet, and download one.
import { read, write, utils } from './xlsx.bundle.js';
import { parseCsv, toCsv } from './assign-sheet.js';

export async function readSheetFile(file) {
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
  const wb = read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  return utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function downloadXlsx(rows, filename, sheetName = 'Translation Assignments') {
  const ws = utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 20 }, { wch: 28 }, { wch: 30 }, { wch: 7 }, { wch: 28 }, { wch: 15 }];
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const data = write(wb, { bookType: 'xlsx', type: 'array' });
  download(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export function downloadCsv(rows, filename) {
  download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv' }), filename);
}
