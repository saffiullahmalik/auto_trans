import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiTranslate } from '../../extension/lib/gemini.js';
import { googleTranslate } from '../../extension/lib/google-translate.js';

const question = {
  html: '<p>What is the order of rotational symmetry of the letter $S$?</p>',
  steps: ['<p>It can be turned $2$ ways.</p>', '<p>So the order is $2$.</p>'],
  grade: '4', subject: 'Basic Mathematics Practice 4', topic: 'Rotational Symmetry',
};

// Fake translation: swaps English words, leaves tags and ⟦M#⟧ tokens alone (as the real services do).
const fakeUrdu = (s) => s.split(/(⟦M\d+⟧|<[^>]+>)/).map((part, i) => (i % 2 ? part : part.replace(/[A-Za-z]+/g, 'ت'))).join('');

const fakeFetch = (handler) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const { status = 200, json } = handler(url, JSON.parse(init.body));
    return { ok: status < 400, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
};

test('Gemini: sends tokens instead of LaTeX, asks for JSON, restores math', async () => {
  const fetch = fakeFetch((url, body) => {
    const input = JSON.parse(body.contents[0].parts[0].text);
    const out = { question_html: fakeUrdu(input.question_html), steps_html: input.steps_html.map(fakeUrdu) };
    return { json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(out) }] } }] } };
  });
  const r = await geminiTranslate({ apiKey: 'AIza-test', model: 'gemini-2.5-flash', language: 'urdu', glossary: 'order = ترتیب', question }, fetch);
  const call = fetch.calls[0];
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(call.init.headers['x-goog-api-key'], 'AIza-test');
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(!call.body.contents[0].parts[0].text.includes('$'), 'no raw LaTeX sent');
  assert.match(call.body.systemInstruction.parts[0].text, /Urdu/);
  assert.match(call.body.systemInstruction.parts[0].text, /order = ترتیب/);
  assert.match(r.questionHtml, /\$S\$/);
  assert.equal(r.stepsHtml.length, 2);
  assert.match(r.stepsHtml[1], /\$2\$/);
});

test('Gemini: reports API errors, blocks and wrong step counts clearly', async () => {
  const err = fakeFetch(() => ({ status: 400, json: { error: { message: 'API key not valid.' } } }));
  await assert.rejects(geminiTranslate({ apiKey: 'x', language: 'urdu', question }, err), /API key not valid/);
  const blocked = fakeFetch(() => ({ json: { promptFeedback: { blockReason: 'SAFETY' } } }));
  await assert.rejects(geminiTranslate({ apiKey: 'x', language: 'urdu', question }, blocked), /declined/);
  const short = fakeFetch(() => ({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"question_html":"⟦M1⟧","steps_html":["⟦M1⟧"]}' }] } }] } }));
  await assert.rejects(geminiTranslate({ apiKey: 'x', language: 'urdu', question }, short), /1 steps instead of 2/);
  await assert.rejects(geminiTranslate({ apiKey: '', language: 'urdu', question }, short), /No Gemini API key/);
});

test('Google Translate: HTML mode, math shielded with translate="no", Sindhi code', async () => {
  const fetch = fakeFetch((url, body) => ({
    json: { data: { translations: body.q.map((t) => ({ translatedText: fakeUrdu(t) })) } },
  }));
  const r = await googleTranslate({ apiKey: 'AIza-test', language: 'sindhi', question }, fetch);
  const call = fetch.calls[0];
  assert.equal(call.url, 'https://translation.googleapis.com/language/translate/v2');
  assert.equal(call.body.target, 'sd');
  assert.equal(call.body.format, 'html');
  assert.equal(call.body.q.length, 3);
  assert.match(call.body.q[0], /<span translate="no">⟦M1⟧<\/span>/);
  assert.match(r.questionHtml, /\$S\$/);
  assert.ok(!r.questionHtml.includes('translate="no"'));
  assert.match(r.stepsHtml[0], /\$2\$/);
});

test('Google Translate: a formula lost in translation is caught', async () => {
  const fetch = fakeFetch((url, body) => ({ json: { data: { translations: body.q.map(() => ({ translatedText: '<p>بغیر فارمولا</p>' })) } } }));
  await assert.rejects(googleTranslate({ apiKey: 'k', language: 'urdu', question }, fetch), /M1/);
});

test('Gemini: retries when Google is busy, uses low thinking on Gemini 3', async () => {
  let n = 0;
  const fetch = fakeFetch((url, body) => {
    n++;
    if (n === 1) return { status: 503, json: { error: { message: 'high demand' } } };
    const input = JSON.parse(body.contents[0].parts[0].text);
    return { json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ question_html: fakeUrdu(input.question_html), steps_html: input.steps_html.map(fakeUrdu) }) }] } }] } };
  });
  const r = await geminiTranslate({ apiKey: 'k', model: 'gemini-3.8-flash', language: 'urdu', question }, fetch);
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(fetch.calls[1].body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.match(r.questionHtml, /\$S\$/);
});
