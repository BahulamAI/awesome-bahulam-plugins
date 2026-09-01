/**
 * Offline smoke test for hello-mcp. Two goals:
 *   1. Verify the bundled MCP server speaks the protocol correctly.
 *   2. Verify the JS tools (save_palette / list_palettes) round-trip
 *      through a fake Shared Blackboard.
 *
 * Run: node plugins/hello-mcp/selftest.mjs
 */

import { spawn } from 'node:child_process';
import { call as saveCall } from './tools/save-palette.mjs';
import { call as listCall } from './tools/list-palettes.mjs';

let failures = 0;
function check(label, cond, detail = '') {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

// ── MCP server round-trip ────────────────────────────────────────────
async function mcpCall(child, msg) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const res = JSON.parse(line);
          if (res.id === msg.id) {
            child.stdout.off('data', onData);
            resolve(res);
            return;
          }
        } catch { /* keep buffering */ }
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(JSON.stringify(msg) + '\n');
    setTimeout(() => { child.stdout.off('data', onData); reject(new Error('mcp timeout')); }, 3000);
  });
}

{
  const child = spawn('node', ['./mcp-server/hex-color.mjs'], {
    cwd: new URL('.', import.meta.url).pathname,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const init = await mcpCall(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  check('mcp: initialize responds with protocol version',
    init?.result?.protocolVersion === '2024-11-05');

  const tools = await mcpCall(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = (tools?.result?.tools || []).map(t => t.name).sort();
  check('mcp: tools/list returns describe_color + palette_from',
    JSON.stringify(names) === JSON.stringify(['describe_color', 'palette_from']));

  const desc = await mcpCall(child, {
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'describe_color', arguments: { hex: '#000000' } },
  });
  const descPayload = JSON.parse(desc?.result?.content?.[0]?.text || '{}');
  check('mcp: describe_color(black) → luminance 0, best_text white',
    descPayload.luminance === 0 && descPayload.best_text === 'white');

  const pal = await mcpCall(child, {
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'palette_from', arguments: { hex: '#0891B2', mode: 'analogous' } },
  });
  const palPayload = JSON.parse(pal?.result?.content?.[0]?.text || '{}');
  check('mcp: palette_from returns 5 swatches',
    Array.isArray(palPayload.swatches) && palPayload.swatches.length === 5);

  child.kill();
}

// ── JS tools + shared blackboard round-trip ─────────────────────────
{
  const rows = [];
  const fakeState = {
    append(stream, payload) {
      rows.push({ id: rows.length + 1, stream, payload, created_at: new Date(0).toISOString() });
      return rows.length;
    },
    list(stream, { limit = 50, order = 'desc' } = {}) {
      const filtered = rows.filter(r => r.stream === stream);
      const ordered = order === 'asc' ? filtered : [...filtered].reverse();
      return ordered.slice(0, limit);
    },
  };
  const opts = { state: Promise.resolve(fakeState) };

  const bad = await saveCall({ name: '', seed: '', swatches: [] }, opts);
  check('save_palette rejects missing fields', bad.success === false);

  const ok = await saveCall({
    name: 'Ocean at Dawn', seed: '#0891B2', mode: 'analogous',
    swatches: ['#a', '#b', '#c'],
  }, opts);
  check('save_palette succeeds with valid input', ok.success && ok.output.id === 1);

  const listed = await listCall({ limit: 10 }, opts);
  check('list_palettes returns the saved row',
    listed.success && listed.output.count === 1 && listed.output.palettes[0].name === 'Ocean at Dawn');
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
