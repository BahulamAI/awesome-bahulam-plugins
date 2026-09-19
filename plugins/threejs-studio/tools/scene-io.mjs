/**
 * scene-io.mjs — high-level scene load/save wrapper.
 *
 * Not exposed to agents directly; the plugin.yaml tools `create_scene`
 * and `get_scene` call into helpers here. Individual mutation tools
 * (create-node, set-transform, ...) also use loadOrCreate/saveAndSync.
 */
import fs from 'node:fs';
import {
  emptyScene, loadScene, saveScene, scenePaths, ensureSceneDir,
  appendEvent, upsertSceneRow, SLUG_RE, nowIso,
} from './lib.mjs';

/**
 * Load a scene by slug from <cwd>/<slug>/scene.json; if missing, create a
 * fresh empty scene and persist it. Returns the scene object.
 */
export async function loadOrCreate({ slug, title, width, height, cwd }) {
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid slug "${slug}"`);
  let scene = loadScene(slug, cwd);
  if (!scene) {
    scene = emptyScene({ slug, title: title || slug, width, height });
    ensureSceneDir(slug, cwd);
    await saveScene(scene, cwd, { snapshot: false });
  }
  return scene;
}

/**
 * Save a scene and update the plugin's SQL state row + stream.
 * Returns the {dir, json, html, ...} paths object.
 */
export async function saveAndSync(scene, cwd, options = {}) {
  const paths = await saveScene(scene, cwd, options);
  const state = options?.state ? await options.state : null;
  if (state) {
    upsertSceneRow(state, {
      slug: scene.slug,
      title: scene.title,
      htmlPath: paths.html,
      dslPath: paths.json,
      width: scene.width,
      height: scene.height,
      status: scene.status || 'draft',
    });
    appendEvent(state, 'scenes', {
      name: scene.slug,
      kind: 'threejs',
      path: paths.html,
      dsl_path: paths.json,
      title: scene.title,
      status: scene.status || 'draft',
      created_at: nowIso(),
    });
  }
  return paths;
}

// ── tool: create_scene ───────────────────────────────────────────────────
// Creates a fresh scene folder + scene.json + compiled index.html.
export async function callCreateScene(args = {}, options = {}) {
  const { name, title, width = 800, height = 600, cwd } = args;
  if (!name || !SLUG_RE.test(name)) {
    return { success: false, output: `Invalid slug "${name}". Use lowercase alphanumeric + hyphens.` };
  }
  const scene = emptyScene({ slug: name, title: title || name, width, height });
  const paths = await saveAndSync(scene, cwd, { ...options, snapshot: false });
  return {
    success: true,
    output: {
      slug: name,
      title: scene.title,
      dsl_path: paths.json,
      html_path: paths.html,
      scene,
    },
  };
}

// ── tool: get_scene ──────────────────────────────────────────────────────
// Returns a compact snapshot of the scene DSL for agent context.
export async function callGetScene(args = {}) {
  const { slug, cwd, full = false } = args;
  if (!slug) return { success: false, output: '`slug` is required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found. Call create_scene first.` };

  if (full) {
    return { success: true, output: scene };
  }

  // compact summary — designed to fit small LLM context windows
  const nodesSummary = (scene.nodes || []).map(n => ({
    id: n.id, type: n.type,
    ...(n.name ? { name: n.name } : {}),
    ...(n.parent ? { parent: n.parent } : {}),
    ...(n.position ? { pos: n.position } : {}),
    ...(n.materialId ? { mat: n.materialId } : {}),
    ...(n.light ? { light: n.light.type } : {}),
    ...(n.geometry ? { geo: n.geometry.type } : {}),
  }));
  const materialsSummary = Object.entries(scene.materials || {}).map(([id, m]) => ({
    id, type: m.type, color: m.color,
    ...(m.roughness != null ? { roughness: m.roughness } : {}),
    ...(m.metalness != null ? { metalness: m.metalness } : {}),
  }));
  return {
    success: true,
    output: {
      slug: scene.slug,
      title: scene.title,
      size: [scene.width, scene.height],
      camera: scene.camera,
      background: scene.background,
      tone: scene.tone,
      nodes: nodesSummary,
      materials: materialsSummary,
      scriptCount: (scene.scripts || []).length,
      physicsCount: (scene.physics || []).length,
      dsl_path: scenePaths(scene.slug, cwd).json,
      html_path: scenePaths(scene.slug, cwd).html,
    },
  };
}

// Tool entry points expected by plugin.yaml
export const call = callCreateScene;

export async function callSnapshot(args = {}, options = {}) {
  const { slug, cwd, label } = args;
  if (!slug) return { success: false, output: '`slug` is required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  const paths = scenePaths(slug, cwd);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const name = label ? `${ts}-${String(label).replace(/[^a-z0-9-_]/gi, '_')}.json` : `${ts}.json`;
  const snapPath = `${paths.snapshots}/${name}`;
  fs.writeFileSync(snapPath, JSON.stringify(scene, null, 2), 'utf-8');
  return { success: true, output: { snapshot_path: snapPath } };
}
