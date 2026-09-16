/**
 * Anthropic Claude Vision critic — sends screenshots + scene summary to
 * Claude and asks it to critique the render against `criteria`.
 *
 * Requires ANTHROPIC_API_KEY. Falls back to the local heuristic if missing.
 * Uses `claude-sonnet-4-6` by default; override with THREEJS_VLM_MODEL.
 */
import fs from 'node:fs';
import { evaluate as fallback } from './vlm-local.mjs';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

function toDataBase64(imagePath) {
  const buf = fs.readFileSync(imagePath);
  return buf.toString('base64');
}

export async function evaluate({ scene, images, criteria }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...(await fallback({ scene, images, criteria })), provider: 'local (ANTHROPIC_API_KEY missing)' };

  const model = process.env.THREEJS_VLM_MODEL || DEFAULT_MODEL;
  const shots = (images || []).slice(0, 4).map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: toDataBase64(img.path || img) },
  }));
  const summary = scene ? {
    nodes: (scene.nodes || []).length,
    lights: (scene.nodes || []).filter(n => n.type === 'light').length,
    materials: Object.keys(scene.materials || {}),
  } : {};

  const body = {
    model,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        ...shots,
        { type: 'text', text: `Critique this Three.js scene render against the criteria: ${criteria || 'general quality'}. Scene summary: ${JSON.stringify(summary)}. Return JSON: {"pass": bool, "issues": [str], "wins": [str], "next_steps": [str]}.` },
      ],
    }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

  const text = res?.content?.[0]?.text || '';
  let parsed;
  try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { parsed = {}; }
  return {
    provider: 'anthropic',
    model,
    pass: parsed.pass ?? false,
    issues: parsed.issues || [],
    wins: parsed.wins || [],
    next_steps: parsed.next_steps || [],
    raw: text,
  };
}
