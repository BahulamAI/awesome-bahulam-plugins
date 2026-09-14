/**
 * Offline smoke test for the content-creation tool modules.
 * Run: node plugins/content-creation/selftest.mjs
 * Probes for the render prerequisites (python3, manim, ffmpeg) but only
 * WARNS when missing — the tool logic itself is tested offline.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { call as contentBrief } from './tools/content-brief.mjs';
import { call as recordAsset } from './tools/record-asset.mjs';
import { call as writeThreejsScene } from './tools/write-threejs-scene.mjs';
import { call as listAssets } from './tools/list-assets.mjs';
import { call as renderScene } from './tools/render-scene.mjs';
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

// ── content package + asset gallery ──
const rows = [];
const kv = new Map();
const fakeState = {
  set: (key, value) => kv.set(key, value),
  get: (key) => kv.get(key),
  append: (stream, payload) => {
    const row = { id: rows.length + 1, stream, payload, created_at: new Date().toISOString() };
    rows.push(row);
    return row.id;
  },
  list: (stream, opts = {}) => rows.filter(r => r.stream === stream).slice(0, opts.limit || 50),
};

{
  const brief = await contentBrief({
    name: 'selftest-package',
    objective: 'Create a multi-format content package.',
    audience: 'Bahulam plugin authors',
    formats: ['image', 'threejs', 'manim'],
    channels: ['x', 'linkedin'],
  }, { state: Promise.resolve(fakeState) });
  ok('content_brief writes package brief', brief.success === true && fs.existsSync(brief.brief_path));
  ok('content_brief records brief asset', rows.some(r => r.stream === 'assets' && r.payload.kind === 'brief'));

  const three = await writeThreejsScene({ name: 'selftest-scene', title: 'Selftest Scene', script: 'Show a rotating product concept.' }, { state: Promise.resolve(fakeState) });
  ok('write_threejs_scene writes html artifact', three.success === true && fs.existsSync(three.path));

  const asset = await recordAsset({ name: 'selftest-image', kind: 'image', status: 'draft', path: '/tmp/selftest.png', prompt: 'product image' }, { state: Promise.resolve(fakeState) });
  ok('record_asset records image asset', asset.success === true && asset.asset.kind === 'image');

  const listed = await listAssets({}, { state: Promise.resolve(fakeState) });
  ok('list_assets returns asset gallery', listed.success === true && listed.assets.length >= 3);
}

// ── Manim render_scene substrate ──
const SCENE = `from manim import *\n\nclass SelfTest(Scene):\n    def construct(self):\n        self.play(Create(Circle()))\n        self.wait()\n`;
{
  const bad = await renderScene({ name: 'Bad Name!', scene_class: 'SelfTest', code: SCENE });
  ok('render_scene rejects bad slug', bad.success === false);
  const mismatch = await renderScene({ name: 'selftest', scene_class: 'Other', code: SCENE });
  ok('render_scene rejects class mismatch', mismatch.success === false);
  const good = await renderScene({ name: 'selftest', scene_class: 'SelfTest', code: SCENE, quality: 'l' });
  ok('render_scene writes the scene file', good.success === true && fs.existsSync(good.scene_path));
  ok('render command targets manim CE', /^manim render -ql /.test(good.render_command));
  ok('render command includes on_complete guidance', good.output.includes('render-reviewer'));
}

// ── register_render + list_renders against the fake blackboard ──
{
  const reg = await registerRender(
    { name: 'selftest', scene_class: 'SelfTest', status: 'completed', video_path: '/tmp/x.mp4', duration_s: 12 },
    { state: fakeState },
  );
  ok('register_render records', reg.success === true && rows.some(r => r.stream === 'renders' && r.payload.name === 'selftest'));
  const listed = await listRenders({}, { state: fakeState });
  ok('list_renders returns the row', listed.success === true && listed.renders.length === 1 && listed.renders[0].name === 'selftest');
  const noState = await registerRender({ name: 'x', status: 'failed' }, {});
  ok('register_render fails gracefully without blackboard', noState.success === false);
}

// Cleanup the scene written into cwd
try { fs.rmSync(path.join(process.cwd(), '.bahulam', 'tmp', 'content-creation', 'renders', 'selftest'), { recursive: true, force: true }); } catch { /* ok */ }
try { fs.rmSync(path.join(process.cwd(), '.bahulam', 'tmp', 'content-creation', 'packages', 'selftest-package'), { recursive: true, force: true }); } catch { /* ok */ }
try { fs.rmSync(path.join(process.cwd(), '.bahulam', 'tmp', 'content-creation', 'threejs', 'selftest-scene'), { recursive: true, force: true }); } catch { /* ok */ }

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL CONTENT-CREATION SELFTESTS PASSED');
