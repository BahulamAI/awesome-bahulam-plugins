/**
 * save_palette — writes a palette to the plugin's Shared Blackboard.
 *
 * Rare in this plugin (most calls hit the MCP server directly) but the
 * ONE tool that keeps state — because state is the reason to stay JS.
 * A separate `palettes` stream keeps this out of any other blackboard
 * stream, so `list_palettes` and the workspace view can list them
 * without filtering.
 */

export const name = 'save_palette';
export const description = 'Persist a palette to the plugin\'s shared blackboard';

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'save_palette: no state handle available' };
  }
  const name = String(args.name || '').trim();
  const seed = String(args.seed || '').trim();
  const mode = String(args.mode || 'analogous').trim();
  const swatches = Array.isArray(args.swatches) ? args.swatches.slice(0, 12) : [];
  if (!name || !seed || swatches.length === 0) {
    return { success: false, output: 'save_palette: name, seed, and non-empty swatches[] are required' };
  }
  const id = state.append('palettes', { name, seed, mode, swatches });
  return { success: true, output: { id, name, seed, mode, swatches } };
}
