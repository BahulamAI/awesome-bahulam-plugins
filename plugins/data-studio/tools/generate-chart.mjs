/**
 * generate_chart — return an HTML chart spec rendered from dataset columns.
 *
 * Strategy: output a portable chart spec that the workspace view renders
 * using a tiny ECharts-like renderer. No external dependencies — the spec
 * is translated to a native HTML5 Canvas drawing.
 */

import { get } from './dataset-store.mjs';

export const name = 'generate_chart';
export const description = 'Generate a chart spec from a dataset';

function prepareData(rows, x, y, series) {
  if (series) {
    const grouped = {};
    for (const row of rows) {
      const s = String(row[series] ?? '');
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(row);
    }
    return { series: Object.entries(grouped).map(([name, items]) => ({
      name,
      data: items.map(r => ({ x: r[x], y: r[y.split(',')[0]] })),
    }))};
  }
  return {
    series: [{
      name: y,
      data: rows.map(r => ({ x: r[x], y: r[y.split(',')[0]] })),
    }],
  };
}

export async function call(args = {}) {
  const { dataset, type, x, y, series, title, width = 600, height = 380, options = {} } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };
  if (!type) return { success: false, error: 'chart type is required' };
  if (!x || !y) return { success: false, error: 'x and y columns are required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const chartData = prepareData(entry.data, x, y, series);

  const spec = {
    type,
    title: title || `${y} by ${x}`,
    width,
    height,
    x: { column: x, label: x },
    y: { column: y.split(',')[0], label: y },
    series: chartData.series,
    options,
  };

  // Serialize as inline JSON for the workspace view
  // The view renders using HTML5 Canvas from the JSON spec
  return {
    success: true,
    output: {
      chart: spec,
      html: await renderChartHTML(spec),
    },
  };
}

async function renderChartHTML(spec) {
  const { type, title, series, x, y, width, height } = spec;
  const encoded = encodeURIComponent(JSON.stringify(spec));
  return `<figure class="chart-container" style="width:${width}px;max-width:100%;margin:10px 0">
  <figcaption style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--ws-fg)">${title}</figcaption>
  <canvas class="ds-chart" data-spec='${spec.type === 'pie' ? '' : ''}' width="${width}" height="${height}"
    style="width:${width}px;height:${height}px;border-radius:var(--ws-radius-sm);background:var(--ws-panel)"
    data-chart='${encoded}'></canvas>
  <div class="chart-legend" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font-size:11px;color:var(--ws-muted)"></div>
</figure>`;
}