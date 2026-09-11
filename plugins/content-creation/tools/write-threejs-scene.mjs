import fs from 'node:fs';
import path from 'node:path';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function starterHtml(title, script) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
html,body{margin:0;height:100%;background:#0b1020;color:#f8fafc;font-family:Inter,system-ui,sans-serif;overflow:hidden}
#label{position:fixed;left:24px;bottom:24px;max-width:520px}
h1{font-size:28px;margin:0 0 8px}p{margin:0;color:#cbd5e1;line-height:1.45}
canvas{display:block}
</style>
</head>
<body>
<div id="label"><h1>${title}</h1><p>${script || 'Interactive Three.js content scene.'}</p></div>
<script type="module">
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.5, 5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
const group = new THREE.Group();
scene.add(group);
const material = new THREE.MeshStandardMaterial({ color: 0x14b8a6, roughness: 0.35, metalness: 0.2 });
for (let i = 0; i < 7; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75), material.clone());
  mesh.material.color.offsetHSL(i * 0.035, 0, 0);
  mesh.position.x = (i - 3) * 0.82;
  mesh.position.y = Math.sin(i) * 0.35;
  group.add(mesh);
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(3, 5, 4);
scene.add(key);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
function tick(t) {
  group.rotation.y = t * 0.00035;
  group.children.forEach((mesh, i) => {
    mesh.rotation.x = t * 0.0006 + i;
    mesh.rotation.y = t * 0.0004 + i;
  });
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
</script>
</body>
</html>
`;
}

export async function call(args = {}, options = {}) {
  const name = String(args.name || '').trim().toLowerCase();
  if (!SLUG_RE.test(name)) return { success: false, output: `Invalid name '${name}' - use a lowercase slug.` };
  const title = String(args.title || name.replace(/-/g, ' ')).trim();
  const script = String(args.script || '').trim();
  const html = String(args.html || '').trim() || starterHtml(title, script);
  if (!/^<!doctype html>|<html[\s>]/i.test(html)) {
    return { success: false, output: 'html must be a complete HTML document.' };
  }
  const dir = path.join(process.cwd(), '.bahulam', 'tmp', 'content-creation', 'threejs', name);
  fs.mkdirSync(dir, { recursive: true });
  const scenePath = path.join(dir, 'index.html');
  fs.writeFileSync(scenePath, html, 'utf-8');
  const state = options.state ? await options.state : null;
  if (state) {
    state.append?.('assets', { name, kind: 'threejs', path: scenePath, prompt: script, status: 'draft', notes: title });
  }
  return { success: true, output: { name, kind: 'threejs', path: scenePath, title }, path: scenePath };
}
