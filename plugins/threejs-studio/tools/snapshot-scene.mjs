/**
 * snapshot_scene — write a timestamped copy of scene.json to snapshots/.
 *
 * Args:
 *   slug*  - scene slug
 *   label  - optional label appended to filename
 *   cwd
 */
import { callSnapshot } from './scene-io.mjs';

export const call = callSnapshot;
