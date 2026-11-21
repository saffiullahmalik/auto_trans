import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCopyPrompt, parseAiAnswer, htmlToText, textToHtml } from '../../extension/lib/ai-prompt.js';

const q = {
  html: '<p><strong>Ayesha</strong> reads pages $25$ to $47$.</p><p>How many pages?</p>',
  steps: ['<p>Count $47-25+1=23$.</p>', '<p>So she read <strong>23 pages</strong>.</p><ol><li>first</li><li>second</li></ol>', ''],
  grade: '4', topic: 'Counting',
};

test('prompt lists the question and every step with markers, and keeps math', () => {
  const p = buildCopyPrompt(q, 'urdu', 'page = صفحہ');
  assert.match(p, /into Urdu for students in Pakistan \(Class 4\), topic: Counting/);
  assert.match(p, /Keep exactly 3 solution steps/);
  assert.match(p, /Always use these translations:\npage = صفحہ/);
  const english = p.split('— English to translate —')[1];
  assert.match(english, /### QUESTION\n\*\*Ayesha\*\* reads pages \$25\$ to \$47\$\.\n\nHow many pages\?/);
  assert.match(english, /### STEP 1\nCount \$47-25\+1=23\$\./);
  assert.match(english, /### STEP 2\nSo she read \*\*23 pages\*\*\.\n\n- first\n- second/);
  assert.match(english, /### STEP 3\n\(no text — this step is an image\)/);
  assert.match(buildCopyPrompt(q, 'sindhi'), /into Sindhi/);
});

test('parses a typical chat reply into question and steps', () => {
  const reply = [
    'Here is the translation:', '',
    '**### QUESTION**',
    '**عائشہ** صفحہ $25$ سے $47$ تک پڑھتی ہے۔', '',
    'کتنے صفحات؟', '',
    '### STEP 1', 'گنیں $47-25+1=23$۔', '',
    '### STEP 2', 'لہٰذا اس نے **23 صفحات** پڑھے۔', '- پہلا', '- دوسرا', '',
    '### STEP 3', 'تصویر دیکھیں۔',
  ].join('\n');
  const r = parseAiAnswer(reply, 3);
  assert.equal(r.questionHtml, '<p><strong>عائشہ</strong> صفحہ $25$ سے $47$ تک پڑھتی ہے۔</p><p>کتنے صفحات؟</p>');
  assert.equal(r.stepsHtml[0], '<p>گنیں $47-25+1=23$۔</p>');
  assert.equal(r.stepsHtml[1], '<p>لہٰذا اس نے <strong>23 صفحات</strong> پڑھے۔<br>- پہلا<br>- دوسرا</p>');
  assert.equal(r.stepsHtml[2], '<p>تصویر دیکھیں۔</p>');
  assert.deepEqual(r.warnings, []);
});

test('handles code fences, "Step 1:" style headings, missing and extra steps', () => {
  const r = parseAiAnswer('```\nQUESTION:\nسوال\n\nStep 1:\nقدم\n\n### STEP 4\nزائد\n```', 2);
  assert.equal(r.questionHtml, '<p>سوال</p>');
  assert.equal(r.stepsHtml[0], '<p>قدم</p>');
  assert.equal(r.stepsHtml[1], null);
  assert.match(r.warnings.join(' '), /step 4, but this question has only 2 steps/);
  assert.match(r.warnings.join(' '), /missing step 2/);
});

test('a reply without markers goes into the question box with a warning', () => {
  const r = parseAiAnswer('صرف ترجمہ', 1);
  assert.equal(r.questionHtml, '<p>صرف ترجمہ</p>');
  assert.match(r.warnings[0], /no "### QUESTION/);
  assert.deepEqual(parseAiAnswer('صرف ترجمہ', 0).warnings, []);
});

test('if the AI echoes the English part back, it is ignored', () => {
  const reply = '### QUESTION\nسوال\n\n### STEP 1\nقدم\n\n— English to translate —\n\n### QUESTION\nEnglish\n\n### STEP 1\nEnglish step';
  const r = parseAiAnswer(reply, 1);
  assert.equal(r.questionHtml, '<p>سوال</p>');
  assert.equal(r.stepsHtml[0], '<p>قدم</p>');
});

test('html/text conversion', () => {
  assert.equal(htmlToText('<p>a &amp; b<br>c</p><ul><li>x</li></ul>'), 'a & b\nc\n\n- x');
  assert.equal(textToHtml('- x\n- y'), '<ul><li>x</li><li>y</li></ul>');
  assert.equal(textToHtml('1. x\n2. y'), '<ol><li>x</li><li>y</li></ol>');
  assert.equal(textToHtml('<p>already html</p>'), '<p>already html</p>');
  assert.equal(textToHtml('a < b'), '<p>a &lt; b</p>');
});
