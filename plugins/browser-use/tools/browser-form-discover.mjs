import fs from 'node:fs';
import path from 'node:path';
import { browserSessionDir, nowIso, openBrowserPage, resolveState, detectFrames } from './lib.mjs';

async function resolvePlaywright(options = {}) {
  if (options.playwright) return options.playwright;
  try {
    return await import('playwright');
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Playwright is required for browser_form_discover. Install it with: npm install playwright && npx playwright install chromium. ${msg}`);
  }
}

function record(state, sessionId, action, selector, valueSummary, status) {
  const result = state.query(
    `INSERT INTO browser_actions (session_id, action, selector, value_summary, status, requires_approval, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [sessionId, action, selector || '', valueSummary || '', status, nowIso()],
  );
  state.append('browser_activity', {
    type: 'browser_form_discovered',
    session_id: sessionId,
    action_id: Number(result.lastInsertRowid),
    status,
  });
}

/**
 * Returns a string that can be page.evaluate()'d to discover form controls.
 * Same logic as the original inline evaluate but extracted for reuse across
 * main frame and child iframes.
 */
function discoveryScript() {
  return `(() => {
    const cssEscape = (v) => CSS.escape(v);
    const labelFor = (el) => {
      if (el.labels && el.labels.length) return el.labels[0].textContent.trim();
      const id = el.id;
      if (id) {
        const lbl = document.querySelector('label[for="' + cssEscape(id) + '"]');
        if (lbl) return lbl.textContent.trim();
      }
      const parent = el.closest('label');
      if (parent) return parent.textContent.trim();
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      return '';
    };
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (parseFloat(style.opacity) < 0.1) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const uniquePathFor = (el) => {
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        let selector = cur.tagName.toLowerCase();
        if (cur.id) { parts.unshift('#' + cssEscape(cur.id)); break; }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            selector += ':nth-of-type(' + idx + ')';
          }
        }
        parts.unshift(selector);
        cur = cur.parentElement;
      }
      return 'body > ' + parts.join(' > ');
    };
    const selectorFor = (el) => {
      if (el.id && document.querySelectorAll('#' + cssEscape(el.id)).length === 1) return '#' + cssEscape(el.id);
      if (el.name) {
        const tag = el.tagName.toLowerCase();
        const named = document.querySelectorAll(tag + '[name="' + cssEscape(el.name) + '"]');
        if (named.length === 1) return tag + '[name="' + cssEscape(el.name) + '"]';
      }
      if (el.type) {
        const tag = el.tagName.toLowerCase();
        const typed = document.querySelectorAll(tag + '[type="' + cssEscape(el.type) + '"]');
        if (typed.length === 1) return tag + '[type="' + cssEscape(el.type) + '"]';
      }
      return uniquePathFor(el);
    };

    const controls = [];
    const selectors = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea';
    document.querySelectorAll(selectors).forEach(el => {
      if (!isVisible(el)) return;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const entry = {
        tag, type,
        name: el.name || '',
        id: el.id || '',
        label: labelFor(el),
        placeholder: el.placeholder || '',
        selector: selectorFor(el),
        required: el.required || false,
        value: el.value || '',
        html_name: el.name || '',
      };
      if (tag === 'select') {
        entry.options = Array.from(el.options).map(o => ({ value: o.value, label: o.text.trim() }));
      }
      controls.push(entry);
    });

    const buttons = [];
    document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(el => {
      if (!isVisible(el)) return;
      buttons.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        text: (el.textContent || el.value || '').trim(),
        id: el.id || '',
        selector: selectorFor(el),
      });
    });

    return {
      title: document.title,
      url: window.location.href,
      text_sample: (document.body ? document.body.innerText || '' : '').slice(0, 1200),
      controlCount: controls.length,
      buttonCount: buttons.length,
      controls,
      buttons,
    };
  })()`;
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const sessionId = args.session_id;
  if (!sessionId) throw new Error('session_id is required');
  const sessionRow = state.query('SELECT * FROM browser_sessions WHERE id = ?', [sessionId]).at(0);
  if (!sessionRow) throw new Error(`Session ${sessionId} not found`);

  const playwright = await resolvePlaywright(options);
  const root = options.root || process.cwd();
  const outDir = browserSessionDir(root, sessionId);
  fs.mkdirSync(outDir, { recursive: true });

  const userDataDir = path.join(outDir, 'profile');
  let browserSession;

  try {
    browserSession = await openBrowserPage(playwright, {
      userDataDir,
      headless: args.headless !== false,
      persistent: true,
    });
    const page = browserSession.page;
    const waitMs = Math.min(args.wait_ms || 1000, 30000);

    await page.goto(sessionRow.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));

    // --- Main frame discovery ---
    const snapshot = await page.evaluate(discoveryScript());
    const allControls = (snapshot.controls || []).map(c => ({ ...c, _frame_index: 0 }));
    const allButtons = (snapshot.buttons || []).map(b => ({ ...b, _frame_index: 0 }));

    // --- Iframe discovery ---
    const frameList = detectFrames(page);
    for (const fInfo of frameList) {
      if (fInfo.index === 0) continue; // already discovered main frame
      if (fInfo.isCrossOrigin) {
        record(state, sessionId, 'frame_skipped', '', `Cross-origin iframe: ${fInfo.url}`, 'blocked');
        continue;
      }
      const frame = page.frames().find(f => f.url() === fInfo.url);
      if (!frame) continue;
      try {
        const frameSnapshot = await frame.evaluate(discoveryScript());
        (frameSnapshot.controls || []).forEach(c => {
          allControls.push({ ...c, _frame_index: fInfo.index, _frame_url: fInfo.url, _frame_name: fInfo.name });
        });
        (frameSnapshot.buttons || []).forEach(b => {
          allButtons.push({ ...b, _frame_index: fInfo.index, _frame_url: fInfo.url, _frame_name: fInfo.name });
        });
        record(state, sessionId, 'frame_discovered', '', `Iframe[${fInfo.index}]: ${fInfo.url}`, 'completed');
      } catch (frameErr) {
        record(state, sessionId, 'frame_skipped', '', `Iframe[${fInfo.index}]: ${fInfo.url} — ${frameErr.message}`, 'blocked');
      }
    }

    // --- Screenshot ---
    if (args.screenshot !== false) {
      await page.screenshot({ path: path.join(outDir, 'discovery.png'), fullPage: true });
    }

    // --- Console error capture ---
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    // --- Update state ---
    state.query('UPDATE browser_sessions SET status = ? WHERE id = ?', ['discovered', sessionId]);
    state.set('browser_runtime_state', {
      active_session_id: sessionId,
      url: sessionRow.url,
      status: 'discovered',
      user_data_dir: userDataDir,
    });
    record(state, sessionId, 'discover', '', `Found ${allControls.length} controls across ${frameList.length} frame(s)`, 'completed');

    // --- Console error recording ---
    if (consoleErrors.length > 0) {
      record(state, sessionId, 'console_error', '', consoleErrors.slice(0, 3).join(' | '), 'completed');
    }

    return {
      success: true,
      output: {
        session_id: sessionId,
        url: snapshot.url || sessionRow.url,
        title: snapshot.title,
        control_count: allControls.length,
        button_count: allButtons.length,
        text_sample: snapshot.text_sample,
        visible_text_sample: snapshot.text_sample,
        controls: allControls,
        buttons: allButtons,
        frames: frameList,
        console_errors: consoleErrors,
        screenshot: path.join(outDir, 'discovery.png'),
        screenshot_path: path.join(outDir, 'discovery.png'),
      },
    };
  } finally {
    if (browserSession && args.keep_open !== true) await browserSession.close();
  }
}
