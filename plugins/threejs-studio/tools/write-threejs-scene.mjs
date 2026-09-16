/**
 * write-threejs-scene tool — creates a self-contained Three.js HTML scene.
 *
 * Parameters:
 *   name        - slug (a-z0-9-)
 *   title       - human-readable title
 *   script      - the Three.js JS code (injected into module script block)
 *   html        - optional full HTML override (if provided, script is ignored)
 *   width       - optional canvas width (default 800)
 *   height      - optional canvas height (default 600)
 *   cwd         - optional output directory (defaults to process.cwd()).
 *                 Writes to <cwd>/<slug>/index.html. The path is recorded in
 *                 SQLite state so the panel can link to it.
 *
 * Returns: { success, output: { name, kind, path, title }, path }
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { nowIso } from './lib.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const THREE_VERSION = '0.170.0';

function starterHtml(title, script, width = 800, height = 600) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
html,body{margin:0;height:100%;background:#0b1020;color:#f8fafc;font-family:Inter,system-ui,sans-serif;overflow:hidden}
body{display:flex;align-items:center;justify-content:center}
canvas{display:block}
#label{position:fixed;left:24px;bottom:24px;max-width:520px;pointer-events:none}
h1{font-size:28px;margin:0 0 8px}p{margin:0;color:#cbd5e1;line-height:1.45}
#info{position:fixed;right:24px;top:24px;font-size:12px;color:#64748b;text-align:right;max-width:280px}
</style>
</head>
<body>
<div id="label"><h1>${title}</h1></div>
<div id="info">Three.js ${THREE_VERSION} · interactive 3D</div>

<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@${THREE_VERSION}/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@${THREE_VERSION}/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Default scene setup ──────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);

const camera = new THREE.PerspectiveCamera(45, ${width}/${height}, 0.1, 1000);
camera.position.set(5, 4, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(${width}, ${height});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

// ── Lights ───────────────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0x404060, 0.5);
scene.add(ambient);

const mainLight = new THREE.DirectionalLight(0xffeedd, 2);
mainLight.position.set(5, 10, 7);
mainLight.castShadow = true;
mainLight.shadow.mapSize.width = 1024;
mainLight.shadow.mapSize.height = 1024;
scene.add(mainLight);

const fill = new THREE.DirectionalLight(0x4488ff, 0.4);
fill.position.set(-3, 2, 4);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffaa44, 0.3);
rim.position.set(-2, -1, -5);
scene.add(rim);

// ── Helpers ──────────────────────────────────────────────────────────
const grid = new THREE.GridHelper(20, 20, 0x444488, 0x333366);
scene.add(grid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1, 0);

// ── Resize ───────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ── User scene script ────────────────────────────────────────────────
// BEGIN USER SCENE
${script}
// END USER SCENE

// ── Render loop ──────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>`;
}

export async function call(args = {}, options = {}) {
  const { name, title, script, html, width = 800, height = 600, cwd } = args;

  // Validate
  if (!name || !SLUG_RE.test(name)) {
    return { success: false, output: `Invalid slug "${name}". Use lowercase alphanumeric + hyphens.` };
  }
  if (html && typeof html !== 'string') {
    return { success: false, output: '`html` must be a string if provided.' };
  }
  if (!html && (!title || !script)) {
    return { success: false, output: 'Either `html` (full document) or both `title` + `script` are required.' };
  }
  if (html && !title) {
    return { success: false, output: '`title` is required even with `html` override.' };
  }

  // Resolve content
  const content = html
    ? html
    : starterHtml(title, script, width, height);

  // Resolve output directory — always relative to `cwd` (defaults to process.cwd())
  const root = cwd ? path.resolve(String(cwd)) : process.cwd();
  const scenesDir = path.join(root, name);

  fs.mkdirSync(scenesDir, { recursive: true });
  const htmlPath = path.join(scenesDir, 'index.html');
  fs.writeFileSync(htmlPath, content, 'utf-8');

  const result = {
    success: true,
    output: {
      name,
      kind: 'threejs',
      path: htmlPath,
      title: title || name,
    },
    path: htmlPath,
  };

  // Record in state if available
  const state = options?.state ? await options.state : null;
  if (state) {
    const created = nowIso();
    // SQL state
    if (typeof state.query === 'function') {
      try {
        state.query(
          `INSERT INTO threejs_scenes (slug, title, script, html_path, width, height, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
          [name, title || name, script || '', htmlPath, width, height, created, created],
        );
      } catch { /* skip if table missing */ }
    }
    // Stream state
    if (typeof state.append === 'function') {
      state.append('scenes', {
        name, kind: 'threejs', path: htmlPath, title: title || name, status: 'draft', created_at: created,
      });
    }
  }

  return result;
}