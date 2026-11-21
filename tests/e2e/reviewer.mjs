// End-to-end check of reviewer mode against the live portal.
// Reads are real. Approve / send-back calls are intercepted (nothing is reviewed),
// every other write is blocked.
//
//   REVIEWER_EMAIL=... REVIEWER_PASSWORD=... node tests/e2e/reviewer.mjs
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const XLSX = require('xlsx');

const email = process.env.REVIEWER_EMAIL;
const password = process.env.REVIEWER_PASSWORD;
const GROUP = process.env.TEST_GROUP || 'Muhammad Saffi Ullah';
if (!email || !password) throw new Error('Set REVIEWER_EMAIL and REVIEWER_PASSWORD');

const extPath = path.resolve('extension');
const outDir = path.resolve('tests/e2e/out');
const profile = path.resolve('tests/e2e/.profile-reviewer');
rmSync(profile, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const ctx = await chromium.launchPersistentContext(profile, {
  headless: true, channel: 'chromium', viewport: { width: 1400, height: 1000 }, acceptDownloads: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

const reviews = [];
await ctx.route('**/*', async (route) => {
  const req = route.request();
  const url = req.url();
  if (/\/api\/question-translations\/\d+\/review$/.test(url)) {
    reviews.push({ url, body: JSON.parse(req.postData()) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":true,"message":"Translation reviewed."}' });
  }
  if (url.includes('virtual.sundarstem.edu.pk/api/') && req.method() !== 'GET' && !url.endsWith('/api/login')) {
    console.error('BLOCKED unexpected write:', req.method(), url);
    return route.abort();
  }
  return route.continue();
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`chrome-extension://${new URL(sw.url()).host}/app.html`);

// 1. Login → reviewer dashboard
await page.fill('#login-form [name=identifier]', email);
await page.fill('#login-form [name=password]', password);
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#view-reviewer:not([hidden])', { timeout: 30000 });
await page.waitForSelector('#rv-stats .stat', { timeout: 30000 });
console.log('stats:', (await page.$$eval('#rv-stats .stat', (s) => s.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | '));

// 2. Progress of assigned units
await page.click('#rv-load-progress');
await page.waitForFunction(() => /assigned units ·/.test(document.querySelector('#rv-progress-status').textContent), null, { timeout: 240000 });
const totalRow = await page.$eval('#rv-progress tbody tr:last-child', (r) => r.innerText.replace(/\s+/g, ' '));
console.log('progress, all teachers:', totalRow);
assert.match(totalRow, /All teachers 2,?458|All teachers 24\d\d/);
await page.screenshot({ path: `${outDir}/r1-dashboard.png`, fullPage: true });

// 3. Review queue grouped by translator
await page.click('[data-rtab=review]');
await page.click('#rv-load-queue');
await page.waitForSelector('#rv-groups .group-item', { timeout: 240000 });
console.log('queue:', await page.textContent('#rv-queue-status'));
const groups = await page.$$eval('#rv-groups .group-item', (g) => g.map((x) => x.innerText.replace(/\s+/g, ' ')));
console.log('groups:', groups.join(' | '));
await page.screenshot({ path: `${outDir}/r2-groups.png` });
await page.locator('#rv-groups .group-item', { hasText: GROUP }).first().click();
await page.waitForSelector('#view-review:not([hidden])');
await page.waitForTimeout(1500);
console.log('flags:', await page.$$eval('#rv-flags .flag', (f) => f.map((x) => x.textContent)));
await page.screenshot({ path: `${outDir}/r3-review.png`, fullPage: true });

// 4. Approve with Ctrl+Enter
const firstId = await page.textContent('#rv-id');
await page.keyboard.press('Control+Enter');
await page.waitForFunction((id) => document.querySelector('#rv-id').textContent !== id || !document.querySelector('#view-reviewer').hidden, firstId, { timeout: 15000 });
assert.deepEqual(reviews[0].body, { status: 'approved' });
console.log('approve sent to', reviews[0].url);

// 5. Send back with a reason (Ctrl+Shift+Enter, pick a reason, Ctrl+Enter)
if (!(await page.isHidden('#view-review'))) {
  await page.keyboard.press('Control+Shift+Enter');
  await page.waitForSelector('#rv-sendback:not([hidden])');
  await page.locator('#rv-reasons .chip', { hasText: 'Formula missing' }).click();
  await page.screenshot({ path: `${outDir}/r4-sendback.png` });
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(1500);
  assert.equal(reviews[1].body.status, 'rejected');
  assert.match(reviews[1].body.rejection_comment, /Formula missing/);
  console.log('send back:', reviews[1].url, JSON.stringify(reviews[1].body));
}

// 6. Assignment builder: add a teacher, assign a unit, download Excel
if (!(await page.isHidden('#view-review'))) await page.click('#rv-back');
await page.waitForSelector('#view-reviewer:not([hidden])', { timeout: 15000 });
await page.click('[data-rtab=assign]');
await page.waitForSelector('#as-teachers .teacher-card');
await page.fill('#as-new-teacher', 'Test Teacher');
await page.click('#as-add-teacher');
await page.click('#as-find summary');
await page.click('#as-load-units');
await page.waitForSelector('#as-units tbody tr', { timeout: 240000 });
console.log('units:', await page.textContent('#as-units-status'));
const row = page.locator('#as-units tbody tr').filter({ has: page.locator('button') }).first();
const unitName = await row.locator('td').nth(2).textContent();
await row.locator('select').selectOption('Test Teacher');
await row.locator('button').click();
await page.screenshot({ path: `${outDir}/r5-assign.png`, fullPage: true });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#as-xlsx')]);
const file = path.join(outDir, await dl.suggestedFilename());
await dl.saveAs(file);
const rows = XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets['Translation Assignments'], { header: 1, defval: '' });
const testRows = rows.filter((r) => r[0] === 'Test Teacher');
console.log('excel:', path.basename(file), '| header:', rows[4].join(' / '), '| Test Teacher rows:', testRows);
assert.equal(testRows.length, 1);
assert.equal(testRows[0][4], unitName);

// 7. Teacher side: "Import sheet" with the downloaded file
await page.setInputFiles('#setup-import', file);
await page.waitForSelector('#view-setup:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/r6-import.png`, fullPage: true });
console.log('setup tab states:', await page.evaluate(() => ({ units: document.querySelector('#tab-units').hidden, ids: document.querySelector('#tab-ids').hidden, view: document.querySelector('#view-setup').hidden, teacherVisible: !!document.querySelector('#setup-teacher').offsetParent })));
await page.selectOption('#setup-teacher', 'Test Teacher');
const units = await page.$$eval('.unit-item', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
console.log('teacher view after import:', units);
assert.ok(units.some((u) => u.includes(unitName)));

console.log('page errors:', errors.length ? errors : 'none');
await ctx.close();
rmSync(profile, { recursive: true, force: true });
console.log('REVIEWER E2E OK');
