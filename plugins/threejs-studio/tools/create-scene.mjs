/**
 * create_scene — initialize a new scene folder with default lights/camera/grid.
 *
 * Args:
 *   name*   - slug (a-z0-9-)
 *   title   - human-readable title (default: slug)
 *   width   - canvas width (default 800)
 *   height  - canvas height (default 600)
 *   cwd     - base directory (default process.cwd())
 *
 * Returns: { slug, title, dsl_path, html_path }
 */
import { callCreateScene } from './scene-io.mjs';

export const call = callCreateScene;
