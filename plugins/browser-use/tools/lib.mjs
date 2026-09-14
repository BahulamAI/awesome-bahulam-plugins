import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function nowIso() {
  return new Date().toISOString();
}

export async function resolveState(options = {}) {
  const state = await options.state;
  if (!state) throw new Error('browser-use tools require plugin state');
  return state;
}

export function sanitizeUrl(url) {
  const text = String(url || '').trim();
  if (!text) throw new Error('url is required');
  if (/^https?:\/\//i.test(text) || /^file:\/\//i.test(text)) return text;
  if (text.startsWith('/') || text.startsWith('./') || text.startsWith('../')) {
    return pathToFileURL(text).href;
  }
  throw new Error('url must start with http://, https://, file://, /, ./, or ../');
}

export function summarizeField(field = {}) {
  const sensitive = Boolean(field.sensitive) || field.source === 'secret';
  return {
    name: String(field.name || '').trim(),
    selector: String(field.selector || '').trim(),
    id: String(field.id || '').trim(),
    field_name: String(field.field_name || field.html_name || '').trim(),
    aria_label: String(field.aria_label || '').trim(),
    placeholder: String(field.placeholder || '').trim(),
    value_summary: sensitive ? 'redacted' : String(field.value || field.value_summary || '').slice(0, 160),
    sensitive,
    source: field.source || 'user',
    file_path: String(field.file_path || '').trim(),
    frame_url: String(field.frame_url || '').trim(),
  };
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function browserSessionDir(root, sessionId) {
  return path.join(root, '.bahulam', 'tmp', 'browser-use', String(sessionId));
}

export function browserUserDataDir(root, sessionId) {
  return path.join(browserSessionDir(root, sessionId), 'profile');
}

export async function openBrowserPage(playwright, opts) {
  const {
    root = process.cwd(),
    sessionId = 'default',
    userDataDir = browserUserDataDir(root, sessionId),
    headless = false,
    persistent = true,
  } = opts || {};

  let browser, context, page;

  if (persistent && typeof playwright.chromium.launchPersistentContext === 'function') {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = context.pages()[0] || await context.newPage();
    browser = context;
  } else {
    browser = await playwright.chromium.launch({ headless });
    if (typeof browser.newContext === 'function') {
      context = await browser.newContext();
      page = await context.newPage();
    } else {
      context = browser;
      page = await browser.newPage();
    }
  }

  return {
    page,
    browser,
    context,
    userDataDir,
    close: async () => browser.close(),
  };
}

/**
 * Detect all frames in the current page, including iframes.
 * Returns [{ index, url, name, isMain }].
 * Cross-origin frames are included by metadata only (cannot evaluate).
 */
export function detectFrames(page) {
  if (!page || typeof page.frames !== 'function') return [];
  const frames = page.frames();
  const pageUrl = typeof page.url === 'function' ? page.url() : '';
  let origin = '';
  try {
    origin = pageUrl ? new URL(pageUrl).origin : '';
  } catch {
    origin = '';
  }
  return frames.map((f, i) => ({
    index: i,
    url: f.url(),
    name: f.name() || '',
    isMain: i === 0,
    isCrossOrigin: Boolean(origin) && i > 0 && !f.url().startsWith(origin),
  }));
}

/**
 * Wait for a modal/dialog containing the given text to become visible.
 * Tries role=dialog, aria-modal, .modal class, then :has-text fallback.
 * Returns a Playwright Locator for the modal element.
 */
export async function waitForModal(page, text, { timeoutMs = 10000 } = {}) {
  const selectors = [
    `[role="dialog"]:has-text("${text.replace(/"/g, '\\"')}"):visible`,
    `[aria-modal="true"]:has-text("${text.replace(/"/g, '\\"')}"):visible`,
    `.modal:has-text("${text.replace(/"/g, '\\"')}"):visible`,
    `.MuiDialog-root:has-text("${text.replace(/"/g, '\\"')}"):visible`,
    `:has-text("${text.replace(/"/g, '\\"')}"):visible`,
  ];

  let lastErr;
  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      return locator;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Modal with text "${text}" not found within ${timeoutMs}ms`);
}

/**
 * Wait for a new page/popup to be opened by the browser context.
 * Must be called BEFORE the trigger action. Returns the new Page.
 */
export async function waitForPopup(context, { timeoutMs = 10000 } = {}) {
  return context.waitForEvent('page', { timeout: timeoutMs });
}

/**
 * Resolve an element on the page (or across frames) by text match or selector.
 * target can be:
 *   - string (text or CSS selector)
 *   - { text, selector, label, frame_url }
 *
 * Returns { locator: PlaywrightLocator|null, frame: Frame|null, selector: string, reason: string }
 */
export async function resolveElement(page, target, opts = {}) {
  const { timeoutMs = 5000 } = opts;

  const text = typeof target === 'string' ? target : (target.text || target.label || '');
  const cssSel = typeof target === 'object' && target.selector ? target.selector : '';
  const frameUrl = typeof target === 'object' ? (target.frame_url || '') : '';
  const label = typeof target === 'object' ? (target.label || '') : '';

  const candidates = [];
  // Collect frames to search
  const frames = page.frames();
  const searchFrames = frameUrl
    ? frames.filter(f => f.url().includes(frameUrl))
    : frames;

  for (const frame of searchFrames) {
    // Try by role/text for interactive elements
    const textToUse = text || label;
    if (textToUse) {
      for (const role of ['button', 'link', 'menuitem', 'tab', 'option', 'heading', 'textbox', 'combobox']) {
        try {
          const loc = frame.getByRole(role, { name: textToUse });
          const count = await loc.count();
          if (count > 0) {
            candidates.push({ locator: loc, frame, selector: `role=${role}[name="${textToUse}"]`, source: 'role' });
          }
        } catch { /* skip */ }
      }
      // Try getByText
      try {
        const loc = frame.getByText(textToUse, { exact: false });
        const count = await loc.count();
        if (count > 0) {
          candidates.push({ locator: loc, frame, selector: `text="${textToUse}"`, source: 'text' });
        }
      } catch { /* skip */ }
      // Try placeholder
      try {
        const loc = frame.getByPlaceholder(textToUse);
        const count = await loc.count();
        if (count > 0) {
          candidates.push({ locator: loc, frame, selector: `placeholder="${textToUse}"`, source: 'placeholder' });
        }
      } catch { /* skip */ }
      // Try label
      try {
        const loc = frame.getByLabel(textToUse);
        const count = await loc.count();
        if (count > 0) {
          candidates.push({ locator: loc, frame, selector: `label="${textToUse}"`, source: 'label' });
        }
      } catch { /* skip */ }
    }

    // Try explicit CSS selector
    if (cssSel) {
      try {
        const loc = frame.locator(cssSel).first();
        const count = await loc.count();
        if (count > 0) {
          candidates.push({ locator: loc, frame, selector: cssSel, source: 'css' });
        }
      } catch { /* skip */ }
    }
  }

  if (candidates.length > 0) {
    // Prefer by source order: role > text > label > placeholder > css
    const priority = { role: 0, text: 1, label: 2, placeholder: 3, css: 4 };
    candidates.sort((a, b) => (priority[a.source] ?? 5) - (priority[b.source] ?? 5));
    return candidates[0];
  }

  return { locator: null, frame: null, selector: text || cssSel, reason: 'not_found' };
}
