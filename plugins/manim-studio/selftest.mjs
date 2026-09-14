/**
 * Offline smoke test for the manim-studio tool modules.
 * Run: node plugins/manim-studio/selftest.mjs
 * Probes for the render prerequisites (python3, manim, ffmpeg). Default
 * mode is offline. Set MANIM_STUDIO_PREFLIGHT=1 to require prerequisites
 * and run a real low-quality Manim render.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { call as renderScene } from './tools/render-scene.mjs';
import { call as registerRender } from './tools/register-render.mjs';
import { call as listRenders } from './tools/list-renders.mjs';
import { call as renderApprovalRecord } from './tools/render-approval-record.mjs';
import { call as renderReport } from './tools/render-report.mjs';

let failures = 0;
const preflight = process.env.MANIM_STUDIO_PREFLIGHT === '1';
const ok = (label, cond) => {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
};

// ── Prerequisite probes (warn-only) ──
const prereqs = new Map();
for (const [cmd, args] of [['python3', ['--version']], ['manim', ['--version']], ['ffmpeg', ['-version']]]) {
  const probe = spawnSync(cmd, args, { encoding: 'utf-8', timeout: 30000 });
  prereqs.set(cmd, probe.status === 0);
  if (probe.status === 0) console.log(`ok   prereq ${cmd}: ${String(probe.stdout || probe.stderr).split('\n')[0].trim()}`);
  else if (preflight) ok(`preflight prereq ${cmd}`, false);
  else console.warn(`warn prereq ${cmd} not found — renders will fail until installed`);
}

function makeFakeState() {
  const streams = [];
  const tables = {
    render_scenes: [],
    render_approvals: [],
    render_jobs: [],
  };
  const insert = (table, row) => {
    const next = { id: tables[table].length + 1, ...row };
    tables[table].push(next);
    return { lastInsertRowid: next.id };
  };
  return {
    tables,
    append: (stream, payload) => streams.push({ stream, payload, created_at: new Date().toISOString() }),
    list: (stream, opts = {}) => streams.filter(r => r.stream === stream).slice(0, opts.limit || 20),
    query: (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('INSERT INTO render_scenes')) {
        return insert('render_scenes', {
          slug: params[0],
          title: params[1],
          scene_class: params[2],
          quality: params[3],
          resolution: params[4],
          scene_path: params[5],
          script_path: params[6],
          manifest_path: params[7],
          expected_video: params[8],
          status: params[9],
          created_at: params[10],
          updated_at: params[11],
        });
      }
      if (compact.startsWith('INSERT INTO render_approvals')) {
        return insert('render_approvals', {
          scene_id: params[0],
          slug: params[1],
          reviewer: params[2],
          decision: params[3],
          notes: params[4],
          approved_script_path: params[5],
          created_at: params[6],
        });
      }
      if (compact.startsWith('INSERT INTO render_jobs')) {
        return insert('render_jobs', {
          scene_id: params[0],
          slug: params[1],
          status: params[2],
          video_path: params[3],
          duration_s: params[4],
          notes: params[5],
          created_at: params[6],
          completed_at: params[7],
        });
      }
      if (compact.startsWith('SELECT id FROM render_scenes WHERE slug = ?')) {
        return tables.render_scenes.filter(r => r.slug === params[0]).slice(-1);
      }
      if (compact.startsWith('SELECT * FROM render_scenes WHERE slug = ?')) {
        return tables.render_scenes.filter(r => r.slug === params[0]).slice(0, 20);
      }
      if (compact.startsWith('SELECT * FROM render_jobs WHERE slug = ?')) {
        return tables.render_jobs.filter(r => r.slug === params[0]).slice(0, 20);
      }
      if (compact.startsWith('SELECT * FROM render_approvals WHERE slug = ?')) {
        return tables.render_approvals.filter(r => r.slug === params[0]).slice(0, 20);
      }
      if (compact.startsWith('SELECT * FROM render_scenes ORDER BY')) {
        return tables.render_scenes.slice().reverse().slice(0, params[0] || 20);
      }
      if (compact.startsWith('SELECT * FROM render_jobs ORDER BY')) {
        return tables.render_jobs.slice().reverse().slice(0, params[0] || 20);
      }
      if (compact.startsWith('SELECT * FROM render_approvals ORDER BY')) {
        return tables.render_approvals.slice().reverse().slice(0, params[0] || 20);
      }
      if (compact.startsWith('UPDATE render_scenes SET status = ?')) {
        for (const row of tables.render_scenes) {
          if (row.slug === params[2]) {
            row.status = params[0];
            row.updated_at = params[1];
          }
        }
        return { changes: tables.render_scenes.filter(r => r.slug === params[2]).length };
      }
      throw new Error(`Unhandled fake SQL: ${compact}`);
    },
  };
}

const fakeState = makeFakeState();

// ── render_scene ──
const SCENE = `from manim import *\n\nclass SelfTest(Scene):\n    def construct(self):\n        self.play(Create(Circle()))\n        self.wait()\n`;
let goodRender = null;
{
  const bad = await renderScene({ name: 'Bad Name!', scene_class: 'SelfTest', code: SCENE });
  ok('render_scene rejects bad slug', bad.success === false);
  const mismatch = await renderScene({ name: 'selftest', scene_class: 'Other', code: SCENE });
  ok('render_scene rejects class mismatch', mismatch.success === false);
  const good = await renderScene({ name: 'selftest', scene_class: 'SelfTest', code: SCENE, quality: 'l', script: 'Approved smoke-test script.' }, { state: fakeState });
  goodRender = good;
  ok('render_scene writes the scene file', good.success === true && fs.existsSync(good.scene_path));
  ok('render command targets manim CE', /^manim render -ql /.test(good.render_command));
  ok('render command includes on_complete guidance', good.output.includes('render-reviewer'));
  ok('render_scene records durable scene state', fakeState.tables.render_scenes.length === 1 && fakeState.tables.render_scenes[0].slug === 'selftest');
}

// ── optional release preflight: execute Manim and verify MP4 output ──
if (preflight && goodRender?.success && [...prereqs.values()].every(Boolean)) {
  const run = spawnSync(goodRender.render_command, {
    shell: true,
    encoding: 'utf-8',
    timeout: 120000,
    cwd: process.cwd(),
  });
  ok('preflight render command exits 0', run.status === 0);
  ok('preflight render writes expected mp4', fs.existsSync(goodRender.expected_video));
}

// ── approval + register_render + list_renders/report against fake state ──
{
  const approval = await renderApprovalRecord(
    { slug: 'selftest', reviewer: 'user', decision: 'approved', notes: 'Looks good for draft render.' },
    { state: fakeState },
  );
  ok('render_approval_record records approval', approval.success === true && fakeState.tables.render_approvals.length === 1);
  const reg = await registerRender(
    { name: 'selftest', scene_class: 'SelfTest', status: 'completed', video_path: '/tmp/x.mp4', duration_s: 12 },
    { state: fakeState },
  );
  ok('register_render records durable job', reg.success === true && fakeState.tables.render_jobs.length === 1);
  const listed = await listRenders({}, { state: fakeState });
  ok('list_renders returns the row', listed.success === true && listed.renders.length === 1 && listed.renders[0].slug === 'selftest');
  const report = await renderReport({ slug: 'selftest' }, { state: fakeState });
  ok('render_report returns evidence', report.success === true && report.output.ready_for_user === true && report.output.inventory.approvals === 1);
  const noState = await registerRender({ name: 'x', status: 'failed' }, {});
  ok('register_render fails gracefully without blackboard', noState.success === false);
}

// Cleanup the scene written into cwd
try { fs.rmSync(path.join(process.cwd(), '.bahulam', 'tmp', 'manim', 'manim-studio', 'renders', 'selftest'), { recursive: true, force: true }); } catch { /* ok */ }

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL MANIM-STUDIO SELFTESTS PASSED');
