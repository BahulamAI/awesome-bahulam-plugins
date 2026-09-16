/**
 * wire_event — high-level shortcut for common interactions. Generates a
 * script for you (via add_script) so the Behavior Agent doesn't have to
 * hand-write raycast wiring for every case.
 *
 * Args:
 *   slug*    - scene slug
 *   source*  - node id the event fires on
 *   event*   - "click" | "hover"
 *   action*  - "toggle_visible" | "hide" | "show" | "swap_material"
 *              | "translate" | "rotate" | "log"
 *   target   - node id the action affects (defaults to source)
 *   value    - action-specific payload (e.g. material_id for swap_material,
 *              [dx,dy,dz] for translate, [rx,ry,rz] for rotate)
 *   cwd
 */
import { call as addScript } from './add-script.mjs';

function generateCode(action, target, value) {
  const targetExpr = target ? `_byId[${JSON.stringify(target)}]` : 'target';
  switch (action) {
    case 'toggle_visible': return `${targetExpr}.visible = !${targetExpr}.visible;`;
    case 'hide':           return `${targetExpr}.visible = false;`;
    case 'show':           return `${targetExpr}.visible = true;`;
    case 'swap_material':  return `${targetExpr}.material = __mat(${JSON.stringify(value)});`;
    case 'translate': {
      const [dx = 0, dy = 0, dz = 0] = Array.isArray(value) ? value : [0, 0, 0];
      return `${targetExpr}.position.x += ${dx}; ${targetExpr}.position.y += ${dy}; ${targetExpr}.position.z += ${dz};`;
    }
    case 'rotate': {
      const [rx = 0, ry = 0, rz = 0] = Array.isArray(value) ? value : [0, 0, 0];
      return `${targetExpr}.rotation.x += ${rx}; ${targetExpr}.rotation.y += ${ry}; ${targetExpr}.rotation.z += ${rz};`;
    }
    case 'log': return `console.log(${JSON.stringify(value || 'event fired')}, hit);`;
    default: return `/* unknown action ${JSON.stringify(action)} */`;
  }
}

export async function call(args = {}, options = {}) {
  const { slug, source, event, action, target, value, cwd } = args;
  if (!slug || !source || !event || !action) {
    return { success: false, output: '`slug`, `source`, `event`, `action` required.' };
  }
  const code = generateCode(action, target || source, value);
  const result = await addScript({ slug, target: source, event, code, cwd }, options);
  if (!result.success) return result;
  return { success: true, output: { ...result.output, action, effect_target: target || source, value } };
}
