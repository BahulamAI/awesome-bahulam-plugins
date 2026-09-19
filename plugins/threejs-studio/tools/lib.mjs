/**
 * Shared utility helpers for threejs-studio tools.
 *
 * Two responsibilities:
 *   1. Durable state helpers (SQLite + append streams).
 *   2. Scene DSL helpers — load, mutate, save, snapshot, regenerate.
 *
 * The DSL lives at <sceneDir>/scene.json and is the source of truth.
 * index.html is regenerated on every save via scene-compile.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function nowIso() {
  return new Date().toISOString();
}

// ── SQL state helpers ────────────────────────────────────────────────────
export function stateOf(options = {}) {
  return options.state || Promise.resolve(null);
}

export function hasSqlState(state) {
  return state && typeof state.query === 'function';
}

export function run(state, sql, params = []) {
  if (!hasSqlState(state)) return null;
  try { return state.query(sql, params); } catch { return null; }
}

export function rows(state, sql, params = []) {
  if (!hasSqlState(state)) return [];
  try { return state.query(sql, params) || []; } catch { return []; }
}

export function appendEvent(state, stream, payload) {
  if (!state || typeof state.append !== 'function') return false;
  try { state.append(stream, payload); return true; } catch { return false; }
}

export function appendStream(state, stream, ...entries) {
  if (!state || typeof state.append !== 'function') return false;
  for (const payload of entries) {
    try { state.append(stream, payload); } catch { /* skip */ }
  }
  return true;
}

export function intOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ── Scene folder resolution ──────────────────────────────────────────────
export function resolveSceneDir(slug, cwd) {
  const root = cwd ? path.resolve(String(cwd)) : process.cwd();
  return path.join(root, slug);
}

export function ensureSceneDir(slug, cwd) {
  const dir = resolveSceneDir(slug, cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });
  return dir;
}

export function scenePaths(slug, cwd) {
  const dir = resolveSceneDir(slug, cwd);
  return {
    dir,
    json: path.join(dir, 'scene.json'),
    html: path.join(dir, 'index.html'),
    assets: path.join(dir, 'assets'),
    snapshots: path.join(dir, 'snapshots'),
  };
}

// ── Scene DSL — shape ────────────────────────────────────────────────────
// {
//   version: 1,
//   slug, title, width, height,
//   background: "#0b1020" | { hdri: "assets/env.hdr", intensity: 1 },
//   tone: { mapping: "ACESFilmic", exposure: 1.0 },
//   camera: { type: "perspective", fov: 45, near: 0.1, far: 1000,
//             position: [5,4,8], target: [0,1,0] },
//   materials: { [id]: { type: "standard"|"physical"|"basic"|"lambert"|"phong"|"toon"|"normal"|"shader",
//                        color, roughness, metalness, emissive, opacity, transparent,
//                        map, normalMap, roughnessMap, metalnessMap, envMapIntensity, ...} },
//   nodes: [ { id, type, name?, parent?, position?, rotation?, scale?, castShadow?, receiveShadow?, ... } ],
//   scripts: [ { id, target, event, code } ],
//   physics: [ { id, target, body, mass, shape } ],
//   post: { bloom?, ssao?, outline?, vignette? },
//   meta: { created_at, updated_at }
// }
//
// Node types (kind → required extra fields):
//   mesh          { geometry: {type,params}, materialId }
//   group         { }
//   light         { light: {type,color,intensity,params,castShadow?} }
//   helper        { helper: {type,params} }
//   instanced     { geometry:{...}, materialId, count, instances: [{position,rotation,scale,color?}] }
//   points        { geometry:{...}, materialId, count }
//   line          { geometry:{...}, materialId, mode: "line"|"segments"|"loop" }
//   gltf          { asset: "assets/model.glb" }
//   text          { text, font?, size?, materialId }
//   sprite        { materialId }
//   csslabel      { text, className? }
//
// Geometry types:
//   box|sphere|cylinder|cone|torus|torusKnot|plane|circle|
//   tube (path points)|extrude|lathe|buffer (positions,normals,uvs,indices)

export function emptyScene({ slug, title, width = 800, height = 600 } = {}) {
  const t = nowIso();
  return {
    version: 1,
    slug,
    title: title || slug,
    width,
    height,
    background: '#0b1020',
    tone: { mapping: 'ACESFilmic', exposure: 1.0 },
    camera: {
      type: 'perspective',
      fov: 45,
      near: 0.1,
      far: 1000,
      position: [5, 4, 8],
      target: [0, 1, 0],
      controls: 'orbit',
    },
    materials: {
      default: { type: 'standard', color: '#8090a0', roughness: 0.6, metalness: 0.1 },
    },
    nodes: [
      {
        id: 'ambient', type: 'light',
        light: { type: 'ambient', color: '#404060', intensity: 0.5 },
      },
      {
        id: 'key', type: 'light',
        light: {
          type: 'directional', color: '#ffeedd', intensity: 2,
          position: [5, 10, 7], castShadow: true, target: [0, 0, 0],
        },
      },
      {
        id: 'grid', type: 'helper',
        helper: { type: 'grid', size: 20, divisions: 20, color1: '#444488', color2: '#333366' },
      },
    ],
    // Asset manifest: id -> { kind: "mesh"|"texture"|"gltf", path, provider, prompt? }
    assets: {},
    // Animation clips: { id, target, duration, loop, tracks: [{ property, times, values, interpolation? }] }
    animations: [],
    // Sandboxed event/tick scripts: { id, target?, event: "tick"|"click"|"hover", code }
    scripts: [],
    // cannon-es rigid-body specs: { id, target, shape, mass, position?, restitution?, friction? }
    physics: [],
    post: {},
    meta: { created_at: t, updated_at: t },
  };
}

export function loadScene(slug, cwd) {
  const p = scenePaths(slug, cwd);
  if (!fs.existsSync(p.json)) return null;
  try {
    return JSON.parse(fs.readFileSync(p.json, 'utf-8'));
  } catch { return null; }
}

/**
 * Save the scene DSL and regenerate index.html.
 * Also drops a snapshot into snapshots/<timestamp>.json.
 *
 *   opts.compile   - override compile fn (used only for tests). Defaults
 *                    to the real scene-compile.mjs.
 *   opts.snapshot  - default true. Pass false to skip snapshot write.
 */
export async function saveScene(scene, cwd, opts = {}) {
  if (!scene?.slug) throw new Error('saveScene: scene.slug required');
  scene.meta = scene.meta || {};
  scene.meta.updated_at = nowIso();
  if (!scene.meta.created_at) scene.meta.created_at = scene.meta.updated_at;

  const p = scenePaths(scene.slug, cwd);
  ensureSceneDir(scene.slug, cwd);

  fs.writeFileSync(p.json, JSON.stringify(scene, null, 2), 'utf-8');

  if (opts.snapshot !== false) {
    const ts = scene.meta.updated_at.replace(/[:.]/g, '-');
    const snapPath = path.join(p.snapshots, `${ts}.json`);
    try { fs.writeFileSync(snapPath, JSON.stringify(scene, null, 2), 'utf-8'); } catch { /* ignore */ }
  }

  const compile = opts.compile || (await import('./scene-compile.mjs')).compile;
  const html = compile(scene);
  fs.writeFileSync(p.html, html, 'utf-8');

  return p;
}

// ── DSL query & mutation primitives ──────────────────────────────────────
export function findNode(scene, id) {
  return scene.nodes?.find(n => n.id === id) || null;
}

export function removeNode(scene, id) {
  if (!scene.nodes) return false;
  const before = scene.nodes.length;
  scene.nodes = scene.nodes.filter(n => n.id !== id);
  // also detach children (they float to root unless parent set)
  for (const n of scene.nodes) if (n.parent === id) delete n.parent;
  return scene.nodes.length !== before;
}

export function genId(scene, prefix = 'n') {
  const used = new Set(scene.nodes?.map(n => n.id) || []);
  Object.keys(scene.materials || {}).forEach(id => used.add(id));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

// ── State row helpers (scenes table) ─────────────────────────────────────
export function upsertSceneRow(state, { slug, title, htmlPath, dslPath, width, height, status = 'draft' }) {
  if (!hasSqlState(state)) return;
  const now = nowIso();
  try {
    const existing = state.query('SELECT id FROM threejs_scenes WHERE slug = ?', [slug]) || [];
    if (existing.length) {
      state.query(
        `UPDATE threejs_scenes
           SET title = ?, html_path = ?, dsl_path = ?, width = ?, height = ?, status = ?, updated_at = ?
         WHERE slug = ?`,
        [title, htmlPath, dslPath, width, height, status, now, slug],
      );
    } else {
      state.query(
        `INSERT INTO threejs_scenes
           (slug, title, script, html_path, dsl_path, width, height, status, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
        [slug, title, htmlPath, dslPath, width, height, status, now, now],
      );
    }
  } catch { /* table may not exist in tests */ }
}
