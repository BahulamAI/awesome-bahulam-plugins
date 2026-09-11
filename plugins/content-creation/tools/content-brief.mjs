import fs from 'node:fs';
import path from 'node:path';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function call(args = {}, options = {}) {
  const name = String(args.name || '').trim().toLowerCase();
  if (!SLUG_RE.test(name)) {
    return { success: false, output: `Invalid name '${name}' - use a lowercase slug like launch-thread.` };
  }
  const objective = String(args.objective || '').trim();
  const audience = String(args.audience || '').trim();
  if (!objective || !audience) return { success: false, output: 'objective and audience are required.' };

  const channels = Array.isArray(args.channels) ? args.channels.map(String).filter(Boolean) : [];
  const formats = Array.isArray(args.formats) && args.formats.length ? args.formats.map(String) : ['image', 'copy'];
  const style = String(args.style || '').trim();
  const acceptance = String(args.acceptance || '').trim();
  const root = path.join(process.cwd(), '.bahulam', 'tmp', 'content-creation', 'packages', name);
  fs.mkdirSync(root, { recursive: true });
  const brief = {
    name,
    objective,
    audience,
    channels,
    formats,
    style,
    acceptance,
    package_dir: root,
    created_at: new Date().toISOString(),
  };
  const briefPath = path.join(root, 'brief.json');
  fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf-8');

  const state = options.state ? await options.state : null;
  if (state) {
    state.set?.('content_state', { active_package: name, package_dir: root, formats });
    state.append?.('briefs', { ...brief, brief_path: briefPath });
    state.append?.('assets', { name, kind: 'brief', path: briefPath, status: 'draft', notes: objective });
  }
  return { success: true, output: brief, brief_path: briefPath, package_dir: root };
}
