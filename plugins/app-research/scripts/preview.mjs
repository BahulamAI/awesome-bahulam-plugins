// Local development host for the same panels/tools. Real Bahulam provides the
// authenticated workspace, agent relay, settings, and plugin state in production.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { state as openState } from '../tests/helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.RESEARCH_PREVIEW_DATA || path.join(root, '.local');
fs.mkdirSync(dataDir, { recursive: true });
const state = openState(path.join(dataDir, 'preview.db'));
const token = randomBytes(24).toString('hex');
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) {
      if (req.headers['x-bahulam-local-token'] !== token && u.searchParams.get('token') !== token) return json(res, 403, { error: 'Invalid local token' });
      if (u.pathname === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': preview connected\n\n'); req.on('close', () => res.end()); return; }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
      let body = ''; for await (const part of req) { body += part; if (body.length > 2000000) throw new Error('Request too large'); }
      const input = JSON.parse(body || '{}');
      if (u.pathname === '/api/tools/execute') {
        if (!/^research_[a-z_]+$/.test(input.name)) throw new Error('Unknown tool');
        const filename = path.join(root, 'tools', `${input.name}.mjs`);
        if (!fs.existsSync(filename)) throw new Error('Unknown tool');
        const { call } = await import(filename);
        return json(res, 200, { ok: true, result: await call(input.args, { state }) });
      }
      if (u.pathname === '/api/plugin-config/app-research') {
        const key = input.values?.brave_api_key;
        if (typeof key === 'string' && key) state.setConfig('brave_api_key', key);
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/agent/turn') return json(res, 501, { error: 'Agent analysis requires the Bahulam workspace. This local preview supports collection, imports, review, and exports.' });
      return json(res, 404, { error: 'Not found' });
    }
    const filename = path.resolve(root, '.' + decodeURIComponent(u.pathname));
    if (!['workspace', 'app-configs'].some(dir => filename.startsWith(path.join(root, dir) + path.sep)) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(filename)] || 'text/plain';
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); fs.createReadStream(filename).pipe(res);
  } catch (e) { json(res, 400, { ok: false, error: e.message }); }
});
server.listen(Number(process.env.PORT || 4318), '127.0.0.1', () => console.log(`Research preview: http://127.0.0.1:${server.address().port}/workspace/start.html?token=${token}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.closeAllConnections(); server.close(); state.close(); process.exit(0); });
