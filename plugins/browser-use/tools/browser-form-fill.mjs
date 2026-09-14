import fs from 'node:fs';
import path from 'node:path';
import { browserSessionDir, nowIso, openBrowserPage, parseJson, resolveState } from './lib.mjs';

function boolish(value) {
  return ['1', 'true', 'yes', 'on', 'checked'].includes(String(value || '').toLowerCase());
}

async function resolvePlaywright(options = {}) {
  if (options.playwright) return options.playwright;
  try {
    return await import('playwright');
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Playwright is required for browser_form_fill. Install it with: npm install playwright && npx playwright install chromium. ${msg}`);
  }
}

function insertAction(state, sessionId, action, selector, valueSummary, status, requiresApproval = false) {
  const result = state.query(
    `INSERT INTO browser_actions (session_id, action, selector, value_summary, status, requires_approval, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, action, selector || '', valueSummary || '', status, requiresApproval ? 1 : 0, nowIso()],
  );
  state.append('browser_activity', {
    type: 'browser_action_recorded',
    session_id: sessionId,
    action_id: Number(result.lastInsertRowid),
    action,
    status,
    requires_approval: requiresApproval,
  });
  return Number(result.lastInsertRowid);
}

export async function fillLocator(locator, field) {
  const meta = await locator.evaluate(el => ({
    tag: String(el.tagName || '').toLowerCase(),
    type: String(el.getAttribute('type') || '').toLowerCase(),
  }));
  const value = field.value_summary || '';
  if (meta.tag === 'select') {
    await locator.selectOption(value);
    return 'select';
  }
  if (meta.type === 'checkbox') {
    if (boolish(value)) await locator.check();
    else await locator.uncheck();
    return 'check';
  }
  if (meta.type === 'radio') {
    await locator.check();
    return 'radio';
  }
  if (meta.type === 'file') {
    return 'skip_file';
  }
  await locator.fill(value);
  return 'fill';
}

function cssEscape(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export async function locatorForField(page, field) {
  const selectors = [
    field.selector,
    field.id ? `#${cssEscape(field.id)}` : '',
    field.field_name ? `[name="${cssEscape(field.field_name)}"]` : '',
    field.aria_label ? `[aria-label="${cssEscape(field.aria_label)}"]` : '',
    field.placeholder ? `[placeholder="${cssEscape(field.placeholder)}"]` : '',
  ].filter(Boolean);

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) return { locator, selector };
  }
  return { locator: null, selector: field.selector || '', reason: 'not_found' };
}

async function readLocalStorageWithRetry(page, key, { timeoutMs = 2000, intervalMs = 100 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started <= timeoutMs) {
    last = await page.evaluate(storageKey => localStorage.getItem(storageKey), key);
    if (last) return { value: last, found: true };
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(intervalMs);
    } else {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  return { value: last, found: false };
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const sessionId = Number(args.session_id);
  const profileId = Number(args.profile_id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error('session_id must be a positive integer');
  if (!Number.isInteger(profileId) || profileId <= 0) throw new Error('profile_id must be a positive integer');

  const sessions = state.query('SELECT * FROM browser_sessions WHERE id = ? LIMIT 1', [sessionId]);
  const session = sessions[0];
  if (!session) throw new Error(`session ${sessionId} not found`);
  const profiles = state.query(
    'SELECT * FROM form_profiles WHERE id = ? AND session_id = ? LIMIT 1',
    [profileId, sessionId],
  );
  const profile = profiles[0];
  if (!profile) throw new Error(`profile ${profileId} not found for session ${sessionId}`);

  const fields = parseJson(profile.fields_json, []).filter(field => field.selector);
  const playwright = await resolvePlaywright(options);
  const manualSubmitHandoff = args.submit !== true && args.user_submit !== false;
  const keepOpen = args.keep_open ?? manualSubmitHandoff;
  const headless = args.headless ?? !manualSubmitHandoff;
  const root = options.workspaceRoot || process.cwd();
  const outDir = browserSessionDir(root, sessionId);
  fs.mkdirSync(outDir, { recursive: true });
  const browserSession = await openBrowserPage(playwright, {
    root,
    sessionId,
    headless,
    persistent: args.persistent_context !== false,
  });
  const page = browserSession.page;

  const result = {
    session_id: sessionId,
    profile_id: profileId,
    url: session.url,
    filled: [],
    skipped: [],
    submitted: false,
    screenshot_path: '',
    storage_value: null,
    storage_found: false,
    handoff: manualSubmitHandoff ? {
      mode: 'user_submit',
      browser_left_open: keepOpen,
      message: keepOpen
        ? 'Form filled. User must review the open browser and submit manually.'
        : 'Form filled without submitting. Browser was closed because keep_open=false.',
    } : null,
  };

  try {
    await page.goto(session.url, { waitUntil: 'domcontentloaded' });
    insertAction(state, sessionId, 'open', '', session.url, 'completed');

    for (const field of fields) {
      const found = await locatorForField(page, field);
      if (!found.locator) {
        result.skipped.push({ name: field.name, selector: found.selector, reason: found.reason });
        insertAction(state, sessionId, 'error', found.selector, `${field.name}: selector not found`, 'failed');
        continue;
      }
      const op = await fillLocator(found.locator, field);
      if (op === 'skip_file') {
        result.skipped.push({ name: field.name, selector: found.selector, reason: 'file_input_not_auto_filled' });
        insertAction(state, sessionId, 'type', found.selector, `${field.name}: skipped file input`, 'blocked');
        continue;
      }
      result.filled.push({ name: field.name, selector: found.selector, op, sensitive: Boolean(field.sensitive) });
      insertAction(state, sessionId, op === 'select' ? 'select' : 'type', found.selector, field.sensitive ? `${field.name}: redacted` : `${field.name}: ${field.value_summary || ''}`, 'completed');
    }

    const submitSelector = args.submit_selector || '#submitBtn, button[type="submit"], input[type="submit"]';
    if (args.submit) {
      if (!args.submit_approved) {
        insertAction(state, sessionId, 'submit', submitSelector, 'submit blocked pending explicit approval', 'planned', true);
      } else {
        await page.locator(submitSelector).first().click();
        if (typeof page.waitForLoadState === 'function') {
          await page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => {});
        }
        result.submitted = true;
        insertAction(state, sessionId, 'submit', submitSelector, 'submitted with explicit approval', 'completed');
      }
    }

    const screenshotPath = path.join(outDir, 'after-fill.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot_path = screenshotPath;
    insertAction(state, sessionId, 'screenshot', '', screenshotPath, 'completed');

    if (args.local_storage_key) {
      const storage = await readLocalStorageWithRetry(page, String(args.local_storage_key), {
        timeoutMs: Number(args.storage_wait_ms || 2000),
        intervalMs: 100,
      });
      result.storage_value = storage.value;
      result.storage_found = storage.found;
      insertAction(state, sessionId, 'extract', 'localStorage', String(args.local_storage_key), storage.found ? 'completed' : 'blocked');
    }

    if (manualSubmitHandoff) {
      insertAction(state, sessionId, 'submit', submitSelector, 'handoff to user: review and submit manually', 'blocked', true);
    }

    state.query('UPDATE browser_sessions SET status = ?, updated_at = ? WHERE id = ?', [result.submitted ? 'completed' : 'filled', nowIso(), sessionId]);
    state.set('browser_runtime_state', {
      active_session_id: sessionId,
      url: session.url,
      status: result.submitted ? 'completed' : 'filled',
      user_data_dir: browserSession.userDataDir,
    });
    return { success: true, output: result };
  } catch (err) {
    insertAction(state, sessionId, 'error', '', err?.message || String(err), 'failed');
    state.query('UPDATE browser_sessions SET status = ?, updated_at = ? WHERE id = ?', ['blocked', nowIso(), sessionId]);
    throw err;
  } finally {
    if (!keepOpen) await browserSession.close();
  }
}
