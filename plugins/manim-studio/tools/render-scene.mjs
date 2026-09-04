/**
 * render_scene — OSS implementation of the canonical render_scene tool
 * (see spec/tools/render-scene.tool.yaml). Same tool name + params as
 * the SaaS Video Studio; different substrate — this impl writes the
 * scene to local disk and returns the manim CLI command for the agent
 * to launch via `shell run_in_background`. The SaaS impl POSTs to a
 * Django render service that blocks-and-returns-URL. Both write the
 * same manifest.json shape (see spec/manifest.schema.json).
 *
 * Layout (this file writes into .bahulam/tmp/manim/manim-studio/ under
 * the current working directory):
 *
 *   manim-studio/
 *     assets/                       ← curated shared library (opt-in)
 *       colors.py                     brand palette constants
 *       fonts.yaml                    font families the animator may use
 *       helpers/                      reusable animation utilities
 *       templates/                    reusable Scene base classes
 *     renders/<slug>/                ← one folder per rendered scene
 *       scene.py                      the Manim CE source
 *       script.md                     the approved brief (optional)
 *       manifest.json                 {slug, class, quality, cmd, video, ts}
 *       videos/                       manim's --media_dir output lands here
 *         <slug>/<resolution>/<Class>.mp4
 *
 * All values are relative to the caller's `cwd`, so a project's git
 * checkout owns its own manim-studio/ folder. Assets are optional; the
 * animator agent decides when to promote a helper into assets/.
 */
import fs from 'node:fs';
import path from 'node:path';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CLASS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export async function call(args = {}, options = {}) {
  const name = String(args.name || '').trim().toLowerCase();
  const sceneClass = String(args.scene_class || '').trim();
  const code = String(args.code || '');
  const quality = ['l', 'm', 'h'].includes(args.quality) ? args.quality : 'm';
  const script = String(args.script || '').trim();
  const title = String(args.title || name).trim();

  if (!SLUG_RE.test(name)) {
    return { success: false, output: `Invalid scene name '${name}' — use a lowercase slug like compound-interest.` };
  }
  if (!CLASS_RE.test(sceneClass)) {
    return { success: false, output: `Invalid scene_class '${sceneClass}' — must be a Python class name.` };
  }
  if (!code.includes(`class ${sceneClass}`)) {
    return { success: false, output: `The source does not define 'class ${sceneClass}'. The class name must match scene_class exactly.` };
  }
  if (!/from\s+manim\s+import|import\s+manim/.test(code)) {
    return { success: false, output: 'The source must import manim (Manim Community Edition: from manim import *).' };
  }

  const root = path.join(process.cwd(), '.bahulam', 'tmp', 'manim', 'manim-studio');
  const renderDir = path.join(root, 'renders', name);
  fs.mkdirSync(renderDir, { recursive: true });

  const scenePath = path.join(renderDir, 'scene.py');
  fs.writeFileSync(scenePath, code, 'utf-8');

  const scriptPath = script ? path.join(renderDir, 'script.md') : null;
  if (script) {
    fs.writeFileSync(scriptPath, `# ${title}\n\n${script}\n`, 'utf-8');
  }

  // Point manim's --media_dir at renders/<slug> so its own `videos/` shim
  // lands inside the render folder — final path is
  // renders/<slug>/videos/<slug>/<resolution>/<Class>.mp4.
  const renderCommand = `manim render -q${quality} --media_dir "${renderDir}" "${scenePath}" ${sceneClass}`;
  const resolution = quality === 'l' ? '480p15' : quality === 'h' ? '1080p60' : '720p30';
  const expectedVideo = path.join(renderDir, 'videos', name, resolution, `${sceneClass}.mp4`);

  const manifest = {
    slug: name,
    title,
    scene_class: sceneClass,
    quality,
    resolution,
    scene_path: scenePath,
    script_path: scriptPath,
    render_command: renderCommand,
    expected_video: expectedVideo,
    created_at: new Date().toISOString(),
    status: 'saved',
  };
  const manifestPath = path.join(renderDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const state = options.state ? await options.state : null;
  if (state) {
    state.append('scenes', {
      name,
      scene_class: sceneClass,
      scene_path: scenePath,
      manifest_path: manifestPath,
      quality,
    });
  }

  return {
    success: true,
    output: [
      `Scene saved to ${renderDir}/`,
      `  scene.py, manifest.json${script ? ', script.md' : ''}`,
      `Start the render in the background now:`,
      `  shell { "run_in_background": true, "on_complete_agent": "render-reviewer", "command": ${JSON.stringify(renderCommand)} }`,
      `Expected output video: ${expectedVideo}`,
    ].join('\n'),
    render_dir: renderDir,
    scene_path: scenePath,
    manifest_path: manifestPath,
    render_command: renderCommand,
    expected_video: expectedVideo,
  };
}
