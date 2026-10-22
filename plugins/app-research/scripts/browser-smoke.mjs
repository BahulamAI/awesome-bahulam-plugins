import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const arg = flag => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const { chromium } = require(arg('--playwright') || process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'research-browser-'));
const screenshots = path.join(root, '.local', 'screenshots');
fs.mkdirSync(screenshots, { recursive: true });
const runtime = arg('--runtime');
const server = spawn(process.execPath, [runtime ? 'scripts/runtime-preview.mjs' : 'scripts/preview.mjs'], { cwd: root, env: { ...process.env, ...(runtime ? { BAHULAM_RUNTIME: runtime } : {}), PORT: '0', RESEARCH_PREVIEW_DATA: fixture, BRAVE_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let workspaceUrl;
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let log = '';
    const timeout = setTimeout(() => reject(new Error('Preview did not start')), 15000);
    server.stdout.on('data', data => { log += data; workspaceUrl = log.match(/Bahulam workspace: (http:\/\/\S+)/)?.[1]; const match = log.match(/Research preview: (http:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Preview exited ${code}`)); });
  });
  const executable = arg('--browser') || process.env.BROWSER_EXECUTABLE;
  browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.getByRole('heading', { name: 'Your research path' }).waitFor();
  await page.getByRole('heading', { name: 'Copy-ready agent prompts' }).waitFor();
  await page.getByText('Day 1 desk research identifies questions to investigate.').waitFor();
  await page.screenshot({ path: path.join(screenshots, 'start-here.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create idea' }).click();
  const idea = page.locator('#idea-form');
  await idea.locator('[name=name]').fill('Browser test idea');
  await idea.locator('[name=brief]').fill('Synthetic browser fixture used only to test the idea creation workflow.');
  await idea.locator('[name=audiences]').fill('People participating in the synthetic browser test');
  await idea.locator('[name=hypotheses]').fill('Saving a brief selects that idea in the workspace dropdown.');
  await idea.getByRole('button', { name: 'Save idea' }).click();
  await page.locator('#app-select').getByText('Browser test idea').waitFor({ state: 'attached' });
  assert.ok(await page.locator('#app-select').inputValue());
  console.log('Start page instructions and header-driven app idea creation verified.');
  await page.screenshot({ path: path.join(screenshots, 'ideas.png'), fullPage: true });
  await page.getByRole('link', { name: 'Research runs', exact: false }).click();
  await page.locator('#run-form').waitFor();
  await page.getByRole('button', { name: 'Freeze plan & create run' }).click();
  await page.getByRole('button', { name: 'Start collection' }).waitFor();
  await page.getByRole('button', { name: 'Start collection' }).click();
  await page.getByRole('button', { name: 'Resume collection' }).waitFor();
  assert.match(await page.locator('#status').innerText(), /missing search key/);
  await page.screenshot({ path: path.join(screenshots, 'runs.png'), fullPage: true });
  await page.getByRole('link', { name: 'Evidence review', exact: false }).click();
  await page.getByText('Import a source or annotate its context', { exact: true }).click();
  const form = page.locator('#import-form');
  const quote = 'We missed the train because neither of us knew who had packed the bags.';
  await form.locator('[name=url]').fill('https://example.com/browser-test-fixture');
  await form.locator('[name=title]').fill('TEST FIXTURE — not market evidence');
  await form.locator('[name=family]').selectOption('community');
  await form.locator('[name=content]').fill(`Browser test fixture only. ${quote} We use messages now.`);
  await form.locator('[name=provenance_note]').fill('Synthetic fixture for UI testing; never use in research.');
  await form.getByRole('button', { name: 'Save source context' }).click();
  await page.getByText('Add an evidence candidate', { exact: true }).click();
  const candidate = page.locator('#candidate-form');
  await candidate.locator('#candidate-source').selectOption({ label: 'TEST FIXTURE — not market evidence' });
  await candidate.locator('#source-context').getByText(/Browser test fixture only/).waitFor();
  await candidate.locator('[name=quote]').fill(quote);
  await candidate.locator('[name=rationale]').fill('Synthetic fixture verifies the review flow.');
  await candidate.getByRole('button', { name: 'Save for review' }).click();
  await page.locator('.evidence-quote').waitFor();
  await page.locator('.review-form [name=reason]').fill('UI test only; fixture context checked.');
  await page.locator('.review-form [name=source_checked]').check();
  await page.getByRole('button', { name: 'Accept evidence' }).click();
  await page.locator('.card-top .badge').filter({ hasText: 'accepted' }).waitFor();
  await page.screenshot({ path: path.join(screenshots, 'evidence.png'), fullPage: true });
  await page.getByRole('link', { name: 'Results', exact: false }).first().click();
  await page.getByRole('button', { name: 'Generate consolidated research pack' }).click();
  await page.locator('pre.report').waitFor();
  assert.match(await page.locator('pre.report').innerText(), /Five real conversations are pending/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'demand-evidence.md', exact: true }).click();
  assert.equal((await download).suggestedFilename(), 'demand-evidence.md');
  await page.screenshot({ path: path.join(screenshots, 'results.png'), fullPage: true });
  for (const view of ['start', 'ideas', 'runs', 'evidence', 'results']) {
    const target = new URL(url); target.pathname = `${runtime ? '/plugin-view/app-research' : ''}/workspace/${view}.html`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(target.toString()); await page.locator('#content .card').first().waitFor();
    const overflow = await page.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      body: Math.round(document.body.getBoundingClientRect().width),
      main: Math.round(document.querySelector('main')?.getBoundingClientRect().width || 0),
      mainStyle: getComputedStyle(document.querySelector('main')).cssText,
      elements: [...document.body.querySelectorAll('*')].map(el => ({ tag: el.tagName, cls: String(el.className || ''), text: el.textContent.trim().slice(0, 50), right: Math.round(el.getBoundingClientRect().right) })).filter(el => el.right > innerWidth + 1).slice(0, 8)
    }));
    assert.equal(overflow.width <= 390, true, `Horizontal overflow: ${view} ${JSON.stringify(overflow)}`);
  }
  await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true });
  if (runtime) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspaceUrl);
    await page.waitForFunction(() => typeof openPluginView === 'function' && pluginViews.size === 5);
    await page.keyboard.press('Escape');
    await page.evaluate(() => openPluginView('plugin://app-research/Research results'));
    const frame = page.frameLocator('.frame-preview iframe');
    await frame.getByRole('button', { name: 'Generate consolidated research pack' }).waitFor();
    const sandbox = await page.locator('.frame-preview iframe').getAttribute('sandbox');
    for (const permission of ['allow-downloads', 'allow-popups', 'allow-modals']) assert.ok(sandbox.includes(permission));
    assert.equal(sandbox.includes('allow-top-navigation'), false);
    await frame.getByRole('button', { name: 'Generate consolidated research pack' }).click();
    const framedDownload = page.waitForEvent('download');
    await frame.getByRole('button', { name: 'demand-evidence.md', exact: true }).click();
    assert.equal((await framedDownload).suggestedFilename(), 'demand-evidence.md');
    await page.screenshot({ path: path.join(screenshots, 'bahulam-workspace.png'), fullPage: true });
    console.log('Actual Bahulam host verified: authenticated panel assets, tool API, iframe permissions and download. No remote model call performed.');
  }
  assert.deepEqual(errors, []);
  console.log('Browser workflow passed: intro → brief → run → missing-key pause → import → exact quote → human review → export/download. Five panels checked at 390px.');
  console.log(`Screenshots: ${screenshots}`);
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    console.error('Panel diagnostics:', (await page.locator('body').innerText()).slice(0, 1800));
    await page.screenshot({ path: path.join(screenshots, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  fs.rmSync(fixture, { recursive: true, force: true });
}
