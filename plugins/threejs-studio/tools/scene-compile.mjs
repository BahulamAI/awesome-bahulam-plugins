/**
 * scene-compile.mjs — DSL → self-contained Three.js HTML.
 *
 * The DSL is described in tools/lib.mjs (emptyScene). This file is
 * intentionally the ONLY place that emits Three.js source; all mutation
 * tools produce scene.json and call this compiler through saveScene.
 *
 * Keep the emitted HTML string-literal-clean so scenes remain valid when
 * pretty-printed / diffed / re-hosted.
 */

const THREE_VERSION = '0.170.0';

// ── helpers ──────────────────────────────────────────────────────────────
const j = (v) => JSON.stringify(v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const vec3 = (v, d = [0, 0, 0]) => {
  if (!Array.isArray(v)) return `[${d.join(',')}]`;
  return `[${num(v[0], d[0])},${num(v[1], d[1])},${num(v[2], d[2])}]`;
};

function colorLiteral(c, fallback = '#ffffff') {
  const s = typeof c === 'string' ? c : fallback;
  return j(s);
}

// ── geometry emit ────────────────────────────────────────────────────────
function emitGeometry(geo = {}) {
  const t = String(geo.type || 'box').toLowerCase();
  const p = geo.params || geo;
  switch (t) {
    case 'box':
      return `new THREE.BoxGeometry(${num(p.width, 1)},${num(p.height, 1)},${num(p.depth, 1)},${num(p.widthSegments, 1)},${num(p.heightSegments, 1)},${num(p.depthSegments, 1)})`;
    case 'sphere':
      return `new THREE.SphereGeometry(${num(p.radius, 1)},${num(p.widthSegments, 32)},${num(p.heightSegments, 16)})`;
    case 'cylinder':
      return `new THREE.CylinderGeometry(${num(p.radiusTop, 1)},${num(p.radiusBottom, 1)},${num(p.height, 1)},${num(p.radialSegments, 32)})`;
    case 'cone':
      return `new THREE.ConeGeometry(${num(p.radius, 1)},${num(p.height, 1)},${num(p.radialSegments, 32)})`;
    case 'torus':
      return `new THREE.TorusGeometry(${num(p.radius, 1)},${num(p.tube, 0.4)},${num(p.radialSegments, 16)},${num(p.tubularSegments, 64)})`;
    case 'torusknot':
      return `new THREE.TorusKnotGeometry(${num(p.radius, 1)},${num(p.tube, 0.4)},${num(p.tubularSegments, 100)},${num(p.radialSegments, 16)})`;
    case 'plane':
      return `new THREE.PlaneGeometry(${num(p.width, 1)},${num(p.height, 1)},${num(p.widthSegments, 1)},${num(p.heightSegments, 1)})`;
    case 'circle':
      return `new THREE.CircleGeometry(${num(p.radius, 1)},${num(p.segments, 32)})`;
    case 'buffer': {
      const parts = [];
      parts.push(`(() => { const g = new THREE.BufferGeometry();`);
      if (p.positions) parts.push(`g.setAttribute('position', new THREE.Float32BufferAttribute(${j(p.positions)},3));`);
      if (p.normals) parts.push(`g.setAttribute('normal', new THREE.Float32BufferAttribute(${j(p.normals)},3));`);
      if (p.uvs) parts.push(`g.setAttribute('uv', new THREE.Float32BufferAttribute(${j(p.uvs)},2));`);
      if (p.indices) parts.push(`g.setIndex(${j(p.indices)});`);
      if (!p.normals) parts.push(`g.computeVertexNormals();`);
      parts.push(`return g; })()`);
      return parts.join(' ');
    }
    default:
      return `new THREE.BoxGeometry(1,1,1)`;
  }
}

// ── material emit ────────────────────────────────────────────────────────
function emitMaterial(mat = {}) {
  const t = String(mat.type || 'standard').toLowerCase();
  const opts = {};
  if (mat.color != null) opts.color = mat.color;
  if (mat.emissive != null) opts.emissive = mat.emissive;
  if (mat.emissiveIntensity != null) opts.emissiveIntensity = mat.emissiveIntensity;
  if (mat.opacity != null) opts.opacity = mat.opacity;
  if (mat.transparent != null) opts.transparent = mat.transparent;
  if (mat.side != null) opts.side = mat.side;
  if (mat.wireframe != null) opts.wireframe = mat.wireframe;
  if (t === 'standard' || t === 'physical') {
    if (mat.roughness != null) opts.roughness = mat.roughness;
    if (mat.metalness != null) opts.metalness = mat.metalness;
    if (mat.envMapIntensity != null) opts.envMapIntensity = mat.envMapIntensity;
    if (t === 'physical') {
      if (mat.clearcoat != null) opts.clearcoat = mat.clearcoat;
      if (mat.transmission != null) opts.transmission = mat.transmission;
      if (mat.ior != null) opts.ior = mat.ior;
      if (mat.thickness != null) opts.thickness = mat.thickness;
    }
  }
  const map = {
    standard: 'MeshStandardMaterial',
    physical: 'MeshPhysicalMaterial',
    basic: 'MeshBasicMaterial',
    lambert: 'MeshLambertMaterial',
    phong: 'MeshPhongMaterial',
    toon: 'MeshToonMaterial',
    normal: 'MeshNormalMaterial',
    points: 'PointsMaterial',
    line: 'LineBasicMaterial',
  };
  const cls = map[t] || 'MeshStandardMaterial';
  // color/emissive strings need to become THREE.Color at runtime
  const optsLiteral = `{${Object.entries(opts).map(([k, v]) => {
    if (k === 'color' || k === 'emissive') return `${k}: new THREE.Color(${j(v)})`;
    return `${k}: ${j(v)}`;
  }).join(', ')}}`;
  let expr = `new THREE.${cls}(${optsLiteral})`;

  // texture maps — deferred load, assigned after construction
  const mapAssign = [];
  const texSlots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];
  for (const slot of texSlots) {
    if (mat[slot]) mapAssign.push(`__tex(${j(mat[slot])}).then(t => { m.${slot} = t; m.needsUpdate = true; });`);
  }
  if (mapAssign.length) {
    return `(() => { const m = ${expr}; ${mapAssign.join(' ')} return m; })()`;
  }
  return expr;
}

// ── light emit ───────────────────────────────────────────────────────────
function emitLight(light = {}) {
  const t = String(light.type || 'directional').toLowerCase();
  const col = colorLiteral(light.color, '#ffffff');
  const intensity = num(light.intensity, 1);
  let expr;
  switch (t) {
    case 'ambient':
      expr = `new THREE.AmbientLight(new THREE.Color(${col}), ${intensity})`;
      break;
    case 'hemisphere':
      expr = `new THREE.HemisphereLight(new THREE.Color(${col}), new THREE.Color(${colorLiteral(light.groundColor, '#000000')}), ${intensity})`;
      break;
    case 'point':
      expr = `new THREE.PointLight(new THREE.Color(${col}), ${intensity}, ${num(light.distance, 0)}, ${num(light.decay, 2)})`;
      break;
    case 'spot':
      expr = `new THREE.SpotLight(new THREE.Color(${col}), ${intensity}, ${num(light.distance, 0)}, ${num(light.angle, Math.PI / 4)}, ${num(light.penumbra, 0)}, ${num(light.decay, 2)})`;
      break;
    case 'rectarea':
      expr = `new THREE.RectAreaLight(new THREE.Color(${col}), ${intensity}, ${num(light.width, 1)}, ${num(light.height, 1)})`;
      break;
    case 'directional':
    default:
      expr = `new THREE.DirectionalLight(new THREE.Color(${col}), ${intensity})`;
  }
  return expr;
}

function emitLightExtras(varName, light = {}) {
  const lines = [];
  if (light.position) lines.push(`${varName}.position.set(...${vec3(light.position)});`);
  if (light.target && Array.isArray(light.target)) {
    lines.push(`${varName}.target = new THREE.Object3D(); ${varName}.target.position.set(...${vec3(light.target)}); scene.add(${varName}.target);`);
  }
  if (light.castShadow) {
    lines.push(`${varName}.castShadow = true;`);
    lines.push(`if (${varName}.shadow) { ${varName}.shadow.mapSize.width = ${num(light.shadowMapSize, 1024)}; ${varName}.shadow.mapSize.height = ${num(light.shadowMapSize, 1024)}; }`);
  }
  return lines.join(' ');
}

// ── helper emit ──────────────────────────────────────────────────────────
function emitHelper(helper = {}) {
  const t = String(helper.type || 'grid').toLowerCase();
  switch (t) {
    case 'grid':
      return `new THREE.GridHelper(${num(helper.size, 20)}, ${num(helper.divisions, 20)}, new THREE.Color(${colorLiteral(helper.color1, '#444488')}), new THREE.Color(${colorLiteral(helper.color2, '#333366')}))`;
    case 'axes':
      return `new THREE.AxesHelper(${num(helper.size, 5)})`;
    default:
      return `new THREE.GridHelper(20, 20)`;
  }
}

// ── node emit ────────────────────────────────────────────────────────────
function emitNode(node, ctx) {
  const varName = `_n_${sanitizeVar(node.id)}`;
  const lines = [];
  switch (node.type) {
    case 'mesh': {
      const geo = emitGeometry(node.geometry);
      const matId = node.materialId || 'default';
      lines.push(`const ${varName} = new THREE.Mesh(${geo}, __mat(${j(matId)}));`);
      break;
    }
    case 'group': {
      lines.push(`const ${varName} = new THREE.Group();`);
      break;
    }
    case 'light': {
      lines.push(`const ${varName} = ${emitLight(node.light)};`);
      const extras = emitLightExtras(varName, node.light);
      if (extras) lines.push(extras);
      break;
    }
    case 'helper': {
      lines.push(`const ${varName} = ${emitHelper(node.helper)};`);
      break;
    }
    case 'instanced': {
      const geo = emitGeometry(node.geometry);
      const matId = node.materialId || 'default';
      const count = num(node.count, node.instances?.length || 1);
      lines.push(`const ${varName} = new THREE.InstancedMesh(${geo}, __mat(${j(matId)}), ${count});`);
      if (Array.isArray(node.instances)) {
        lines.push(`{ const __m = new THREE.Matrix4(); const __q = new THREE.Quaternion(); const __e = new THREE.Euler();`);
        node.instances.forEach((inst, i) => {
          const pos = vec3(inst.position);
          const rot = vec3(inst.rotation);
          const scl = vec3(inst.scale, [1, 1, 1]);
          lines.push(`__e.set(...${rot}); __q.setFromEuler(__e); __m.compose(new THREE.Vector3(...${pos}), __q, new THREE.Vector3(...${scl})); ${varName}.setMatrixAt(${i}, __m);`);
        });
        lines.push(`${varName}.instanceMatrix.needsUpdate = true; }`);
      }
      break;
    }
    case 'points': {
      const geo = emitGeometry(node.geometry);
      const matId = node.materialId || 'default';
      lines.push(`const ${varName} = new THREE.Points(${geo}, __mat(${j(matId)}));`);
      break;
    }
    case 'line': {
      const geo = emitGeometry(node.geometry);
      const matId = node.materialId || 'default';
      const cls = node.mode === 'segments' ? 'LineSegments' : node.mode === 'loop' ? 'LineLoop' : 'Line';
      lines.push(`const ${varName} = new THREE.${cls}(${geo}, __mat(${j(matId)}));`);
      break;
    }
    case 'gltf': {
      ctx.needsGltf = true;
      lines.push(`const ${varName} = new THREE.Group();`);
      lines.push(`__gltf(${j(node.asset)}).then(g => { ${varName}.add(g.scene || g); });`);
      break;
    }
    case 'sprite': {
      const matId = node.materialId || 'default';
      lines.push(`const ${varName} = new THREE.Sprite(__mat(${j(matId)}));`);
      break;
    }
    default:
      lines.push(`const ${varName} = new THREE.Object3D();`);
  }

  // common transform
  if (node.name) lines.push(`${varName}.name = ${j(node.name)};`);
  if (node.position) lines.push(`${varName}.position.set(...${vec3(node.position)});`);
  if (node.rotation) lines.push(`${varName}.rotation.set(...${vec3(node.rotation)});`);
  if (node.scale) lines.push(`${varName}.scale.set(...${vec3(node.scale, [1, 1, 1])});`);
  if (node.castShadow) lines.push(`${varName}.castShadow = true;`);
  if (node.receiveShadow) lines.push(`${varName}.receiveShadow = true;`);
  if (node.visible === false) lines.push(`${varName}.visible = false;`);

  return { varName, code: lines.join('\n  ') };
}

function sanitizeVar(id) {
  return String(id).replace(/[^a-zA-Z0-9_$]/g, '_');
}

// ── camera emit ──────────────────────────────────────────────────────────
function emitCamera(cam = {}, width, height) {
  const type = String(cam.type || 'perspective').toLowerCase();
  const pos = vec3(cam.position, [5, 4, 8]);
  const tgt = vec3(cam.target, [0, 1, 0]);
  const parts = [];
  if (type === 'orthographic') {
    const halfW = num(cam.width, 5);
    const halfH = num(cam.height, halfW * (height / width));
    parts.push(`const camera = new THREE.OrthographicCamera(${-halfW},${halfW},${halfH},${-halfH},${num(cam.near, 0.1)},${num(cam.far, 1000)});`);
  } else {
    parts.push(`const camera = new THREE.PerspectiveCamera(${num(cam.fov, 45)}, ${width}/${height}, ${num(cam.near, 0.1)}, ${num(cam.far, 1000)});`);
  }
  parts.push(`camera.position.set(...${pos});`);
  parts.push(`const __camTarget = new THREE.Vector3(...${tgt});`);
  return parts.join('\n');
}

function emitControls(cam = {}) {
  const kind = String(cam.controls || 'orbit').toLowerCase();
  if (kind === 'none') return { imports: '', code: '' };
  if (kind === 'first-person') {
    return {
      imports: `import { FirstPersonControls } from 'three/addons/controls/FirstPersonControls.js';`,
      code: `const controls = new FirstPersonControls(camera, renderer.domElement); controls.lookSpeed = 0.1; controls.movementSpeed = 5;`,
    };
  }
  // default orbit
  return {
    imports: `import { OrbitControls } from 'three/addons/controls/OrbitControls.js';`,
    code: `const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.copy(__camTarget); controls.update();`,
  };
}

// ── main compile ─────────────────────────────────────────────────────────
export function compile(scene) {
  const width = num(scene.width, 800);
  const height = num(scene.height, 600);
  const ctx = { needsGltf: false };

  // materials — emit as a factory map
  const materials = scene.materials || { default: { type: 'standard', color: '#8090a0' } };
  const materialEntries = Object.entries(materials).map(([id, mat]) => {
    return `  ${j(id)}: () => ${emitMaterial(mat)}`;
  }).join(',\n');

  // nodes
  const nodeEmits = (scene.nodes || []).map(n => emitNode(n, ctx));
  const nodeCode = nodeEmits.map(e => e.code).join('\n  ');
  const attachCode = (scene.nodes || []).map(n => {
    const v = `_n_${sanitizeVar(n.id)}`;
    if (n.parent) {
      const parentVar = `_n_${sanitizeVar(n.parent)}`;
      return `if (typeof ${parentVar} !== 'undefined') { ${parentVar}.add(${v}); } else { scene.add(${v}); }`;
    }
    return `scene.add(${v});`;
  }).join('\n  ');

  // camera + controls
  const cameraCode = emitCamera(scene.camera, width, height);
  const controls = emitControls(scene.camera);

  // background
  const bg = scene.background;
  let bgCode;
  if (bg && typeof bg === 'object' && bg.hdri) {
    bgCode = `__hdri(${j(bg.hdri)}, ${num(bg.intensity, 1)}).then(({ envMap }) => { scene.environment = envMap; scene.background = envMap; });`;
    ctx.needsHdri = true;
  } else {
    bgCode = `scene.background = new THREE.Color(${colorLiteral(bg || '#0b1020')});`;
  }

  // tone mapping
  const toneMap = String(scene.tone?.mapping || 'ACESFilmic');
  const toneMapConst = toneMap === 'None' ? 'THREE.NoToneMapping'
    : toneMap === 'Linear' ? 'THREE.LinearToneMapping'
    : toneMap === 'Reinhard' ? 'THREE.ReinhardToneMapping'
    : toneMap === 'Cineon' ? 'THREE.CineonToneMapping'
    : 'THREE.ACESFilmicToneMapping';
  const exposure = num(scene.tone?.exposure, 1.0);

  // scripts — tick runs every frame; click/hover wire raycaster listeners
  const tickScripts = (scene.scripts || []).filter(s => s.event === 'tick').map(s => `// script:${s.id}\ntry { (function(){ const target = _byId[${j(s.target)}] || scene.getObjectByName(${j(s.target)}); ${s.code} })(); } catch(e){ console.error(${j(s.id)}, e); }`).join('\n    ');
  const interactionScripts = (scene.scripts || []).filter(s => s.event === 'click' || s.event === 'hover');
  const needsRaycaster = interactionScripts.length > 0;
  const interactionCode = needsRaycaster ? `
const __ray = new THREE.Raycaster();
const __ptr = new THREE.Vector2();
const __handlers = { click: [], hover: [] };
${interactionScripts.map(s => `__handlers[${j(s.event)}].push({ target: ${j(s.target)}, run: (target, hit) => { try { ${s.code} } catch(e){ console.error(${j(s.id)}, e); } } });`).join('\n')}
function __updatePointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  __ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  __ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}
function __hitTest() {
  __ray.setFromCamera(__ptr, camera);
  return __ray.intersectObjects(scene.children, true);
}
renderer.domElement.addEventListener('click', (e) => {
  __updatePointer(e);
  const hits = __hitTest();
  for (const h of __handlers.click) {
    const target = _byId[h.target];
    if (!target) continue;
    if (hits.some(x => x.object === target || target === x.object.parent)) h.run(target, hits[0]);
  }
});
renderer.domElement.addEventListener('mousemove', (e) => {
  __updatePointer(e);
  const hits = __hitTest();
  for (const h of __handlers.hover) {
    const target = _byId[h.target];
    if (!target) continue;
    if (hits.some(x => x.object === target || target === x.object.parent)) h.run(target, hits[0]);
  }
});
` : '';

  // animations — emit AnimationMixer + KeyframeTrack objects
  const anims = scene.animations || [];
  const needsMixer = anims.length > 0;
  const animCode = needsMixer ? `
const __mixers = [];
${anims.map((clip, ci) => {
  const tracks = (clip.tracks || []).map((tr, ti) => {
    // property e.g. ".position" or ".rotation" or ".scale" or ".material.opacity"
    const path = String(tr.property || '.position');
    const times = JSON.stringify(tr.times || [0, 1]);
    const values = JSON.stringify(tr.values || [0, 0, 0, 1, 0, 0]);
    // Guess track class from property name
    let cls = 'VectorKeyframeTrack';
    if (path.endsWith('.quaternion')) cls = 'QuaternionKeyframeTrack';
    else if (path.endsWith('.opacity') || /\.material\./.test(path) && !/color/.test(path)) cls = 'NumberKeyframeTrack';
    return `new THREE.${cls}('${path}', ${times}, ${values})`;
  }).join(', ');
  return `{
  const __clip = new THREE.AnimationClip(${j(clip.id || `clip_${ci}`)}, ${num(clip.duration, 2)}, [${tracks}]);
  const __obj = _byId[${j(clip.target)}] || scene;
  const __mixer = new THREE.AnimationMixer(__obj);
  const __action = __mixer.clipAction(__clip);
  __action.loop = ${clip.loop === false ? 'THREE.LoopOnce' : 'THREE.LoopRepeat'};
  __action.play();
  __mixers.push(__mixer);
}`;
}).join('\n')}
` : '';

  // physics — cannon-es rigid bodies
  const physicsBodies = scene.physics || [];
  const needsPhysics = physicsBodies.length > 0;
  const physicsCode = needsPhysics ? `
const __gravity = new CANNON.Vec3(0, ${num(scene.physicsGravity, -9.82)}, 0);
const __world = new CANNON.World({ gravity: __gravity });
const __bodies = [];
${physicsBodies.map(b => {
  const shape = String(b.shape || 'box').toLowerCase();
  let shapeExpr;
  switch (shape) {
    case 'sphere': shapeExpr = `new CANNON.Sphere(${num(b.radius, 0.5)})`; break;
    case 'plane':  shapeExpr = `new CANNON.Plane()`; break;
    case 'box':
    default: {
      const [hx, hy, hz] = (b.halfExtents || [0.5, 0.5, 0.5]);
      shapeExpr = `new CANNON.Box(new CANNON.Vec3(${num(hx, 0.5)}, ${num(hy, 0.5)}, ${num(hz, 0.5)}))`;
    }
  }
  const pos = vec3(b.position, [0, 0, 0]);
  return `{
  const body = new CANNON.Body({ mass: ${num(b.mass, 0)}, shape: ${shapeExpr}, position: new CANNON.Vec3(...${pos}) });
  ${b.restitution != null ? `body.material = new CANNON.Material({ restitution: ${num(b.restitution, 0)} });` : ''}
  __world.addBody(body);
  const __target = _byId[${j(b.target)}];
  __bodies.push({ body, target: __target, applyPlaneRotation: ${shape === 'plane'} });
}`;
}).join('\n')}
function __stepPhysics(dt) {
  __world.step(1/60, dt, 3);
  for (const { body, target, applyPlaneRotation } of __bodies) {
    if (!target) continue;
    target.position.copy(body.position);
    if (!applyPlaneRotation) target.quaternion.copy(body.quaternion);
  }
}
` : '';

  const title = scene.title || scene.slug || 'Three.js Scene';

  // extra loader imports
  const loaderImports = [];
  if (ctx.needsGltf) loaderImports.push(`import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';`);
  if (ctx.needsHdri) loaderImports.push(`import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';`);
  if (needsPhysics) loaderImports.push(`import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
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
<div id="label"><h1>${escapeHtml(title)}</h1></div>
<div id="info">Three.js ${THREE_VERSION} · scene: ${escapeHtml(scene.slug || '')}</div>

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
${controls.imports}
${loaderImports.join('\n')}

// ── Renderer ────────────────────────────────────────────────────────
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(${width}, ${height});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = ${toneMapConst};
renderer.toneMappingExposure = ${exposure};
document.body.prepend(renderer.domElement);

// ── Camera ──────────────────────────────────────────────────────────
${cameraCode}

// ── Controls ────────────────────────────────────────────────────────
${controls.code}

// ── Background / environment ───────────────────────────────────────
${bgCode}

// ── Material factory ────────────────────────────────────────────────
const __texLoader = new THREE.TextureLoader();
const __texCache = new Map();
function __tex(src) {
  if (__texCache.has(src)) return __texCache.get(src);
  const p = new Promise((resolve, reject) => __texLoader.load(src, resolve, undefined, reject));
  __texCache.set(src, p);
  return p;
}
const __matFactories = {
${materialEntries}
};
const __matCache = new Map();
function __mat(id) {
  if (!__matCache.has(id)) {
    const f = __matFactories[id] || __matFactories.default;
    __matCache.set(id, f ? f() : new THREE.MeshStandardMaterial({ color: 0x808080 }));
  }
  return __matCache.get(id);
}

${ctx.needsGltf ? `
const __gltfLoader = new GLTFLoader();
function __gltf(src) { return new Promise((res, rej) => __gltfLoader.load(src, res, undefined, rej)); }
` : ''}
${ctx.needsHdri ? `
const __hdriLoader = new RGBELoader();
function __hdri(src, intensity) {
  return new Promise((res, rej) => __hdriLoader.load(src, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    res({ envMap: tex });
  }, undefined, rej));
}
` : ''}

// ── Nodes ───────────────────────────────────────────────────────────
const _byId = {};
${nodeCode}
${(scene.nodes || []).map(n => `_byId[${j(n.id)}] = _n_${sanitizeVar(n.id)};`).join('\n  ')}
${attachCode}

// ── Animation ───────────────────────────────────────────────────────
${animCode}

// ── Physics ─────────────────────────────────────────────────────────
${physicsCode}

// ── Interaction (click/hover) ───────────────────────────────────────
${interactionCode}

// ── Resize ──────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  if (camera.isPerspectiveCamera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  renderer.setSize(w, h);
});

// ── Render loop ─────────────────────────────────────────────────────
const __clock = new THREE.Clock();
function __tick() {
  requestAnimationFrame(__tick);
  const dt = __clock.getDelta();
  ${controls.code ? 'if (controls && controls.update) controls.update(dt);' : ''}
  ${needsMixer ? 'for (const m of __mixers) m.update(dt);' : ''}
  ${needsPhysics ? '__stepPhysics(dt);' : ''}
  ${tickScripts}
  renderer.render(scene, camera);
}
__tick();

// Expose for headless capture / debugging.
window.__scene = scene;
window.__camera = camera;
window.__renderer = renderer;
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Named export as default fallback for dynamic import
export default { compile };
