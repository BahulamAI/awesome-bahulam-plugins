/**
 * Offline smoke test for threejs-studio tool modules.
 * Run: node plugins/threejs-studio/selftest.mjs
 * No prerequisites — Three.js loads from CDN at view time.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Legacy tools (still exported)
import { call as writeThreejsScene } from './tools/write-threejs-scene.mjs';
import { call as registerRender } from './tools/register-render.mjs';
import { call as listRenders } from './tools/list-renders.mjs';
import { call as renderApprovalRecord } from './tools/render-approval-record.mjs';
import { call as renderReport } from './tools/render-report.mjs';

// New compositional tools
import { call as createScene } from './tools/create-scene.mjs';
import { call as getScene } from './tools/get-scene.mjs';
import { call as snapshotScene } from './tools/snapshot-scene.mjs';
import { call as createNode } from './tools/create-node.mjs';
import { call as setTransform } from './tools/set-transform.mjs';
import { call as reparentNode } from './tools/reparent-node.mjs';
import { call as deleteNode } from './tools/delete-node.mjs';
import { call as alignNodes } from './tools/align-nodes.mjs';
import { call as measureBounds } from './tools/measure-bounds.mjs';
import { call as createMaterial } from './tools/create-material.mjs';
import { call as setMaterialProperty } from './tools/set-material-property.mjs';
import { call as assignMaterial } from './tools/assign-material.mjs';
import { call as addLight } from './tools/add-light.mjs';
import { call as setEnvironment } from './tools/set-environment.mjs';
import { call as setExposure } from './tools/set-exposure.mjs';
import { call as setCamera } from './tools/set-camera.mjs';
import { call as frameScene } from './tools/frame-scene.mjs';

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
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
        dsl_path: params[4], width: params[5], height: params[6],
        status: params[7], created_at: params[8], updated_at: params[9],
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
    if (compact.startsWith('UPDATE threejs_scenes SET title')) {
      // upsertSceneRow update path
      const [title, htmlPath, dslPath, width, height, status, updated, slug] = params;
      for (const row of tables.threejs_scenes) {
        if (row.slug === slug) {
          row.title = title; row.html_path = htmlPath; row.dsl_path = dslPath;
          row.width = width; row.height = height; row.status = status; row.updated_at = updated;
        }
      }
      return { changes: tables.threejs_scenes.filter(r => r.slug === slug).length };
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

// ── Sandbox workspace ───────────────────────────────────────────────────
const sandbox = path.join(process.cwd(), '.threejs-studio-selftest');
fs.rmSync(sandbox, { recursive: true, force: true });
fs.mkdirSync(sandbox, { recursive: true });
const cwd = sandbox;

// ── Legacy write_threejs_scene ──────────────────────────────────────────
{
  const bad = await writeThreejsScene({ name: 'Bad Name!' }, { state: fakeState });
  ok('legacy: write_threejs_scene rejects bad slug', bad.success === false);

  const good = await writeThreejsScene(
    { name: 'legacy', title: 'Legacy Scene', script: 'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color:0x4488ff})));', cwd },
    { state: fakeState },
  );
  ok('legacy: write_threejs_scene writes HTML', good.success === true && fs.existsSync(good.path));
}

// ── DSL: create_scene ───────────────────────────────────────────────────
{
  const bad = await createScene({ name: 'Bad!' }, { state: fakeState });
  ok('create_scene rejects bad slug', bad.success === false);

  const scene = await createScene({ name: 'cafe', title: 'Cafe Corner', width: 1024, height: 720, cwd }, { state: fakeState });
  ok('create_scene succeeds', scene.success === true);
  const sceneDir = path.join(cwd, 'cafe');
  ok('create_scene writes scene.json', fs.existsSync(path.join(sceneDir, 'scene.json')));
  ok('create_scene writes index.html', fs.existsSync(path.join(sceneDir, 'index.html')));
  const dsl = JSON.parse(fs.readFileSync(path.join(sceneDir, 'scene.json'), 'utf-8'));
  ok('scene.json has default lights + grid', dsl.nodes.some(n => n.id === 'ambient') && dsl.nodes.some(n => n.id === 'grid'));
  const html = fs.readFileSync(path.join(sceneDir, 'index.html'), 'utf-8');
  ok('compiled HTML includes THREE import', html.includes(`import * as THREE from 'three'`));
  ok('compiled HTML includes canvas / renderer', html.includes('new THREE.WebGLRenderer'));
}

// ── DSL: create_node (mesh + light + group) ─────────────────────────────
{
  const table = await createNode({
    slug: 'cafe', type: 'mesh', id: 'table',
    geometry: { type: 'box', params: { width: 1.6, height: 0.05, depth: 0.9 } },
    position: [0, 0.72, 0], receiveShadow: true, cwd,
  }, { state: fakeState });
  ok('create_node mesh succeeds', table.success === true && table.output.id === 'table');

  const chair = await createNode({
    slug: 'cafe', type: 'mesh', id: 'chair_1',
    geometry: { type: 'box', params: { width: 0.45, height: 0.9, depth: 0.45 } },
    position: [0.9, 0.45, 0], castShadow: true, cwd,
  }, { state: fakeState });
  ok('create_node chair_1', chair.success);

  const chair2 = await createNode({
    slug: 'cafe', type: 'mesh', id: 'chair_2',
    geometry: { type: 'box', params: { width: 0.45, height: 0.9, depth: 0.45 } },
    position: [-0.9, 0.45, 0], castShadow: true, cwd,
  }, { state: fakeState });
  ok('create_node chair_2', chair2.success);

  const dup = await createNode({
    slug: 'cafe', type: 'mesh', id: 'table',
    geometry: { type: 'box', params: { width: 1, height: 1, depth: 1 } }, cwd,
  }, { state: fakeState });
  ok('create_node rejects duplicate id', dup.success === false);
}

// ── DSL: get_scene ──────────────────────────────────────────────────────
{
  const summary = await getScene({ slug: 'cafe', cwd });
  ok('get_scene returns summary', summary.success === true);
  ok('summary lists nodes', summary.output.nodes.some(n => n.id === 'table'));
  const full = await getScene({ slug: 'cafe', cwd, full: true });
  ok('get_scene full returns raw DSL', full.success && Array.isArray(full.output.nodes));
}

// ── DSL: set_transform / reparent_node / align_nodes / measure_bounds ──
{
  const moved = await setTransform({ slug: 'cafe', id: 'chair_1', position: [1.2, 0.45, 0.3], cwd }, { state: fakeState });
  ok('set_transform succeeds', moved.success && JSON.stringify(moved.output.position) === '[1.2,0.45,0.3]');

  const bounds = await measureBounds({ slug: 'cafe', ids: ['table', 'chair_1', 'chair_2'], cwd });
  ok('measure_bounds returns size', bounds.success && bounds.output.size.every(v => v > 0));

  const aligned = await alignNodes({ slug: 'cafe', ids: ['chair_1', 'chair_2'], axis: 'y', mode: 'center', cwd }, { state: fakeState });
  ok('align_nodes centers on Y', aligned.success && aligned.output.updated.every(u => u.position[1] === aligned.output.updated[0].position[1]));

  const grp = await createNode({ slug: 'cafe', type: 'group', id: 'chairs', cwd }, { state: fakeState });
  ok('create_node group', grp.success);
  const rp1 = await reparentNode({ slug: 'cafe', id: 'chair_1', parent: 'chairs', cwd }, { state: fakeState });
  const rp2 = await reparentNode({ slug: 'cafe', id: 'chair_2', parent: 'chairs', cwd }, { state: fakeState });
  ok('reparent_node moves chairs under group', rp1.success && rp2.success);

  const badP = await reparentNode({ slug: 'cafe', id: 'chair_1', parent: 'nope', cwd }, { state: fakeState });
  ok('reparent_node rejects missing parent', badP.success === false);
}

// ── DSL: materials ─────────────────────────────────────────────────────
{
  const mat = await createMaterial({
    slug: 'cafe', id: 'leather_red', type: 'physical',
    color: '#8b1a1a', roughness: 0.7, metalness: 0, clearcoat: 0.2, cwd,
  }, { state: fakeState });
  ok('create_material physical', mat.success && mat.output.material.type === 'physical');

  const patched = await setMaterialProperty({ slug: 'cafe', id: 'leather_red', patch: { roughness: 0.5 }, cwd }, { state: fakeState });
  ok('set_material_property updates roughness', patched.success && patched.output.material.roughness === 0.5);

  const assigned = await assignMaterial({ slug: 'cafe', node_ids: ['chair_1', 'chair_2'], material_id: 'leather_red', cwd }, { state: fakeState });
  ok('assign_material binds material to chairs', assigned.success && assigned.output.updated.length === 2);

  const missingMat = await assignMaterial({ slug: 'cafe', node_ids: ['chair_1'], material_id: 'ghost', cwd }, { state: fakeState });
  ok('assign_material rejects missing material', missingMat.success === false);
}

// ── DSL: lighting + environment + exposure ─────────────────────────────
{
  const sun = await addLight({
    slug: 'cafe', id: 'sun', type: 'directional', color: '#fff5e0',
    intensity: 3, position: [8, 12, 6], castShadow: true, cwd,
  }, { state: fakeState });
  ok('add_light directional', sun.success && sun.output.id === 'sun');

  const env = await setEnvironment({ slug: 'cafe', color: '#1c1f2a', cwd }, { state: fakeState });
  ok('set_environment color', env.success && env.output.background === '#1c1f2a');

  const exp = await setExposure({ slug: 'cafe', exposure: 1.15, mapping: 'ACESFilmic', cwd }, { state: fakeState });
  ok('set_exposure', exp.success && exp.output.tone.exposure === 1.15);
}

// ── DSL: camera + frame ────────────────────────────────────────────────
{
  const cam = await setCamera({ slug: 'cafe', fov: 40, controls: 'orbit', cwd }, { state: fakeState });
  ok('set_camera fov', cam.success && cam.output.camera.fov === 40);

  const framed = await frameScene({ slug: 'cafe', padding: 1.6, cwd }, { state: fakeState });
  ok('frame_scene sets camera', framed.success && Array.isArray(framed.output.camera.position));
}

// ── DSL: snapshot + delete_node ────────────────────────────────────────
{
  const snap = await snapshotScene({ slug: 'cafe', label: 'before-cleanup', cwd });
  ok('snapshot_scene writes file', snap.success && fs.existsSync(snap.output.snapshot_path));

  const del = await deleteNode({ slug: 'cafe', id: 'chairs', recursive: true, cwd }, { state: fakeState });
  ok('delete_node recursive removes group + kids', del.success && del.output.removed.includes('chairs') && del.output.removed.includes('chair_1'));

  const summary = await getScene({ slug: 'cafe', cwd });
  ok('after delete, chairs group is gone', summary.success && !summary.output.nodes.some(n => n.id === 'chairs'));
}

// ── Final compile — HTML still valid after mutations ───────────────────
{
  const html = fs.readFileSync(path.join(cwd, 'cafe', 'index.html'), 'utf-8');
  ok('final HTML has camera position', html.includes('camera.position.set'));
  ok('final HTML references leather_red material factory', html.includes('leather_red'));
  ok('final HTML has directional light from sun', html.includes('DirectionalLight'));
}

// ── State-facing legacy tools still work ───────────────────────────────
{
  const reg = await registerRender(
    { name: 'cafe', status: 'completed', html_path: path.join(cwd, 'cafe', 'index.html'), notes: 'Verified. Lights, resize, materials, camera.' },
    { state: fakeState },
  );
  ok('register_render records job', reg.success === true);

  const listed = await listRenders({}, { state: fakeState });
  ok('list_renders returns cafe scene', listed.success === true && listed.renders.some(r => (r.slug || r.name) === 'cafe'));

  const approval = await renderApprovalRecord(
    { slug: 'cafe', reviewer: 'user', decision: 'approved', notes: 'Plan ok.' },
    { state: fakeState },
  );
  ok('render_approval_record records decision', approval.success === true);

  const report = await renderReport({ slug: 'cafe' }, { state: fakeState });
  ok('render_report returns evidence', report.success === true);
}

// ── Cleanup ─────────────────────────────────────────────────────────────
try {
  fs.rmSync(sandbox, { recursive: true, force: true });
  const oldVideoDir = path.join(process.cwd(), 'videos');
  if (fs.existsSync(oldVideoDir)) fs.rmSync(oldVideoDir, { recursive: true, force: true });
} catch { /* ok */ }

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL THREEJS-STUDIO SELFTESTS PASSED');
