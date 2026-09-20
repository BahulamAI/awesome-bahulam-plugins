/**
 * generate_report — produce a markdown analysis report from a dataset
 */

import { get } from './dataset-store.mjs';

export const name = 'generate_report';
export const description = 'Generate a markdown analysis report from a dataset';

function numericStats(values) {
  const valid = values.filter(v => v !== null && v !== '' && v !== undefined).map(Number).filter(n => !isNaN(n));
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const n = valid.length;
  const mean = valid.reduce((s, v) => s + v, 0) / n;
  return {
    count: n, mean: mean.toFixed(2),
    min: sorted[0], max: sorted[n - 1],
    median: (n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]).toFixed(2),
  };
}

function categoricalStats(values) {
  const valid = values.filter(v => v !== null && v !== '' && v !== undefined);
  const unique = new Set(valid.map(v => String(v)));
  return { count: valid.length, unique: unique.size };
}

function correlationMatrix(data, numCols) {
  const n = data.length;
  const result = {};
  for (const a of numCols) {
    result[a.name] = {};
    for (const b of numCols) {
      if (a.name === b.name) { result[a.name][b.name] = 1; continue; }
      const va = data.map(r => Number(r[a.name])).filter(n => !isNaN(n));
      const vb = data.map(r => Number(r[b.name])).filter(n => !isNaN(n));
      // Pairwise
      const pairs = data.map(r => [Number(r[a.name]), Number(r[b.name])]).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
      const n2 = pairs.length;
      if (n2 < 3) { result[a.name][b.name] = 0; continue; }
      const ma = pairs.reduce((s, p) => s + p[0], 0) / n2;
      const mb = pairs.reduce((s, p) => s + p[1], 0) / n2;
      const num = pairs.reduce((s, p) => s + (p[0] - ma) * (p[1] - mb), 0);
      const da = Math.sqrt(pairs.reduce((s, p) => s + (p[0] - ma) ** 2, 0));
      const db = Math.sqrt(pairs.reduce((s, p) => s + (p[1] - mb) ** 2, 0));
      result[a.name][b.name] = (da && db) ? (num / (da * db)).toFixed(3) : 0;
    }
  }
  return result;
}

export async function call(args = {}) {
  const { dataset, title, sections = ['overview', 'stats', 'missing', 'distributions'], notes, format = 'markdown' } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };
  if (!title) return { success: false, error: 'report title is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const { data, meta } = entry;
  const cols = meta.columns || [];
  const numCols = cols.filter(c => c.type === 'float' || c.type === 'integer');
  const catCols = cols.filter(c => c.type === 'string' || c.type === 'date');

  let md = `# ${title}\n\n`;
  md += `**Dataset:** \`${dataset}\` · **${data.length} rows** · **${cols.length} columns**\n\n`;

  if (sections.includes('overview')) {
    md += `## Overview\n\n`;
    md += `| Column | Type | Non-null |\n|-------|------|----------|\n`;
    for (const col of cols) {
      const nonNull = data.filter(r => r[col.name] !== null && r[col.name] !== '' && r[col.name] !== undefined).length;
      md += `| ${col.name} | ${col.type} | ${nonNull}/${data.length} |\n`;
    }
    md += '\n';
  }

  if (sections.includes('stats')) {
    md += `## Statistical Summary\n\n`;
    if (numCols.length) {
      md += `### Numeric Columns\n\n`;
      md += `| Column | Count | Mean | Median | Min | Max |\n|-------|-------|------|--------|-----|-----|\n`;
      for (const col of numCols) {
        const s = numericStats(data.map(r => r[col.name]));
        if (s) md += `| ${col.name} | ${s.count} | ${s.mean} | ${s.median} | ${s.min} | ${s.max} |\n`;
      }
      md += '\n';
    }
    if (catCols.length) {
      md += `### Categorical Columns\n\n`;
      md += `| Column | Count | Unique |\n|-------|-------|--------|\n`;
      for (const col of catCols) {
        const s = categoricalStats(data.map(r => r[col.name]));
        md += `| ${col.name} | ${s.count} | ${s.unique} |\n`;
      }
      md += '\n';
    }
  }

  if (sections.includes('missing')) {
    md += `## Missing Values\n\n`;
    const missing = cols.map(col => ({
      name: col.name,
      count: data.filter(r => r[col.name] === null || r[col.name] === '' || r[col.name] === undefined).length,
    })).filter(c => c.count > 0);
    if (missing.length) {
      md += `| Column | Missing | % |\n|-------|---------|---|\n`;
      for (const m of missing) {
        md += `| ${m.name} | ${m.count} | ${(m.count / data.length * 100).toFixed(1)}% |\n`;
      }
    } else {
      md += `No missing values found.\n`;
    }
    md += '\n';
  }

  if (sections.includes('distributions') && numCols.length) {
    md += `## Distributions\n\n`;
    for (const col of numCols) {
      const vals = data.map(r => Number(r[col.name])).filter(n => !isNaN(n));
      if (!vals.length) continue;
      const min = Math.min(...vals), max = Math.max(...vals);
      const bins = 10;
      const binW = (max - min) / bins || 1;
      const hist = new Array(bins).fill(0);
      for (const v of vals) {
        const idx = Math.min(Math.floor((v - min) / binW), bins - 1);
        hist[idx]++;
      }
      const maxFreq = Math.max(...hist);
      md += `### ${col.name}\n\n`;
      md += '```\n';
      for (let i = 0; i < bins; i++) {
        const bar = '█'.repeat(Math.round(hist[i] / maxFreq * 30));
        md += `${(min + i * binW).toFixed(1)}–${(min + (i + 1) * binW).toFixed(1)} │${bar} ${hist[i]}\n`;
      }
      md += '```\n\n';
    }
  }

  if (sections.includes('outliers') && numCols.length) {
    md += `## Potential Outliers\n\n`;
    for (const col of numCols) {
      const vals = data.map(r => Number(r[col.name])).filter(n => !isNaN(n));
      if (vals.length < 4) continue;
      const sorted = [...vals].sort((a, b) => a - b);
      const q1 = sorted[Math.round(sorted.length * 0.25)];
      const q3 = sorted[Math.round(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr;
      const outliers = vals.filter(v => v < lower || v > upper);
      if (outliers.length) {
        md += `- **${col.name}**: ${outliers.length}/${vals.length} outliers (IQR method: <${lower.toFixed(2)} or >${upper.toFixed(2)})\n`;
      }
    }
    md += '\n';
  }

  if (sections.includes('correlations') && numCols.length >= 2) {
    md += `## Correlation Matrix\n\n`;
    const corr = correlationMatrix(data, numCols);
    md += `| |${numCols.map(c => ` ${c.name} |`).join('')}\n`;
    md += `|---|${numCols.map(() => '---|').join('')}\n`;
    for (const a of numCols) {
      md += `| ${a.name} |${numCols.map(b => ` ${corr[a.name][b.name]} |`).join('')}\n`;
    }
    md += '\n';
  }

  if (notes) {
    md += `## Notes\n\n${notes}\n\n`;
  }

  if (format === 'json') {
    return { success: true, output: { title, dataset, rows: data.length, report: md, sections } };
  }

  return {
    success: true,
    output: {
      title,
      dataset,
      rows: data.length,
      report: md,
      markdown: md,
      sections,
    },
  };
}