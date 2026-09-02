/**
 * save_scene — write a Manim CE scene to the render workspace and return
 * the background-render command. The agent (not this tool) launches the
 * render via shell run_in_background so the job lands in the CLI's job
 * registry (timeout, log spool, job_output, on_complete wake-up).
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

  const root = path.join(process.cwd(), '.bahulam', 'tmp', 'manim');
  const scenesDir = path.join(root, 'scenes');
  const mediaDir = path.join(root, 'media');
  fs.mkdirSync(scenesDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });
  const scenePath = path.join(scenesDir, `${name}.py`);
  fs.writeFileSync(scenePath, code, 'utf-8');

  const renderCommand = `manim render -q${quality} --media_dir "${mediaDir}" "${scenePath}" ${sceneClass}`;
  const expectedVideo = path.join(
    mediaDir, 'videos', name,
    quality === 'l' ? '480p15' : quality === 'h' ? '1080p60' : '720p30',
    `${sceneClass}.mp4`,
  );

  const state = options.state ? await options.state : null;
  if (state) {
    state.append('scenes', { name, scene_class: sceneClass, scene_path: scenePath, quality });
  }

  return {
    success: true,
    output: [
      `Scene saved: ${scenePath}`,
      `Start the render in the background now:`,
      `  shell { "run_in_background": true, "on_complete_agent": "render-reviewer", "command": ${JSON.stringify(renderCommand)} }`,
      `Expected output video: ${expectedVideo}`,
    ].join('\n'),
    scene_path: scenePath,
    render_command: renderCommand,
    expected_video: expectedVideo,
  };
}
