/**
 * render_screenshot — capture PNGs of the scene from N camera angles.
 *
 * Uses puppeteer (headless Chromium) to load index.html and override the
 * camera position for each shot, then reads the canvas via toDataURL.
 *
 * If puppeteer isn't installed, degrades to a shot-plan JSON without
 * actually capturing — the Critic Agent can then request a manual render
 * or skip the visual check.
 *
 * Args:
 *   slug*     - scene slug
 *   angles    - array of { azimuth, elevation, distance? } in degrees / m.
 *               Default: 4 angles (front, right, back, top).
 *   width     - viewport width (default 1024)
 *   height    - viewport height (default 640)
 *   wait_ms   - post-load render warmup (default 800)
 *   cwd
 *
 * Returns { screenshots: [{ index, angle, path, width, height }], mode }
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSceneDir, loadScene, nowIso, appendEvent } from './lib.mjs';

const DEFAULT_ANGLES = [
  { azimuth: 30,  elevation: 20, name: 'front-right' },
  { azimuth: 120, elevation: 15, name: 'right-back' },
  { azimuth: 210, elevation: 20, name: 'back-left' },
  { azimuth: 90,  elevation: 80, name: 'top' },
];

async function tryLoadPuppeteer() {
  try { return (await import('puppeteer')).default; } catch { return null; }
}

function sceneRadius(scene) {
  // Rough sphere covering the scene from meta bounds; fall back to camera dist.
  const cam = scene.camera || {};
  const p = cam.position || [5, 4, 8];
  const t = cam.target || [0, 0, 0];
  const dx = p[0] - t[0], dy = p[1] - t[1], dz = p[2] - t[2];
  return Math.max(3, Math.sqrt(dx * dx + dy * dy + dz * dz));
}

export async function call(args = {}, options = {}) {
  const { slug, angles, width = 1024, height = 640, wait_ms = 800, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  const sceneDir = resolveSceneDir(slug, cwd);
  const htmlPath = path.join(sceneDir, 'index.html');
  if (!fs.existsSync(htmlPath)) return { success: false, output: `index.html missing at ${htmlPath}` };

  const shotDir = path.join(sceneDir, 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });

  const shots = (angles && angles.length ? angles : DEFAULT_ANGLES).map((a, i) => ({
    index: i,
    ...a,
  }));

  const puppeteer = await tryLoadPuppeteer();
  if (!puppeteer) {
    const plan = {
      mode: 'plan-only',
      note: 'puppeteer not installed — install `puppeteer` to enable real captures',
      shots,
    };
    return { success: true, output: plan };
  }

  const radius = sceneRadius(scene);
  const target = scene.camera?.target || [0, 0, 0];

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader'] });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, wait_ms));

    for (const shot of shots) {
      const dist = shot.distance || radius;
      const az = (shot.azimuth * Math.PI) / 180;
      const el = (shot.elevation * Math.PI) / 180;
      const camPos = [
        target[0] + dist * Math.cos(el) * Math.sin(az),
        target[1] + dist * Math.sin(el),
        target[2] + dist * Math.cos(el) * Math.cos(az),
      ];
      await page.evaluate((p, t) => {
        if (window.__camera && window.__camera.position?.set) {
          window.__camera.position.set(p[0], p[1], p[2]);
          window.__camera.lookAt(t[0], t[1], t[2]);
          if (window.__renderer && window.__scene) window.__renderer.render(window.__scene, window.__camera);
        }
      }, camPos, target);
      await new Promise(r => setTimeout(r, 120));

      const dataUrl = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? c.toDataURL('image/png') : null;
      });
      let outPath = path.join(shotDir, `${String(shot.index).padStart(2, '0')}-${(shot.name || `az${shot.azimuth}`).replace(/[^\w-]/g, '_')}.png`);
      if (dataUrl) {
        fs.writeFileSync(outPath, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
      } else {
        // fallback screenshot of the page
        await page.screenshot({ path: outPath, type: 'png' });
      }
      results.push({ index: shot.index, angle: shot, path: outPath, width, height });
    }
  } finally {
    await browser.close();
  }

  // Record in state
  const state = options?.state ? await options.state : null;
  if (state) {
    appendEvent(state, 'screenshots', { slug, count: results.length, at: nowIso(), paths: results.map(r => r.path) });
  }
  return { success: true, output: { mode: 'captured', slug, shots: results } };
}
