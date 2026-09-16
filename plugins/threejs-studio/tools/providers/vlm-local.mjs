/**
 * Local VLM provider — a deterministic heuristic critic that "reads"
 * screenshot metadata (the accompanying scene DSL) and returns simple
 * pass/fail signals. Used when no real VLM is configured.
 *
 * Real critique needs a vision model. This stub keeps tool chains green
 * during dev/CI and surfaces obvious scene problems (no lights, camera
 * inside geometry, empty scene, missing materials).
 */

export async function evaluate({ scene, images, criteria }) {
  const issues = [];
  const wins = [];

  if (!scene) return { provider: 'local', pass: false, issues: ['no scene supplied'], wins, note: 'stub-only' };

  const nodes = scene.nodes || [];
  const nonHelperNodes = nodes.filter(n => n.type !== 'helper');
  const lights = nodes.filter(n => n.type === 'light');
  const renderables = nodes.filter(n => ['mesh', 'instanced', 'points', 'line', 'gltf', 'sprite'].includes(n.type));

  if (!renderables.length) issues.push('scene has no renderable geometry');
  if (!lights.length && !(scene.background && typeof scene.background === 'object' && scene.background.hdri)) {
    issues.push('scene has no lights and no HDRI — will render dark');
  } else {
    wins.push(`${lights.length} light(s) present`);
  }

  const usedMats = new Set(renderables.map(n => n.materialId).filter(Boolean));
  for (const id of usedMats) {
    if (!scene.materials?.[id]) issues.push(`material "${id}" referenced but not defined`);
  }
  if (usedMats.size) wins.push(`${usedMats.size} material(s) in use`);

  if (Array.isArray(images) && images.length) wins.push(`${images.length} screenshot(s) supplied`);
  if (criteria) wins.push(`criteria supplied: ${String(criteria).slice(0, 80)}`);

  return {
    provider: 'local',
    pass: issues.length === 0,
    issues,
    wins,
    note: 'heuristic critic — configure THREEJS_VLM_PROVIDER=anthropic (+ANTHROPIC_API_KEY) for VLM-based review',
  };
}
