/**
 * get_scene — return a compact summary of a scene's DSL, suitable for
 * inclusion in an agent's context. Pass `full: true` for the raw JSON.
 *
 * Args:
 *   slug*  - scene slug
 *   cwd
 *   full   - default false; when true returns the entire scene object.
 */
import { callGetScene } from './scene-io.mjs';

export const call = callGetScene;
