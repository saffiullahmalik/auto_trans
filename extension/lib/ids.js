// Parse a pasted block of question IDs (e.g. a whole spreadsheet column).
// Accepts newlines, commas, tabs, spaces or semicolons as separators, and
// tokens like "7154", "#7154", "Q7154" or "ID: 7154". Header cells such as
// "Question ID" are reported as ignored instead of failing the whole paste.

export function parseQuestionIds(text) {
  const ids = [];
  const seen = new Set();
  const duplicates = [];
  const ignored = [];

  const tokens = String(text ?? '')
    .split(/[\r\n,;\t]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    // A cell may hold several numbers separated by spaces ("7154 7153").
    const numbers = token.match(/\d+/g);
    if (!numbers) {
      ignored.push(token);
      continue;
    }
    for (const n of numbers) {
      const id = Number.parseInt(n, 10);
      if (!Number.isSafeInteger(id) || id <= 0) {
        ignored.push(n);
        continue;
      }
      if (seen.has(id)) {
        duplicates.push(id);
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
  }

  return { ids, duplicates, ignored };
}
