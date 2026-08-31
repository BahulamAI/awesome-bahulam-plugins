/**
 * hello — the simplest possible plugin tool.
 *
 * Handler contract (see docs.bahulam.ai/plugins §1.3):
 *   - export const name (optional; defaults to filename)
 *   - export const description (optional; falls back to manifest)
 *   - export async function call(args, options) => { success, output }
 *
 * `options.signal` is an AbortSignal you should honor for long work.
 * `options.pluginName` is the manifest name (for logging / attribution).
 */

export const name = 'hello';
export const description = 'Return a friendly greeting';

export async function call(args = {}) {
  const target = String(args.name || 'world').trim() || 'world';
  const shout = Boolean(args.shout);
  const message = `Hello, ${target}! Welcome to Bahulam plugins.`;
  return {
    success: true,
    output: {
      message: shout ? message.toUpperCase() : message,
      length: message.length,
      shouted: shout,
    },
  };
}
