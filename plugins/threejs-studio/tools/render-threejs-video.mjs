/**
 * render-threejs-video tool — exports a Three.js HTML scene to MP4 video.
 *
 * Launches headless Chromium (via puppeteer), opens the HTML file,
 * captures frames at the specified FPS, and encodes to MP4 via ffmpeg.
 *
 * Parameters:
 *   slug       - scene slug (a-z0-9-)
 *   html_path  - optional path to the .html file (default: resolves from slug + cwd)
 *   duration   - video duration in seconds (default 10)
 *   fps        - frames per second (default 30, max 60)
 *   preset     - 'orbit' | 'auto-orbit' | 'static' (default 'auto-orbit')
 *   width      - output width (default 1920)
 *   height     - output height (default 1080)
 *   quality    - 'l' (480p), 'm' (720p), 'h' (1080p) — overrides width/height
 *   cwd        - base directory (defaults to process.cwd()). Must match the
 *                `cwd` passed to write_threejs_scene so HTML/video paths align.
 *
 * Returns:
 *   { success, output: { slug, video_path, frame_count, duration_s, preset }, video_path, render_command }
 *
 * The render_command is for the director to launch as a background shell job.
 *   shell { run_in_background: true, on_complete_agent: "renderer", command: <render_command> }
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nowIso, appendEvent, run } from './lib.mjs';
const THIS_FILE = fileURLToPath(import.meta.url);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Quality presets
const QUALITY_PRESETS = {
  l: { width: 854, height: 480 },
  m: { width: 1280, height: 720 },
  h: { width: 1920, height: 1080 },
};

/** Resolve the base directory: use `cwd` if provided, else process.cwd(). */
function resolveBase(cwd) {
  return cwd ? path.resolve(String(cwd)) : process.cwd();
}

function resolveHtmlPath(slug, base) {
  return path.join(base, slug, 'index.html');
}

function videoOutputPath(slug, base) {
  const dir = path.join(base, 'videos');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${slug}.mp4`);
}

/**
 * Capture a single frame from the puppeteer page using canvas.toDataURL.
 * Returns a Buffer of PNG data.
 */
async function captureCanvasFrame(page, width, height) {
  // Resize to match output
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    // Ensure render happened
    return canvas.toDataURL('image/png');
  });

  if (!dataUrl) {
    // Fallback: full page screenshot
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    return buffer;
  }

  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

/**
 * Apply orbit preset — continuously rotate camera around target.
 */
async function applyAutoOrbit(page, frameIndex, totalFrames) {
  await page.evaluate((idx, total) => {
    // Find OrbitControls on the scene and rotate
    const angle = (idx / total) * Math.PI * 2;
    // Try common patterns: controls object, camera.position
    if (typeof controls !== 'undefined' && controls.target) {
      const radius = controls.object.position.distanceTo(controls.target);
      controls.object.position.x = controls.target.x + radius * Math.sin(angle);
      controls.object.position.z = controls.target.z + radius * Math.cos(angle);
      controls.object.lookAt(controls.target);
      controls.update();
    } else if (typeof camera !== 'undefined') {
      const radius = 8;
      camera.position.x = radius * Math.sin(angle);
      camera.position.z = radius * Math.cos(angle);
      camera.lookAt(0, 1, 0);
    }
  }, frameIndex, totalFrames);
}

async function renderWithPuppeteer(htmlPath, outputPath, duration, fps, preset, width, height) {
  // Frame budget
  const totalFrames = Math.min(Math.round(duration * fps), duration * 60); // cap
  const frameDir = path.join(
    path.dirname(outputPath), '..', 'frames', path.basename(outputPath, '.mp4'),
  );
  fs.mkdirSync(frameDir, { recursive: true });

  // Dynamic import puppeteer (may need install)
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
    puppeteer = puppeteer.default || puppeteer;
  } catch {
    // Fall back: try npx puppeteer
    return {
      success: false,
      output: 'puppeteer not installed. Run: npx puppeteer browsers install chrome',
    };
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    // Navigate to the HTML file
    const fileUrl = `file://${htmlPath}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for canvas to be rendered
    try {
      await page.waitForSelector('canvas', { timeout: 15000 });
    } catch {
      await browser.close();
      return {
        success: false,
        output: 'No <canvas> found in the HTML page. The scene did not render.',
      };
    }

    // Allow a render frame to complete
    await new Promise(r => setTimeout(r, 500));

    // Animate preset
    const isAutoOrbit = preset === 'auto-orbit' || preset === 'orbit';

    // Capture frames
    let captured = 0;
    for (let i = 0; i < totalFrames; i++) {
      if (isAutoOrbit) {
        await applyAutoOrbit(page, i, totalFrames);
        // Let the render happen
        await new Promise(r => setTimeout(r, 1000 / fps / 2));
      } else {
        await new Promise(r => setTimeout(r, 1000 / fps));
      }

      const frameBuffer = await captureCanvasFrame(page, width, height);
      const framePath = path.join(frameDir, `frame-${String(i).padStart(6, '0')}.png`);
      fs.writeFileSync(framePath, frameBuffer);
      captured++;
    }

    await browser.close();

    // Encode to MP4 via ffmpeg
    const result = spawnSync('ffmpeg', [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(frameDir, 'frame-%06d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '18',
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      outputPath,
    ], { encoding: 'utf-8', timeout: 120000 });

    // Cleanup frames
    try {
      fs.rmSync(frameDir, { recursive: true, force: true });
    } catch { /* ok */ }

    if (result.status !== 0) {
      return {
        success: false,
        output: `ffmpeg encoding failed: ${result.stderr?.slice(0, 500) || result.error?.message}`,
      };
    }

    return {
      success: true,
      output: {
        slug: path.basename(outputPath, '.mp4'),
        video_path: outputPath,
        frame_count: captured,
        duration_s: captured / fps,
        preset,
      },
      video_path: outputPath,
      frame_count: captured,
    };
  } catch (err) {
    try { await browser.close(); } catch { /* ok */ }
    return {
      success: false,
      output: `Render failed: ${err.message}`,
    };
  }
}

export async function call(args = {}, options = {}) {
  const {
    slug,
    html_path,
    duration = 10,
    fps = 30,
    preset = 'auto-orbit',
    width,
    height,
    quality,
    cwd,
  } = args;

  if (!slug || !SLUG_RE.test(slug)) {
    return { success: false, output: `Invalid slug "${slug}". Use lowercase alphanumeric + hyphens.` };
  }

  const base = resolveBase(cwd);

  // Resolve HTML path
  const resolvedHtmlPath = html_path || resolveHtmlPath(slug, base);
  if (!fs.existsSync(resolvedHtmlPath)) {
    return { success: false, output: `HTML file not found at ${resolvedHtmlPath}. Write the scene first.` };
  }

  // Resolve quality / dimensions
  let outWidth = width;
  let outHeight = height;
  if (quality && QUALITY_PRESETS[quality]) {
    outWidth = QUALITY_PRESETS[quality].width;
    outHeight = QUALITY_PRESETS[quality].height;
  }
  if (!outWidth) outWidth = 1920;
  if (!outHeight) outHeight = 1080;

  // Clamp
  const safeFps = Math.min(Math.max(Math.round(fps), 1), 60);
  const safeDuration = Math.min(Math.max(duration, 1), 120);

  const outputPath = videoOutputPath(slug, base);

  // Background shell command — uses THIS_FILE (resolved at import time)
  const shellArgs = JSON.stringify({
    slug, html_path: resolvedHtmlPath, duration: safeDuration,
    fps: safeFps, preset, width: outWidth, height: outHeight,
  });
  const renderCommand = `node -e "import('${THIS_FILE.replace(/\\/g, '/')}').then(m => m.call(${shellArgs})).then(r => process.stdout.write(JSON.stringify(r))).catch(e => process.stderr.write(e.message))"`;

  // Always try to render directly
  const result = await renderWithPuppeteer(
    resolvedHtmlPath, outputPath, safeDuration, safeFps, preset, outWidth, outHeight,
  );

  // Record in state
  const state = options?.state ? await options.state : null;
  if (state && result.success) {
    if (typeof state.query === 'function') {
      try {
        state.query(
          `UPDATE threejs_scenes SET status = 'rendered', updated_at = ? WHERE slug = ?`,
          [nowIso(), slug],
        );
        state.query(
          `INSERT INTO threejs_jobs (slug, status, html_path, notes, created_at, completed_at)
           VALUES (?, 'completed', ?, ?, ?, ?)`,
          [slug, result.video_path || outputPath,
           `Video rendered: ${result.output.duration_s}s @ ${safeFps}fps, preset=${preset}`,
           nowIso(), nowIso()],
        );
      } catch { /* skip */ }
    }
    appendEvent(state, 'renders', {
      name: slug, status: 'completed',
      video_path: result.video_path || outputPath,
      notes: `${result.output.duration_s}s @ ${safeFps}fps`,
      created_at: nowIso(),
    });
  }

  if (result.success) {
    return {
      ...result,
      render_command: renderCommand,
      output: `Video rendered: ${result.video_path}
Duration: ${result.output.duration_s.toFixed(1)}s
Frames: ${result.output.frame_count}
Preset: ${preset}
Resolution: ${outWidth}×${outHeight}

The director should surface this path to the user.`,
    };
  }

  return result;
}