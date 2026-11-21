import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewFlags, reviewContent, submitReview } from '../../extension/lib/review.js';
import { parseAssignmentRows, buildAssignmentRows, toCsv, parseCsv } from '../../extension/lib/assign-sheet.js';

// Shaped like question 8329 as the reviewer API returns it: the Urdu step lost $8$.
const q8329 = {
  id: 8329,
  question_text: '<p>What is the order of Rotational Symmetry of the following shape.</p>',
  solution_steps: [{ explanation: '<p>So the order of rotational symmetry is $8$.</p>', images: ['uploads/solution_images/a.png'] }],
  translations: [{
    id: 6147, language: 'urdu', status: 'pending_review',
    translated_text: 'دی گئی شکل کے گردشی تناسب (Rotational Symmetry) کا درجہ کیا ہے؟',
    translated_solution_steps: [{ explanation: 'لہٰذا، گردشی تناسب کا درجہ 8 ہے۔', images: ['uploads/solution_step_images/b.png'] }],
    translator: { name: 'Muhammad Saffi Ullah' },
  }],
};

test('a number kept without $…$ is a warning; a gloss in brackets is fine', () => {
  const flags = reviewFlags(q8329, 'urdu');
  assert.ok(flags.some((f) => f.level === 'warn' && f.text === 'Step 1: 1 number not formatted as math (8)'), JSON.stringify(flags));
  assert.ok(!flags.some((f) => f.level === 'error'), JSON.stringify(flags));
  assert.ok(!flags.some((f) => /English words/.test(f.text)), 'a "(Rotational Symmetry)" gloss is fine');
  assert.ok(!flags.some((f) => /image/.test(f.text)), 'image present');
});

test('review flags: missing image, missing step, lost bold, untranslated words', () => {
  const q = {
    question_text: '<p><strong>Find</strong> $x$.</p>',
    solution_steps: [{ explanation: '<p>Step one $1$</p>', images: ['i.png'] }, { explanation: '<p>Step two</p>', images: [] }],
    translations: [{ id: 1, language: 'urdu', status: 'pending_review', translated_text: '<p>Find the value of $x$ معلوم کریں</p>', translated_solution_steps: [{ explanation: '<p>قدم $1$</p>', images: [] }] }],
  };
  const texts = reviewFlags(q, 'urdu').map((f) => f.text).join(' | ');
  assert.match(texts, /Only 1 of 2 solution steps/);
  assert.match(texts, /Step 1: 1 image missing/);
  assert.match(texts, /Question: bold formatting lost/);
  assert.match(texts, /Question: English words left/);
});

test('translated units inside \\text{} are fine; numbers really missing are an error', () => {
  const q = {
    question_text: '<p>A rope is $8\\text{ cm}$ long. Find $3x+2$.</p>',
    solution_steps: [],
    translations: [{ id: 2, language: 'urdu', status: 'pending_review', translated_text: '<p>رسی $8\\text{ سینٹی میٹر}$ لمبی ہے۔ معلوم کریں۔</p>', translated_solution_steps: [] }],
  };
  const flags = reviewFlags(q, 'urdu');
  assert.deepEqual(flags.map((f) => [f.level, f.text]), [['error', 'Question: numbers missing 3, 2']]);
});

test('reworded working with the same numbers is not flagged; a changed number is', () => {
  const q = {
    question_text: '<p>About how many centimeters are in $60$ inches?</p>',
    solution_steps: [{ explanation: '<p>$15+15=30$, so $60$ inches is about $150$ centimeters.</p>', images: [] }],
    translations: [{ id: 3, language: 'urdu', status: 'pending_review', translated_text: '<p>$60$ انچ میں کتنے سینٹی میٹر؟</p>',
      translated_solution_steps: [{ explanation: '<p>$15+15=30$ لہٰذا 60 انچ تقریباً $\\boxed{150\\text{ سینٹی میٹر}}$</p><p>$4{,}878$</p>', images: [] }] }],
  };
  const flags = reviewFlags(q, 'urdu').map((f) => f.text);
  assert.deepEqual(flags, ['Step 1: number not in English 4878', 'Step 1: 1 number not formatted as math (60)']);
});

test('clean translation has no flags; content comes from the pending translation', () => {
  const q = {
    question_text: '<p>Add $2$ and $3$.</p>',
    solution_steps: [{ explanation: '<p>$2+3=5$</p>', images: [] }],
    translations: [{ id: 9, language: 'urdu', status: 'pending_review', translated_text: '<p>$2$ اور $3$ جمع کریں۔</p>', translated_solution_steps: [{ explanation: '<p>$2+3=5$</p>', images: [] }] }],
  };
  assert.deepEqual(reviewFlags(q, 'urdu'), []);
  assert.equal(reviewContent(q, 'urdu').translation.id, 9);
});

test('approve and send back post the portal review payload', async () => {
  const calls = [];
  const client = { request: async (...a) => { calls.push(a); return { status: true }; } };
  await submitReview(client, 6147, true);
  await submitReview(client, 6147, false, 'Formula missing');
  assert.deepEqual(calls[0], ['POST', '/question-translations/6147/review', { status: 'approved' }]);
  assert.deepEqual(calls[1], ['POST', '/question-translations/6147/review', { status: 'rejected', rejection_comment: 'Formula missing' }]);
  assert.throws(() => submitReview(client, 1, false, '  '), /reason is required/);
});

test('assignment sheet: build → CSV → parse round trip keeps every row', () => {
  const original = JSON.parse(readFileSync(new URL('../../extension/assignments.json', import.meta.url)));
  const rows = buildAssignmentRows({ title: original.title, language: 'urdu', teachers: original.teachers });
  assert.deepEqual(rows[4], ['Teacher Name', 'Translation Status', 'Subject', 'Class', 'Unit Name', 'Unit Questions']);
  assert.match(rows[2][0], /24 units {2}\| {2}2,458 questions {2}\| {2}8 teachers/);
  const back = parseAssignmentRows(parseCsv(toCsv(rows)));
  assert.equal(back.title, original.title);
  assert.deepEqual(back.teachers, original.teachers);
});

test('assignment sheet: a bare CSV with just the header row also parses', () => {
  const rows = parseCsv('Teacher Name,Subject,Class,Unit Name,Unit Questions\r\nAli,"Basic Mathematics Practice 5",Grade 5,"Fractions ×, ÷",40\r\n');
  const { teachers } = parseAssignmentRows(rows);
  assert.deepEqual(teachers, [{ name: 'Ali', units: [{ subject: 'Basic Mathematics Practice 5', grade: '5', unit: 'Fractions ×, ÷', count: 40 }] }]);
});
