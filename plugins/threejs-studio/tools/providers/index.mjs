/**
 * Provider adapter dispatcher.
 *
 * Providers are selected via env vars:
 *   THREEJS_MESH_PROVIDER    : meshy | rodin | tripo | local  (default: local)
 *   THREEJS_TEXTURE_PROVIDER : fal | stability | local        (default: local)
 *   THREEJS_VLM_PROVIDER     : anthropic | openai | local     (default: local)
 *
 * Each real provider requires an API key (env var like MESHY_API_KEY,
 * FAL_KEY, ANTHROPIC_API_KEY). Missing keys fall through to the local stub,
 * which produces valid-but-placeholder output so agent chains still complete.
 *
 * Callers pass `options.provider` to force a specific provider for a single
 * call (used by tests).
 */

export function chooseProvider(kind, override) {
  if (override) return String(override);
  const envKey = { mesh: 'THREEJS_MESH_PROVIDER', texture: 'THREEJS_TEXTURE_PROVIDER', vlm: 'THREEJS_VLM_PROVIDER' }[kind];
  return process.env[envKey] || 'local';
}

export async function loadProvider(kind, name) {
  const registry = {
    mesh: {
      local: () => import('./mesh-local.mjs'),
      meshy: () => import('./mesh-meshy.mjs'),
    },
    texture: {
      local: () => import('./texture-local.mjs'),
      fal: () => import('./texture-fal.mjs'),
    },
    vlm: {
      local: () => import('./vlm-local.mjs'),
      anthropic: () => import('./vlm-anthropic.mjs'),
    },
  };
  const loader = registry[kind]?.[name] || registry[kind]?.local;
  try {
    return await loader();
  } catch {
    // If the specific provider module is missing (e.g. optional impl not
    // included in this release), fall through to local.
    return registry[kind].local();
  }
}
