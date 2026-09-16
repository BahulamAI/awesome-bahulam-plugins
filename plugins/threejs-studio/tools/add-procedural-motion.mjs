/**
 * add_procedural_motion — attach a common procedural animation via a
 * tick script. Simpler than keyframes for spin/orbit/oscillate.
 *
 * Args:
 *   slug*    - scene slug
 *   target*  - node id
 *   kind*    - "spin" | "orbit" | "oscillate" | "bob"
 *   axis     - "x" | "y" | "z" (default "y")
 *   speed    - rad/s (spin, orbit) or Hz (oscillate/bob). Default 1.
 *   radius   - orbit radius (orbit only). Default 3.
 *   amplitude - oscillate/bob amplitude. Default 0.5.
 *   cwd
 */
import { call as addScript } from './add-script.mjs';

function generate(kind, axis, speed, radius, amplitude) {
  const ax = axis || 'y';
  const s = Number.isFinite(speed) ? speed : 1;
  switch (kind) {
    case 'spin':
      return `target.rotation.${ax} += ${s} * (dt || 0.016);`;
    case 'orbit': {
      const r = Number.isFinite(radius) ? radius : 3;
      const other = ax === 'y' ? ['x', 'z'] : ax === 'x' ? ['y', 'z'] : ['x', 'y'];
      return `const __t = (performance.now()/1000)*${s}; target.position.${other[0]} = Math.cos(__t)*${r}; target.position.${other[1]} = Math.sin(__t)*${r};`;
    }
    case 'oscillate': {
      const a = Number.isFinite(amplitude) ? amplitude : 0.5;
      return `const __t = (performance.now()/1000)*${s}; target.position.${ax} = (target.userData._base_${ax} = target.userData._base_${ax} ?? target.position.${ax}) + Math.sin(__t*Math.PI*2)*${a};`;
    }
    case 'bob': {
      const a = Number.isFinite(amplitude) ? amplitude : 0.15;
      return `const __t = (performance.now()/1000)*${s}; target.position.y = (target.userData._base_y = target.userData._base_y ?? target.position.y) + Math.sin(__t*Math.PI*2)*${a};`;
    }
    default:
      return `/* unknown motion kind ${JSON.stringify(kind)} */`;
  }
}

export async function call(args = {}, options = {}) {
  const { slug, target, kind, axis, speed, radius, amplitude, cwd } = args;
  if (!slug || !target || !kind) return { success: false, output: '`slug`, `target`, `kind` required.' };
  const code = generate(kind, axis, speed, radius, amplitude);
  const result = await addScript({ slug, target, event: 'tick', code, cwd }, options);
  if (!result.success) return result;
  return { success: true, output: { ...result.output, motion: { kind, axis, speed, radius, amplitude } } };
}
