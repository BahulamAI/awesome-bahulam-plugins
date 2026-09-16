/**
 * compile_document — write a target format under <slug>/exports/.
 *
 * - md   : re-emit document.md (already kept in sync; force-refresh)
 * - tex  : emit exports/document.tex using venue-specific preamble
 * - pdf  : emit exports/document.pdf via `pandoc` (requires pandoc; if
 *          pdflatex is present, pandoc will use it)
 *
 * Refuses to compile any target if unsupported claims exist unless
 * `allow_unsupported_claims: true` is passed. Draft/exploratory
 * intermediate compiles are fine — pass the flag or fix your claims.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDocument, docPaths, appendEvent, nowIso } from './lib.mjs';
import { compileMarkdown, compileLatex } from './document-compile.mjs';

export async function call(args = {}, options = {}) {
  const { slug, target, allow_unsupported_claims = false, cwd } = args;
  if (!slug || !target) return { success: false, output: '`slug` and `target` required.' };
  if (!['md', 'tex', 'pdf'].includes(target)) {
    return { success: false, output: `\`target\` must be one of: md, tex, pdf` };
  }

  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };

  const unsupported = (doc.claims || []).filter(c => c.verified !== true);
  if (unsupported.length > 0 && !allow_unsupported_claims) {
    return {
      success: false,
      output: {
        message: `Refusing to compile ${target}: ${unsupported.length} unsupported claim(s). Pass allow_unsupported_claims: true to override.`,
        unsupported_claims: unsupported.map(c => ({ id: c.id, text: c.text, section: c.section })),
      },
    };
  }

  const paths = docPaths(slug, cwd);
  const state = options?.state ? await options.state : null;

  if (target === 'md') {
    const md = compileMarkdown(doc);
    fs.writeFileSync(paths.md, md, 'utf-8');
    recordCompile(state, slug, 'md', paths.md, 'ok', `${md.length} bytes`);
    return { success: true, output: { slug, target: 'md', output_path: paths.md, bytes: md.length } };
  }

  if (target === 'tex') {
    const tex = compileLatex(doc);
    const outPath = path.join(paths.exports, 'document.tex');
    fs.mkdirSync(paths.exports, { recursive: true });
    fs.writeFileSync(outPath, tex, 'utf-8');
    // Also copy refs.bib into exports/ so latex can find it
    if (fs.existsSync(paths.bib)) fs.copyFileSync(paths.bib, path.join(paths.exports, 'refs.bib'));
    recordCompile(state, slug, 'tex', outPath, 'ok', `${tex.length} bytes`);
    return { success: true, output: { slug, target: 'tex', output_path: outPath, bytes: tex.length } };
  }

  if (target === 'pdf') {
    // Compile via pandoc; input = document.md (already in sync).
    const outPath = path.join(paths.exports, 'document.pdf');
    fs.mkdirSync(paths.exports, { recursive: true });
    const which = spawnSync('which', ['pandoc'], { encoding: 'utf-8' });
    if (which.status !== 0) {
      const msg = 'pandoc not found on PATH — install pandoc (and pdflatex) to compile PDF, or use target: "tex".';
      recordCompile(state, slug, 'pdf', outPath, 'skipped', msg);
      return { success: false, output: msg };
    }
    const bibArg = fs.existsSync(paths.bib) ? ['--bibliography', paths.bib] : [];
    const result = spawnSync('pandoc', [paths.md, '-o', outPath, ...bibArg, '--citeproc'], { encoding: 'utf-8' });
    if (result.status !== 0) {
      const errTail = (result.stderr || '').split('\n').slice(-8).join('\n');
      recordCompile(state, slug, 'pdf', outPath, 'error', errTail);
      return { success: false, output: { message: 'pandoc failed', stderr: errTail } };
    }
    recordCompile(state, slug, 'pdf', outPath, 'ok', 'compiled via pandoc');
    return { success: true, output: { slug, target: 'pdf', output_path: outPath } };
  }

  return { success: false, output: `Unreachable: unknown target "${target}"` };
}

function recordCompile(state, slug, target, outputPath, status, notes) {
  if (state && typeof state.query === 'function') {
    try {
      state.query(
        `INSERT INTO research_compilations (slug, target, output_path, status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [slug, target, outputPath, status, notes || '', nowIso()],
      );
    } catch { /* table may not exist in tests */ }
  }
  appendEvent(state, 'compilations', { slug, target, output_path: outputPath, status, notes, at: nowIso() });
}
