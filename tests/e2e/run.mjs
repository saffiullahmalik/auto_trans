// End-to-end check of the unpacked extension against the real portal.
// Reads are real; the submit call is intercepted (nothing is sent to review),
// any other write is blocked, and the Claude API is faked.
//
//   TRANSLATOR_EMAIL=... TRANSLATOR_PASSWORD=... npm run e2e
// Note: logging in ends any other portal session of that account.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const email = process.env.TRANSLATOR_EMAIL;
const password = process.env.TRANSLATOR_PASSWORD;
const ids = (process.env.TEST_IDS || '7154,7146').split(',');
if (!email || !password) throw new Error('Set TRANSLATOR_EMAIL and TRANSLATOR_PASSWORD');

const extPath = path.resolve('extension');
const outDir = path.resolve('tests/e2e/out');
const profile = path.resolve('tests/e2e/.profile');
rmSync(profile, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: 'chromium',
  viewport: { width: 1400, height: 1000 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

const submits = [];
const aiCalls = [];
await ctx.route('**/*', async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.startsWith('https://api.anthropic.com/')) {
    const body = JSON.parse(req.postData());
    aiCalls.push(body);
    const input = JSON.parse(body.messages[0].content);
    // Fake "translation": keep tags and math tokens, swap words for a marker.
    const fake = (h) => h.replace(/>([^<]+)</g, (_, t) => `>ترجمہ ${(t.match(/⟦M\d+⟧/g) || []).join(' ')}<`);
    const out = { question_html: fake(input.question_html), steps_html: input.steps_html.map(fake) };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: JSON.stringify(out) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
      }),
    });
  }
  if (url.includes('/api/translator/questions/') && url.endsWith('/submit')) {
    submits.push({ url, contentType: req.headers()['content-type'], body: req.postDataBuffer() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":true,"message":"Translations submitted successfully."}' });
  }
  if (url.includes('virtual.sundarstem.edu.pk/api/') && req.method() !== 'GET' && !url.endsWith('/api/login')) {
    console.error('BLOCKED unexpected write:', req.method(), url);
    return route.abort();
  }
  return route.continue();
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`chrome-extension://${extId}/app.html`);

// Turn on AI with a dummy key (the API is faked above).
await page.evaluate(() => chrome.storage.local.set({ settings: { language: 'urdu', aiEnabled: true, apiKey: 'sk-ant-test', model: 'claude-opus-5-5', glossary: '' } }));
await page.reload();

// 1. Login
await page.fill('#login-form [name=identifier]', email);
await page.fill('#login-form [name=password]', password);
await page.screenshot({ path: `${outDir}/1-login.png` });
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#view-setup:not([hidden])', { timeout: 30000 });

// 2. Paste a whole column (header, duplicate, unknown id)
await page.fill('#setup-ids', ['Question ID', ...ids, ids[0], '99999999'].join('\n'));
const parse = await page.textContent('#setup-parse');
console.log('parse preview:', parse);
assert.match(parse, new RegExp(`${ids.length + 1} question IDs found`));
await page.screenshot({ path: `${outDir}/2-setup.png` });
await page.click('#btn-load');
await page.waitForFunction(() => !document.querySelector('#queue-summary').textContent.includes('Loading') && document.querySelectorAll('#queue-body tr').length > 0 && ![...document.querySelectorAll('#queue-body .pill')].some((p) => p.textContent === 'Loading…'), null, { timeout: 60000 });
await page.screenshot({ path: `${outDir}/3-queue.png`, fullPage: true });
console.log('queue summary:', await page.textContent('#queue-summary'));

// 3. Translate the first question
await page.click('#btn-start');
await page.waitForSelector('#view-editor:not([hidden])');
await page.waitForFunction(() => document.querySelector('.editable')?.textContent.includes('ترجمہ'), null, { timeout: 30000 });
await page.waitForTimeout(1500); // let images load for the screenshot
await page.screenshot({ path: `${outDir}/4-editor.png`, fullPage: true });
const firstId = (await page.textContent('#ed-id')).replace('ID ', '');

// Teacher edits the question text.
const first = page.locator('.editable').first();
await first.click();
await page.keyboard.press('End');
await page.keyboard.type(' (استاد کی ترمیم)');
await page.keyboard.press('Control+Enter');
await page.waitForFunction((id) => document.querySelector('#ed-id')?.textContent !== `ID ${id}` || !document.querySelector('#view-queue').hidden, firstId, { timeout: 30000 });

assert.equal(submits.length, 1, 'one submit captured');
const s = submits[0];
const form = await new Response(s.body, { headers: { 'content-type': s.contentType } }).formData();
const fields = [...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 120) : `FILE ${v.name} ${v.type} ${v.size}b`]);
console.log('submitted to', s.url);
for (const f of fields) console.log('  ', f[0], '=>', f[1]);
assert.equal(form.get('pending_for_urdu_translation_review'), 'true');
assert.equal(form.get('translation_statuses[urdu]'), 'pending_review');
assert.match(form.get('question_text_urdu'), /استاد کی ترمیم/);
assert.ok(fields.some(([k, v]) => k.endsWith('[images][]') && v.startsWith('FILE ')), 'step image re-uploaded');

// The AI request kept math out of the model's reach.
assert.ok(aiCalls.length >= 1);
assert.ok(!aiCalls[0].messages[0].content.includes('$'), 'no raw LaTeX sent to AI');
console.log('AI request: model', aiCalls[0].model, '| fallbacks', aiCalls[0].fallbacks, '| effort', aiCalls[0].output_config?.effort);

await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/5-after-submit.png`, fullPage: false });
await page.click('#btn-back');
await page.waitForSelector('#view-queue:not([hidden])');
await page.screenshot({ path: `${outDir}/6-queue-after.png`, fullPage: true });
console.log('queue summary after:', await page.textContent('#queue-summary'));

console.log('page errors:', errors.length ? errors : 'none');
await ctx.close();
rmSync(profile, { recursive: true, force: true });
console.log('E2E OK');
