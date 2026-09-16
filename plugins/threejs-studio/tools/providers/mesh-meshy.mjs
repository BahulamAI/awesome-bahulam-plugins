/**
 * Meshy (meshy.ai) mesh provider — text→3D via their REST API.
 *
 * Requires MESHY_API_KEY. Falls back to local if missing so tool chains
 * still complete during dev/CI. Polls the task endpoint until the mesh is
 * ready, then downloads the glb into <sceneDir>/assets/.
 *
 * See https://docs.meshy.ai for the current API contract.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateMesh as fallback } from './mesh-local.mjs';

const API = 'https://api.meshy.ai/openapi/v2/text-to-3d';

export async function generateMesh({ prompt, sceneDir, id, seed }) {
  const key = process.env.MESHY_API_KEY;
  if (!key) {
    const stub = await fallback({ prompt, sceneDir, id });
    return { ...stub, provider: 'local (MESHY_API_KEY missing)' };
  }
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const create = await fetch(API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'preview', prompt, art_style: 'realistic', seed }),
  }).then(r => r.json());
  const taskId = create?.result;
  if (!taskId) return { provider: 'meshy', error: 'no task id', response: create };

  // Poll — cap at ~90 s
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await fetch(`${API}/${taskId}`, { headers }).then(r => r.json());
    if (status?.status === 'SUCCEEDED' && status.model_urls?.glb) {
      const buf = Buffer.from(await (await fetch(status.model_urls.glb)).arrayBuffer());
      const filename = `meshy_${id || taskId}.glb`;
      const assetsDir = path.join(sceneDir, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      const dst = path.join(assetsDir, filename);
      fs.writeFileSync(dst, buf);
      return {
        provider: 'meshy',
        prompt,
        task_id: taskId,
        asset_path: path.relative(sceneDir, dst),
        asset_absolute: dst,
      };
    }
    if (status?.status === 'FAILED') return { provider: 'meshy', error: 'meshy task failed', task_id: taskId };
  }
  return { provider: 'meshy', error: 'meshy timeout', task_id: taskId };
}
