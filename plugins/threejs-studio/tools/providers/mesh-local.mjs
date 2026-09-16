/**
 * Local mesh provider — the zero-credentials fallback.
 *
 * Rather than call an external mesh-gen API, this "generates" a mesh by
 * picking a primitive that matches the prompt (naive keyword match) and
 * writing a tiny .gltf file to the scene's assets/ folder.
 *
 * This lets the Asset Agent's tool chain complete end-to-end even without
 * MESHY_API_KEY / RODIN_API_KEY. Users get placeholder geometry with a
 * clear provider tag; upgrading to a real provider is a config change.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const KEYWORDS = [
  { match: /(chair|stool|seat)/i, prim: 'box',        params: { width: 0.5, height: 0.9, depth: 0.5 } },
  { match: /(table|desk)/i,       prim: 'box',        params: { width: 1.4, height: 0.05, depth: 0.9 } },
  { match: /(ball|sphere|planet|globe)/i, prim: 'sphere', params: { radius: 1 } },
  { match: /(cup|glass|mug|cylinder)/i,   prim: 'cylinder', params: { radiusTop: 0.35, radiusBottom: 0.35, height: 0.9 } },
  { match: /(cone|hat|funnel)/i,  prim: 'cone',       params: { radius: 0.6, height: 1.2 } },
  { match: /(ring|donut|torus)/i, prim: 'torus',      params: { radius: 0.8, tube: 0.25 } },
  { match: /(floor|ground|plane|wall)/i, prim: 'plane', params: { width: 5, height: 5 } },
];

function pickPrimitive(prompt) {
  const p = String(prompt || '');
  for (const rule of KEYWORDS) if (rule.match.test(p)) return { type: rule.prim, params: rule.params };
  return { type: 'box', params: { width: 1, height: 1, depth: 1 } };
}

/**
 * Write a minimal glTF-JSON stub. Real Three.js will load it as a Group
 * with a single primitive. Files stay small and human-diffable.
 */
function writeGltfStub(dstPath, prim) {
  const doc = {
    asset: { version: '2.0', generator: 'threejs-studio local mesh provider' },
    extras: { primitive: prim.type, params: prim.params, note: 'placeholder — replace via real mesh provider' },
    scenes: [{ nodes: [] }],
    nodes: [],
  };
  fs.writeFileSync(dstPath, JSON.stringify(doc, null, 2), 'utf-8');
}

export async function generateMesh({ prompt, sceneDir, id }) {
  const prim = pickPrimitive(prompt);
  const shortId = id || crypto.randomBytes(4).toString('hex');
  const filename = `local_${shortId}.gltf`;
  const assetsDir = path.join(sceneDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const dst = path.join(assetsDir, filename);
  writeGltfStub(dst, prim);
  return {
    provider: 'local',
    prompt,
    primitive: prim,
    asset_path: path.relative(sceneDir, dst),
    asset_absolute: dst,
    note: 'placeholder primitive — configure THREEJS_MESH_PROVIDER=meshy (+MESHY_API_KEY) for real generation',
  };
}
