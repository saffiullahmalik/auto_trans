import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestionIds } from '../../extension/lib/ids.js';
import { protectMath, restoreMath, compareMath, extractMath } from '../../extension/lib/math.js';
import { memoryKey, memoryValue, applyMemory } from '../../extension/lib/memory.js';
import { buildSubmitForm, imageUrl, isTranslatable } from '../../extension/lib/portal.js';

test('parses a pasted spreadsheet column with header, blanks and duplicates', () => {
  const r = parseQuestionIds('Question ID\r\n7154\r\n7153\r\n\r\n7154\r\n#7152\r\nQ7146\r\n');
  assert.deepEqual(r.ids, [7154, 7153, 7152, 7146]);
  assert.deepEqual(r.duplicates, [7154]);
  assert.deepEqual(r.ignored, ['Question ID']);
});

test('parses comma, tab and space separated IDs', () => {
  assert.deepEqual(parseQuestionIds('1, 2\t3 4;5').ids, [1, 2, 3, 4, 5]);
});

test('protects and restores math exactly', () => {
  const html = '<p>The sum is $4{,}878$. Is it divisible by $3$ or $$9$$?</p>';
  const { text, math } = protectMath(html);
  assert.equal(text, '<p>The sum is ⟦M1⟧. Is it divisible by ⟦M2⟧ or ⟦M3⟧?</p>');
  assert.deepEqual(math, ['$4{,}878$', '$3$', '$$9$$']);
  const urdu = '<p>مجموعہ ⟦M1⟧ ہے۔ کیا یہ ⟦M2⟧ یا ⟦M3⟧ سے تقسیم ہوتا ہے؟</p>';
  assert.equal(restoreMath(urdu, math), '<p>مجموعہ $4{,}878$ ہے۔ کیا یہ $3$ یا $$9$$ سے تقسیم ہوتا ہے؟</p>');
});

test('restoreMath rejects dropped or duplicated formulas', () => {
  assert.throws(() => restoreMath('⟦M1⟧', ['$1$', '$2$']), /M2/);
  assert.throws(() => restoreMath('⟦M1⟧ ⟦M1⟧', ['$1$']), /2 times/);
  assert.throws(() => restoreMath('⟦M3⟧', ['$1$']), /Unknown/);
});

test('compareMath finds missing and extra formulas, ignoring spacing and order', () => {
  assert.equal(compareMath('$a+b$ and $5$', '$5$ اور $a + b$').ok, true);
  const r = compareMath('$5$ and $2$', '$5$ اور $3$');
  assert.deepEqual(r.missing, ['$2$']);
  assert.deepEqual(r.extra, ['$3$']);
  assert.deepEqual(extractMath('cost \\$5 only'), []);
});

test('translation memory reuses a sentence with different numbers', () => {
  const en1 = '<p>So, this shape has rotational symmetry of order $5$.</p>';
  const ur1 = '<p>لہٰذا، اس شکل کی گردشی تشاکل کی ترتیب $5$ ہے۔</p>';
  const en2 = '<p>So, this shape has rotational symmetry of order $2$.</p>';
  assert.equal(memoryKey('urdu', en1), memoryKey('urdu', en2));
  const stored = memoryValue(en1, ur1);
  assert.equal(applyMemory(en2, stored), '<p>لہٰذا، اس شکل کی گردشی تشاکل کی ترتیب $2$ ہے۔</p>');
  assert.notEqual(memoryKey('urdu', en1), memoryKey('sindhi', en1));
});

test('builds the same multipart body as the portal translator form', async () => {
  const img = new File([new Uint8Array([1, 2, 3])], 'step.png', { type: 'image/png' });
  const form = buildSubmitForm('urdu', '<p>سوال</p>', [
    { html: '<p>قدم ۱</p>', images: [img] },
    { html: '<p>قدم ۲</p>', images: [] },
  ]);
  const entries = [...form.entries()].map(([k, v]) => [k, v instanceof File ? `file:${v.name}` : v]);
  assert.deepEqual(entries, [
    ['pending_for_urdu_translation_review', 'true'],
    ['translation_statuses[urdu]', 'pending_review'],
    ['question_text_urdu', '<p>سوال</p>'],
    ['solution_steps_urdu[0][explanation]', '<p>قدم ۱</p>'],
    ['solution_steps_urdu[0][images][]', 'file:step.png'],
    ['solution_steps_urdu[1][explanation]', '<p>قدم ۲</p>'],
    ['solution_steps_urdu[1][images]', ''],
  ]);
  const sd = [...buildSubmitForm('sindhi', 'x', []).keys()];
  assert.deepEqual(sd, ['pending_for_sindhi_translation_review', 'translation_statuses[sindhi]', 'question_text_sindhi']);
});

test('image URLs and translatable statuses', () => {
  assert.equal(imageUrl('uploads/solution_images/a.png'), 'https://virtual.sundarstem.edu.pk/storage/uploads/solution_images/a.png');
  assert.equal(isTranslatable('pending_translation'), true);
  assert.equal(isTranslatable('rejected'), true);
  assert.equal(isTranslatable('pending_review'), false);
  assert.equal(isTranslatable('approved'), false);
});
