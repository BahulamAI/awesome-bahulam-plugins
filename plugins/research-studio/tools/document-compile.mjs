/**
 * document-compile.mjs — DSL → Markdown / LaTeX / BibTeX.
 *
 * Compilers are the ONLY place that emit final formats. Every mutation
 * tool produces document.json and calls saveDocument, which calls
 * compileMarkdown + compileBibtex through this file.
 *
 * LaTeX + PDF (via pandoc) run on-demand from compile-document.mjs.
 */

const escapeMd = (s) => String(s || '');
const escapeLatex = (s) => String(s || '')
  .replace(/\\/g, '\\textbackslash{}')
  .replace(/([&%$#_{}])/g, '\\$1')
  .replace(/~/g, '\\textasciitilde{}')
  .replace(/\^/g, '\\textasciicircum{}');

// ── Markdown ─────────────────────────────────────────────────────────────
export function compileMarkdown(doc) {
  const lines = [];
  lines.push(`# ${doc.title || doc.slug}`);
  lines.push('');
  if (doc.authors?.length) {
    lines.push(doc.authors.map(a => a.name + (a.affiliation ? ` (${a.affiliation})` : '')).join(', '));
    lines.push('');
  }
  if (doc.abstract) {
    lines.push('## Abstract');
    lines.push('');
    lines.push(doc.abstract);
    lines.push('');
  }
  if (doc.keywords?.length) {
    lines.push(`**Keywords:** ${doc.keywords.join(', ')}`);
    lines.push('');
  }

  for (const sec of doc.outline || []) {
    lines.push(`## ${sec.heading}`);
    lines.push('');
    const body = doc.sections?.[sec.id]?.content;
    if (body) {
      lines.push(body);
    } else {
      lines.push(`_[section not drafted yet — target ${sec.target_words || '?'} words]_`);
    }
    lines.push('');
    // Cite hints
    const cites = doc.sections?.[sec.id]?.cites || [];
    if (cites.length) {
      lines.push(`_Cites: ${cites.map(c => `[${c}]`).join(', ')}_`);
      lines.push('');
    }
    // Figures inline callouts
    for (const figId of (doc.sections?.[sec.id]?.figures || [])) {
      const fig = (doc.figures || []).find(f => f.id === figId);
      if (fig) {
        lines.push(`![${escapeMd(fig.caption || fig.id)}](${fig.path})`);
        lines.push('');
        if (fig.caption) { lines.push(`**Figure:** ${fig.caption}`); lines.push(''); }
      }
    }
  }

  // Patent claims tree
  if (doc.kind === 'patent_application' && doc.patent?.claims_tree?.length) {
    lines.push('## Claims');
    lines.push('');
    for (const c of doc.patent.claims_tree) {
      const prefix = c.kind === 'dependent' ? `  ${c.id}.` : `${c.id}.`;
      lines.push(`${prefix} ${c.text}`);
      lines.push('');
    }
  }

  // References
  const refIds = Object.keys(doc.references || {});
  if (refIds.length) {
    lines.push('## References');
    lines.push('');
    for (const id of refIds) {
      const r = doc.references[id];
      lines.push(`- **[${id}]** ${formatRefPlain(r)}`);
    }
    lines.push('');
  }

  // TODOs / notes surface at the end for author visibility
  if ((doc.todos || []).length) {
    lines.push('## TODOs');
    for (const t of doc.todos) lines.push(`- [ ] ${t.section ? `(${t.section}) ` : ''}${t.text}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── BibTeX ───────────────────────────────────────────────────────────────
export function compileBibtex(doc) {
  const out = [];
  for (const [id, ref] of Object.entries(doc.references || {})) {
    const type = ref.type || 'misc';
    const fields = ref.fields || {};
    out.push(`@${type}{${id},`);
    const entries = Object.entries(fields).filter(([k, v]) => v != null && v !== '');
    entries.forEach(([k, v], i) => {
      const val = Array.isArray(v)
        ? v.join(k === 'authors' ? ' and ' : ', ')
        : String(v).replace(/[{}]/g, '');
      out.push(`  ${bibKey(k)} = {${val}}${i < entries.length - 1 ? ',' : ''}`);
    });
    out.push('}\n');
  }
  return out.join('\n');
}

// BibTeX field naming: authors → author, editors → editor, journal, booktitle, year, doi, url, pages
function bibKey(k) {
  if (k === 'authors') return 'author';
  if (k === 'editors') return 'editor';
  return k;
}

function formatRefPlain(r) {
  const f = r.fields || {};
  const authors = Array.isArray(f.authors) ? f.authors.join(', ') : (f.authors || '');
  const title = f.title || '';
  const venue = f.booktitle || f.journal || f.publisher || '';
  const year = f.year ? ` (${f.year})` : '';
  const doi = f.doi ? ` doi:${f.doi}` : '';
  return `${authors}${authors ? '. ' : ''}${title}${title ? '. ' : ''}${venue}${year}${doi}`.trim();
}

// ── LaTeX ────────────────────────────────────────────────────────────────
// venue argument selects the document class + preamble bundle.
export function compileLatex(doc, venue) {
  const v = venue || doc.venue || 'arxiv';
  const preamble = latexPreamble(v);
  const lines = [];
  lines.push(preamble);
  lines.push('\\begin{document}');
  lines.push(`\\title{${escapeLatex(doc.title || doc.slug)}}`);
  if (doc.authors?.length) {
    lines.push(`\\author{${doc.authors.map(a => escapeLatex(a.name) + (a.affiliation ? ` \\\\ \\textit{${escapeLatex(a.affiliation)}}` : '')).join(' \\and ')}}`);
  }
  lines.push('\\maketitle');
  if (doc.abstract) {
    lines.push('\\begin{abstract}');
    lines.push(escapeLatex(doc.abstract));
    lines.push('\\end{abstract}');
  }

  for (const sec of doc.outline || []) {
    lines.push(`\\section{${escapeLatex(sec.heading)}}`);
    const body = doc.sections?.[sec.id]?.content;
    if (body) lines.push(latexBody(body, doc, sec.id));
    else lines.push(`\\textit{[section not drafted yet]}`);

    for (const figId of (doc.sections?.[sec.id]?.figures || [])) {
      const fig = (doc.figures || []).find(f => f.id === figId);
      if (!fig) continue;
      lines.push('\\begin{figure}[' + (fig.placement || 'h') + ']');
      lines.push('  \\centering');
      lines.push(`  \\includegraphics[width=0.9\\textwidth]{${fig.path}}`);
      if (fig.caption) lines.push(`  \\caption{${escapeLatex(fig.caption)}}`);
      lines.push(`  \\label{fig:${fig.id}}`);
      lines.push('\\end{figure}');
    }
  }

  if (doc.kind === 'patent_application' && doc.patent?.claims_tree?.length) {
    lines.push('\\section*{Claims}');
    lines.push('\\begin{enumerate}');
    for (const c of doc.patent.claims_tree) {
      lines.push(`  \\item ${escapeLatex(c.text)}`);
    }
    lines.push('\\end{enumerate}');
  }

  if (Object.keys(doc.references || {}).length) {
    lines.push('\\bibliographystyle{' + bibStyleFor(v) + '}');
    lines.push('\\bibliography{refs}');
  }

  lines.push('\\end{document}');
  return lines.join('\n');
}

function latexBody(body, doc, sectionId) {
  // Convert Markdown-lite section body to LaTeX. Very conservative:
  // - \cite{ref} for occurrences of [ref] where ref is in doc.references
  // - **bold** and *italic*
  // - preserve paragraphs
  const cites = new Set(Object.keys(doc.references || {}));
  let out = String(body);
  // Cite: [ref_id] → \cite{ref_id} (only if ref exists)
  out = out.replace(/\[([a-zA-Z0-9_-]+)\]/g, (m, key) => cites.has(key) ? `\\cite{${key}}` : m);
  out = out.replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}');
  out = out.replace(/\*([^*]+)\*/g, '\\textit{$1}');
  return out;
}

function latexPreamble(venue) {
  switch (venue) {
    case 'ieee-conf':
      return `\\documentclass[conference]{IEEEtran}\n\\usepackage{graphicx}\n\\usepackage{cite}\n\\usepackage{hyperref}`;
    case 'neurips':
      return `\\documentclass{article}\n\\usepackage[final]{neurips_2024}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n\\usepackage{cite}`;
    case 'acl':
      return `\\documentclass[11pt]{article}\n\\usepackage{acl}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n\\usepackage{cite}`;
    case 'acm':
      return `\\documentclass[sigconf]{acmart}\n\\usepackage{graphicx}\n\\usepackage{hyperref}`;
    case 'uspto-utility':
      return `\\documentclass[12pt]{article}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{graphicx}\n\\usepackage{setspace}\n\\doublespacing`;
    case 'arxiv':
    default:
      return `\\documentclass[11pt]{article}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n\\usepackage{cite}\n\\usepackage{amsmath}\n\\usepackage{amssymb}`;
  }
}

function bibStyleFor(venue) {
  switch (venue) {
    case 'ieee-conf': return 'IEEEtran';
    case 'neurips':   return 'plainnat';
    case 'acl':       return 'acl_natbib';
    case 'acm':       return 'ACM-Reference-Format';
    default:          return 'plain';
  }
}

// ── USPTO utility application XML ────────────────────────────────────────
// Minimal patent-shaped XML — fields required for a USPTO utility
// application filing (structure follows the USPTO Patent Application
// Publication XML schema conceptually, not byte-for-byte).
export function compileUsptoXml(doc) {
  if (doc.kind !== 'patent_application') {
    throw new Error(`compileUsptoXml: document kind is "${doc.kind}", not patent_application`);
  }
  const patent = doc.patent || {};
  const sections = doc.outline || [];
  const sectionBody = (id) => escapeXml(doc.sections?.[id]?.content || '');

  const inventorsXml = (patent.inventors || []).map(inv => `
      <inventor>
        <first-name>${escapeXml(String(inv.name || '').split(/\s+/)[0] || '')}</first-name>
        <last-name>${escapeXml(String(inv.name || '').split(/\s+/).slice(1).join(' '))}</last-name>
      </inventor>`).join('');

  const claimsXml = (patent.claims_tree || []).map(c => `
    <claim id="claim-${escapeXml(c.id)}" claim-num="${escapeXml(c.id)}">
      ${c.kind === 'dependent' ? `<claim-ref idref="claim-${escapeXml(c.depends_on || '')}"/>` : ''}
      <claim-text>${escapeXml(c.text || '')}</claim-text>
    </claim>`).join('');

  const priorArtXml = (patent.prior_art || []).map(p => {
    const ref = doc.references?.[p.ref_id] || { fields: {} };
    return `
    <us-citation relevance="${escapeXml(p.relevance || '')}">
      <ref-id>${escapeXml(p.ref_id)}</ref-id>
      <title>${escapeXml(ref.fields?.title || '')}</title>
      <year>${escapeXml(String(ref.fields?.year || ''))}</year>
      <doi>${escapeXml(ref.fields?.doi || '')}</doi>
    </us-citation>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<us-patent-application lang="EN" type="${escapeXml(patent.type || 'utility')}">
  <us-bibliographic-data-application>
    <invention-title>${escapeXml(doc.title || doc.slug || '')}</invention-title>
    <priority-date>${escapeXml(patent.priority_date || '')}</priority-date>
    <inventors>${inventorsXml}
    </inventors>
  </us-bibliographic-data-application>
  <abstract><p>${escapeXml(doc.abstract || sectionBody('abstract_pat'))}</p></abstract>
  <description>
    <field>${sectionBody('field')}</field>
    <background>${sectionBody('background')}</background>
    <summary>${sectionBody('summary')}</summary>
    <brief-description-of-drawings>${sectionBody('drawings')}</brief-description-of-drawings>
    <detailed-description>${sectionBody('detailed')}</detailed-description>
  </description>
  <us-references-cited>${priorArtXml}
  </us-references-cited>
  <claims>${claimsXml}
  </claims>
</us-patent-application>
`;
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Named + default export
export default { compileMarkdown, compileBibtex, compileLatex, compileUsptoXml };
