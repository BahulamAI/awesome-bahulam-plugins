/**
 * Offline smoke test for threejs-studio tool modules.
 * Run: node plugins/threejs-studio/selftest.mjs
 * No prerequisites — Three.js loads from CDN at view time.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { call as writeThreejsScene } from './tools/write-threejs-scene.mjs';
import { call as registerRender } from './tools/register-render.mjs';
import { call as listRenders } from './tools/list-renders.mjs';
import { call as renderApprovalRecord } from './tools/render-approval-record.mjs';
import { call as renderReport } from './tools/render-report.mjs';

let failures = 0;
const ok = (label, cond) => {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
};

// ── Fake state (streams + SQL) ──────────────────────────────────────────
const streams = [];
const tables = { threejs_scenes: [], threejs_approvals: [], threejs_jobs: [] };
const insert = (table, row) => {
  const next = { id: tables[table].length + 1, ...row };
  tables[table].push(next);
  return { lastInsertRowid: next.id };
};
const fakeState = {
  tables,
  append: (stream, payload) => streams.push({ stream, payload, created_at: new Date().toISOString() }),
  list: (stream, opts = {}) => streams.filter(r => r.stream === stream).slice(0, opts.limit || 20),
  query: (sql, params = []) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('INSERT INTO threejs_scenes')) {
      return insert('threejs_scenes', {
        slug: params[0], title: params[1], script: params[2], html_path: params[3],
        width: params[4], height: params[5], status: params[6], created_at: params[7], updated_at: params[8],
      });
    }
    if (compact.startsWith('INSERT INTO threejs_approvals')) {
      return insert('threejs_approvals', {
        slug: params[0], reviewer: params[1], decision: params[2], notes: params[3],
        approved_script_path: params[4], created_at: params[5],
      });
    }
    if (compact.startsWith('INSERT INTO threejs_jobs')) {
      return insert('threejs_jobs', {
        slug: params[0], status: params[1], html_path: params[2], notes: params[3],
        created_at: params[4], completed_at: params[5],
      });
    }
    if (compact.startsWith('UPDATE threejs_scenes SET')) {
      for (const row of tables.threejs_scenes) {
        if (row.slug === params[2]) { row.status = params[0]; row.updated_at = params[1]; }
      }
      return { changes: tables.threejs_scenes.filter(r => r.slug === params[2]).length };
    }
    if (compact.startsWith('SELECT * FROM threejs_scenes WHERE slug = ?')) {
      return tables.threejs_scenes.filter(r => r.slug === params[0]).slice(0, 20);
    }
    if (compact.startsWith('SELECT * FROM threejs_scenes ORDER BY id DESC')) {
      return tables.threejs_scenes.slice().reverse().slice(0, params[0] || 20);
    }
    if (compact.startsWith('SELECT id FROM threejs_scenes WHERE slug = ?')) {
      return tables.threejs_scenes.filter(r => r.slug === params[0]).slice(-1);
    }
    if (compact.startsWith('SELECT * FROM threejs_approvals')) {
      return tables.threejs_approvals.filter(r => r.slug === params[0]).slice(0, 20);
    }
    if (compact.startsWith('SELECT * FROM threejs_jobs')) {
      return tables.threejs_jobs.filter(r => r.slug === params[0]).slice(0, 20);
    }
    throw new Error(`Unhandled fake SQL: ${compact}`);
  },
};

// ── write_threejs_scene ─────────────────────────────────────────────────
{
  const bad = await writeThreejsScene({ name: 'Bad Name!' }, { state: fakeState });
  ok('write_threejs_scene rejects bad slug', bad.success === false);

  const good = await writeThreejsScene(
    { name: 'selftest', title: 'Selftest Scene', script: 'const box = new THREE.Mesh(new THREE.BoxGeometry(2,2,2), new THREE.MeshStandardMaterial({color:0x4488ff}));\nbox.position.y = 1;\nscene.add(box);' },
    { state: fakeState },
  );
  ok('write_threejs_scene writes HTML file', good.success === true && fs.existsSync(good.path));
  ok('write_threejs_scene returns path', good.path.endsWith('index.html'));
  ok('write_threejs_scene records state', fakeState.tables.threejs_scenes.length === 1 && fakeState.tables.threejs_scenes[0].slug === 'selftest');
}

// ── register_render ─────────────────────────────────────────────────────
{
  const reg = await registerRender(
    { name: 'selftest', status: 'completed', html_path: '/tmp/selftest.html', notes: 'Verified. Scene has lights, resize handler, Three.js CDN import.' },
    { state: fakeState },
  );
  ok('register_render records job', reg.success === true && fakeState.tables.threejs_jobs.length === 1);
  const noState = await registerRender({ name: 'x', status: 'failed' }, {});
  ok('register_render fails gracefully without state', noState.success === false);
}

// ── list_renders ────────────────────────────────────────────────────────
{
  const listed = await listRenders({}, { state: fakeState });
  ok('list_renders returns scene', listed.success === true && listed.renders.length >= 1);
  // May return from state tables or stream; either is fine as long as data is present
  ok('list_renders has slug', listed.renders.some(r => (r.slug || r.name) === 'selftest'));
}

// ── render_approval_record ──────────────────────────────────────────────
{
  const app = await renderApprovalRecord(
    { slug: 'selftest', reviewer: 'user', decision: 'approved', notes: 'Looks good, proceed.' },
    { state: fakeState },
  );
  ok('render_approval_record records decision', app.success === true && fakeState.tables.threejs_approvals.length === 1);
}

// ── render_report ───────────────────────────────────────────────────────
{
  const report = await renderReport({ slug: 'selftest' }, { state: fakeState });
  ok('render_report returns evidence', report.success === true);
}

// ── Cleanup ─────────────────────────────────────────────────────────────
try {
  // selftest was written to process.cwd()/selftest/ since no cwd was passed
  const sceneDir = path.join(process.cwd(), 'selftest');
  fs.rmSync(sceneDir, { recursive: true, force: true });
  const videoDir = path.join(process.cwd(), 'videos');
  if (fs.existsSync(videoDir)) fs.rmSync(videoDir, { recursive: true, force: true });
} catch { /* ok */ }

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL THREEJS-STUDIO SELFTESTS PASSED');