/**
 * check_claim_hierarchy — validate the patent claims_tree.
 *
 * Reports:
 *   - orphaned dependent claims (depends_on points nowhere)
 *   - cycles (a chain that loops)
 *   - depth of the longest chain (USPTO discourages > 4)
 *   - count of independent vs dependent
 *
 * Pure query.
 */
import { loadDocument } from './lib.mjs';

export async function call(args = {}) {
  const { slug, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  if (doc.kind !== 'patent_application' || !doc.patent) return { success: false, output: `Document has no patent block.` };
  const tree = doc.patent.claims_tree || [];

  const byId = new Map(tree.map(c => [c.id, c]));
  const orphans = [];
  const cycles = [];
  const depths = new Map();

  function depth(id, seen = new Set()) {
    if (seen.has(id)) { cycles.push([...seen, id]); return Infinity; }
    if (depths.has(id)) return depths.get(id);
    const claim = byId.get(id);
    if (!claim) return 0;
    if (claim.kind === 'independent') { depths.set(id, 1); return 1; }
    if (!byId.has(claim.depends_on)) { orphans.push({ id, missing_parent: claim.depends_on }); depths.set(id, 1); return 1; }
    const d = 1 + depth(claim.depends_on, new Set([...seen, id]));
    depths.set(id, d);
    return d;
  }

  for (const c of tree) depth(c.id);

  const independents = tree.filter(c => c.kind === 'independent').length;
  const dependents = tree.filter(c => c.kind === 'dependent').length;
  const maxDepth = tree.length ? Math.max(...[...depths.values()].map(d => Number.isFinite(d) ? d : 0)) : 0;

  const warnings = [];
  if (independents === 0) warnings.push({ kind: 'no_independent_claim' });
  if (maxDepth > 4) warnings.push({ kind: 'deep_hierarchy', max_depth: maxDepth });

  return {
    success: true,
    output: {
      count: tree.length,
      independents,
      dependents,
      max_depth: maxDepth,
      orphans,
      cycles,
      warnings,
      ok: orphans.length === 0 && cycles.length === 0 && independents > 0,
    },
  };
}
