#!/usr/bin/env node
/**
 * hello-mcp bundled MCP server — a stdlib-only stdio MCP server that
 * exposes two tools:
 *
 *   describe_color(hex)          -> RGB, HSL, perceptual luminance, WCAG label
 *   palette_from(hex, mode?)     -> 5-swatch palette (complementary /
 *                                    analogous / triadic — mode defaults
 *                                    to 'analogous')
 *
 * Kept in pure JS (no external deps) so the reference plugin works out
 * of the box — the point is to prove the MCP wiring, not to ship a real
 * color library. A production plugin author would replace this with a
 * uvx-installed Python server, a compiled Go binary, or an npm package.
 */

process.stdin.setEncoding('utf-8');
let buf = '';

process.stdin.on('data', chunk => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { continue; }
    handle(msg).then(res => {
      if (res !== undefined) process.stdout.write(JSON.stringify(res) + '\n');
    });
  }
});

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'notifications/initialized') return;
  try {
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'hex-color', version: '1.0.0' },
        });
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call':
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(await callTool(params), null, 2) }] });
      case 'shutdown':
        return ok(id, {});
      case 'exit':
        process.exit(0);
      default:
        return err(id, -32601, `Unknown method: ${method}`);
    }
  } catch (e) {
    return err(id, -32000, e.message);
  }
}
const ok = (id, result) => id !== undefined ? { jsonrpc: '2.0', id, result } : undefined;
const err = (id, code, message) => id !== undefined ? { jsonrpc: '2.0', id, error: { code, message } } : undefined;

const TOOLS = [
  {
    name: 'describe_color',
    description: 'Convert a hex color to RGB + HSL + luminance + WCAG contrast label',
    inputSchema: {
      type: 'object',
      properties: {
        hex: { type: 'string', description: '#RRGGBB or RRGGBB or short #RGB' },
      },
      required: ['hex'],
    },
  },
  {
    name: 'palette_from',
    description: 'Generate a 5-swatch palette from a seed color',
    inputSchema: {
      type: 'object',
      properties: {
        hex:  { type: 'string' },
        mode: { type: 'string', enum: ['analogous', 'complementary', 'triadic'] },
      },
      required: ['hex'],
    },
  },
];

async function callTool({ name, arguments: args }) {
  if (name === 'describe_color') return describeColor(args.hex);
  if (name === 'palette_from')   return paletteFrom(args.hex, args.mode || 'analogous');
  throw new Error(`Unknown tool: ${name}`);
}

// ── color math (self-contained) ────────────────────────────────────
function parseHex(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`invalid hex color: ${hex}`);
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
const toHex = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function rgbToHsl({ r, g, b }) {
  const R = r/255, G = g/255, B = b/255, max = Math.max(R,G,B), min = Math.min(R,G,B), l = (max+min)/2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case R: h = (G - B) / d + (G < B ? 6 : 0); break;
      case G: h = (B - R) / d + 2; break;
      case B: h = (R - G) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const hue2rgb = (t) => { t = (t + 1) % 1; if (t < 1/6) return p + (q - p) * 6 * t; if (t < 1/2) return q; if (t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p; };
  return { r: hue2rgb(h + 1/3) * 255, g: hue2rgb(h) * 255, b: hue2rgb(h - 1/3) * 255 };
}
function relLuminance({ r, g, b }) {
  const c = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v + 0.055)/1.055, 2.4); };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function describeColor(hex) {
  const rgb = parseHex(hex);
  const hsl = rgbToHsl(rgb);
  const l = relLuminance(rgb);
  const contrastWhite = (1.0 + 0.05) / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  const better = contrastWhite > contrastBlack ? 'white' : 'black';
  const contrast = Math.max(contrastWhite, contrastBlack);
  const wcag = contrast >= 7 ? 'AAA' : contrast >= 4.5 ? 'AA' : contrast >= 3 ? 'AA Large' : 'fail';
  return {
    hex: toHex(rgb),
    rgb: { r: rgb.r, g: rgb.g, b: rgb.b },
    hsl: { h: Math.round(hsl.h), s: Math.round(hsl.s), l: Math.round(hsl.l) },
    luminance: Math.round(l * 1000) / 1000,
    best_text: better,
    contrast_ratio: Math.round(contrast * 10) / 10,
    wcag,
  };
}
function paletteFrom(hex, mode) {
  const rgb = parseHex(hex);
  const hsl = rgbToHsl(rgb);
  const shifts = mode === 'complementary' ? [-30, -15, 0, 165, 180]
              : mode === 'triadic'        ? [-30, 0, 30, 120, 240]
              :                             [-40, -20, 0, 20, 40];
  return {
    mode,
    seed: toHex(rgb),
    swatches: shifts.map(dh => toHex(hslToRgb({ h: hsl.h + dh, s: hsl.s, l: hsl.l }))),
  };
}
