import { Research } from '../core/research.mjs';

export function handler(method) {
  return async (args = {}, options = {}) => {
    try {
      const state = await options.state;
      if (!state) throw new Error('Open this plugin in a Bahulam workspace with SQLite state');
      const service = new Research(state);
      return { success: true, output: await service[method](args) };
    } catch (e) { return { success: false, output: e.message || 'Research operation failed' }; }
  };
}
