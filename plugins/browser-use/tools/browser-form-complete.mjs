import fs from 'node:fs';
import path from 'node:path';
import { call as createSession } from './browser-session-create.mjs';
import { call as createProfile } from './form-profile-create.mjs';
import { browserSessionDir, nowIso, openBrowserPage, resolveState, summarizeField } from './lib.mjs';
import { fillLocator, locatorForField } from './browser-form-fill.mjs';

async function resolvePlaywright(options = {}) {
  if (options.playwright) return options.playwright;
  try {
    return await import('playwright');
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Playwright is required for browser_form_complete. Install it with: npm install playwright && npx playwright install chromium. ${msg}`);
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

async function discoverControls(page) {
  return page.evaluate(() => {
    const cssEscape = value => {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    };
    const labelFor = el => {
      if (el.id) {
        const found = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
        if (found?.textContent?.trim()) return found.textContent.trim();
      }
      const parent = el.closest('label');
      if (parent?.textContent?.trim()) {
        const clone = parent.cloneNode(true);
        clone.querySelectorAll('input, select, textarea, button, style, script').forEach(node => node.remove());
        return clone.textContent.trim().replace(/\s+/g, ' ');
      }
      return '';
    };
    const isVisible = el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
    };
    const uniquePathFor = el => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
        const tag = node.tagName.toLowerCase();
        const siblings = [...node.parentElement.children].filter(child => child.tagName === node.tagName);
        const index = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
        node = node.parentElement;
      }
      return `body > ${parts.join(' > ')}`;
    };
    const selectorFor = el => {
      if (el.id) return `#${cssEscape(el.id)}`;
      if (el.name) {
        const selector = `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"]`;
        if (document.querySelectorAll(selector).length === 1) return selector;
      }
      const type = el.getAttribute('type');
      if (type) {
        const selector = `${el.tagName.toLowerCase()}[type="${cssEscape(type)}"]`;
        if (document.querySelectorAll(selector).length === 1) return selector;
      }
      return uniquePathFor(el);
    };
    return [...document.querySelectorAll('input, select, textarea')]
      .filter(el => !['hidden', 'submit', 'button', 'reset'].includes(String(el.getAttribute('type') || '').toLowerCase()))
      .filter(isVisible)
      .map(el => ({
        label: labelFor(el),
        id: el.id || '',
        field_name: el.getAttribute('name') || '',
        type: String(el.getAttribute('type') || '').toLowerCase() || el.tagName.toLowerCase(),
        placeholder: el.getAttribute('placeholder') || '',
        selector: selectorFor(el),
      }));
  });
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function enrichFields(fields, controls) {
  return fields.map(field => {
    const input = summarizeField(field);
    if (input.selector) return input;
    const wanted = normalize(input.name);
    const matched = controls.find(control => {
      const labels = [control.label, control.id, control.field_name, control.placeholder].map(normalize);
      return labels.some(label => label && (label === wanted || label.includes(wanted) || wanted.includes(label)));
    });
    if (!matched) return input;
    return {
      ...input,
      selector: matched.selector,
      id: matched.id,
      field_name: matched.field_name,
      placeholder: matched.placeholder,
    };
  });
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const url = String(args.url || '').trim();
  const fields = Array.isArray(args.fields) ? args.fields : [];
  if (!url) throw new Error('url is required');
  if (!fields.length) throw new Error('fields must contain at least one field');

  const session = await createSession({
    name: args.name || 'browser form',
    url,
    purpose: args.purpose || 'Complete browser form.',
    force_new: args.force_new,
  }, options);
  const sessionId = Number(session.output.session_id);

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
    profile_id: null,
    url,
    discovered_controls: 0,
    filled: [],
    skipped: [],
    submitted: false,
    screenshot_path: '',
    handoff: manualSubmitHandoff ? {
      mode: 'user_submit',
      browser_left_open: keepOpen,
      message: keepOpen
        ? 'Form filled. User must review the open browser and submit manually.'
        : 'Form filled without submitting. Browser was closed because keep_open=false.',
    } : null,
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    insertAction(state, sessionId, 'open', '', url, 'completed');
    const waitMs = Number(args.wait_ms ?? 1000);
    if (waitMs > 0 && typeof page.waitForTimeout === 'function') await page.waitForTimeout(waitMs);

    const controls = args.discover === false ? [] : await discoverControls(page);
    result.discovered_controls = controls.length;
    if (controls.length) {
      insertAction(state, sessionId, 'discover', 'form controls', `${controls.length} visible controls`, 'completed');
    }

    const enrichedFields = enrichFields(fields, controls);
    const profile = await createProfile({
      session_id: sessionId,
      label: args.label || args.name || 'browser form profile',
      fields: enrichedFields,
      redactions: args.redactions || [],
    }, options);
    result.profile_id = profile.output.profile_id;

    for (const field of enrichedFields) {
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
        await page.waitForLoadState?.('domcontentloaded', { timeout: 1000 }).catch(() => {});
        result.submitted = true;
        insertAction(state, sessionId, 'submit', submitSelector, 'submitted with explicit approval', 'completed');
      }
    } else if (manualSubmitHandoff) {
      insertAction(state, sessionId, 'submit', submitSelector, 'handoff to user: review and submit manually', 'blocked', true);
    }

    const screenshotPath = path.join(outDir, 'complete.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot_path = screenshotPath;
    insertAction(state, sessionId, 'screenshot', '', screenshotPath, 'completed');

    state.query('UPDATE browser_sessions SET status = ?, updated_at = ? WHERE id = ?', [result.submitted ? 'completed' : 'filled', nowIso(), sessionId]);
    state.set('browser_runtime_state', {
      active_session_id: sessionId,
      url,
      status: result.submitted ? 'completed' : 'filled',
      user_data_dir: browserSession.userDataDir,
      last_complete: result,
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
