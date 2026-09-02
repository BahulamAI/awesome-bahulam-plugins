/**
 * Offline smoke test for the manim-studio tool modules.
 * Run: node plugins/manim-studio/selftest.mjs
 * Probes for the render prerequisites (python3, manim, ffmpeg) but only
 * WARNS when missing — the tool logic itself is tested offline.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { call as saveScene } from './tools/save-scene.mjs';
import { call as registerRender } from './tools/register-render.mjs';
import { call as listRenders } from './tools/list-renders.mjs';

let failures = 0;
const ok = (label, cond) => {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
};

// ── Prerequisite probes (warn-only) ──
for (const [cmd, args] of [['python3', ['--version']], ['manim', ['--version']], ['ffmpeg', ['-version']]]) {
  const probe = spawnSync(cmd, args, { encoding: 'utf-8' });
  if (probe.status === 0) console.log(`ok   prereq ${cmd}: ${String(probe.stdout || probe.stderr).split('\n')[0].trim()}`);
  else console.warn(`warn prereq ${cmd} not found — renders will fail until installed`);
}

// ── save_scene ──
const SCENE = `from manim import *\n\nclass SelfTest(Scene):\n    def construct(self):\n        self.play(Create(Circle()))\n        self.wait()\n`;
{
  const bad = await saveScene({ name: 'Bad Name!', scene_class: 'SelfTest', code: SCENE });
  ok('save_scene rejects bad slug', bad.success === false);
  const mismatch = await saveScene({ name: 'selftest', scene_class: 'Other', code: SCENE });
  ok('save_scene rejects class mismatch', mismatch.success === false);
  const good = await saveScene({ name: 'selftest', scene_class: 'SelfTest', code: SCENE, quality: 'l' });
  ok('save_scene writes the scene file', good.success === true && fs.existsSync(good.scene_path));
  ok('render command targets manim CE', /^manim render -ql /.test(good.render_command));
  ok('render command includes on_complete guidance', good.output.includes('render-reviewer'));
}

// ── register_render + list_renders against a fake blackboard ──
{
  const rows = [];
  const fakeState = {
    append: (stream, payload) => rows.push({ stream, payload, created_at: new Date().toISOString() }),
    list: (stream, opts = {}) => rows.filter(r => r.stream === stream).slice(0, opts.limit || 20),
  };
  const reg = await registerRender(
    { name: 'selftest', scene_class: 'SelfTest', status: 'completed', video_path: '/tmp/x.mp4', duration_s: 12 },
    { state: fakeState },
  );
  ok('register_render records', reg.success === true && rows.length === 1);
  const listed = await listRenders({}, { state: fakeState });
  ok('list_renders returns the row', listed.success === true && listed.renders.length === 1 && listed.renders[0].name === 'selftest');
  const noState = await registerRender({ name: 'x', status: 'failed' }, {});
  ok('register_render fails gracefully without blackboard', noState.success === false);
}

// Cleanup the scene written into cwd
try { fs.rmSync(path.join(process.cwd(), '.bahulam', 'tmp', 'manim', 'scenes', 'selftest.py'), { force: true }); } catch { /* ok */ }

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL MANIM-STUDIO SELFTESTS PASSED');
