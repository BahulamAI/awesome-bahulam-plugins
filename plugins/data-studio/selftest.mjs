/**
 * Offline smoke test for the data-studio plugin tool modules.
 * Run: node plugins/data-studio/selftest.mjs
 * Creates temp test files so no external data is needed.
 */

import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { call as loadDataset } from './tools/load-dataset.mjs';
import { call as inspectData } from './tools/inspect-data.mjs';
import { call as describeStats } from './tools/describe-stats.mjs';
import { call as filterRows } from './tools/filter-rows.mjs';
import { call as groupAggregate } from './tools/group-aggregate.mjs';
import { call as sortData } from './tools/sort-data.mjs';
import { call as selectColumns } from './tools/select-columns.mjs';
import { call as detectOutliers } from './tools/detect-outliers.mjs';
import { call as generateChart } from './tools/generate-chart.mjs';
import { call as generateReport } from './tools/generate-report.mjs';
import { call as exportData } from './tools/export-data.mjs';
import { clear } from './tools/dataset-store.mjs';

let failures = 0;
function check(label, cond, detail = '') {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'ds-test-'));
const csvPath = join(tmpDir, 'test.csv');
writeFileSync(csvPath, 'city,population,area_km2,country\nTokyo,13960000,2194,Japan\nDelhi,16790000,1484,India\nShanghai,24870000,6341,China\nMumbai,12480000,603,India\nOsaka,19280000,2230,Japan\n');

const jsonPath = join(tmpDir, 'test.json');
writeFileSync(jsonPath, JSON.stringify([
  { product: 'Widget A', sales: 120, region: 'North', quarter: 'Q1' },
  { product: 'Widget B', sales: 85, region: 'South', quarter: 'Q1' },
  { product: 'Widget A', sales: 145, region: 'North', quarter: 'Q2' },
  { product: 'Widget B', sales: 95, region: 'South', quarter: 'Q2' },
  { product: 'Widget A', sales: 110, region: 'East', quarter: 'Q1' },
  { product: 'Widget B', sales: 200, region: 'West', quarter: 'Q1' },
]));

// Clean state
clear();

// 1. load_dataset (CSV)
let r = await loadDataset({ path: csvPath, name: 'cities' });
check('load_dataset CSV', r.success && r.output.name === 'cities', `rows=${r.output.rows}`);
check('load_dataset columns', r.output.columns.length === 4);

// 2. load_dataset (JSON)
r = await loadDataset({ path: jsonPath, name: 'sales' });
check('load_dataset JSON', r.success && r.output.name === 'sales', `rows=${r.output.rows}`);

// 3. inspect_data
r = await inspectData({ dataset: 'cities' });
check('inspect_data', r.success && r.output.rows === 5, `sample=${r.output.sample?.length}`);

// 4. describe_stats
r = await describeStats({ dataset: 'cities' });
check('describe_stats', r.success && r.output.columns.length === 4, `cols=${r.output.columns.length}`);
check('describe_stats has numeric', r.output.columns.some(c => c.stats?.mean > 0));

// 5. filter_rows
r = await filterRows({ dataset: 'cities', conditions: [{ column: 'country', op: 'eq', value: 'Japan' }] });
check('filter_rows Japan', r.success && r.output.after === 2, `after=${r.output.after}`);

// 6. group_aggregate
r = await groupAggregate({
  dataset: 'sales',
  by: ['region'],
  aggregations: [{ column: 'sales', as: 'total_sales', fn: 'sum' }]
});
check('group_aggregate', r.success && r.output.rows >= 3, `groups=${r.output.groups}`);

// 7. sort_data
r = await sortData({ dataset: 'cities', sort: [{ column: 'population', direction: 'desc' }] });
check('sort_data desc', r.success && r.output.rows === 5);

// 8. select_columns
r = await selectColumns({ dataset: 'cities', columns: ['city', 'country'] });
check('select_columns', r.success && r.output.columns.length === 2);

// 9. detect_outliers
r = await detectOutliers({ dataset: 'cities', column: 'population' });
check('detect_outliers', r.success && r.output.outliers >= 0);

// 10. generate_chart
r = await generateChart({ dataset: 'cities', type: 'bar', x: 'city', y: 'population' });
check('generate_chart', r.success && r.output.chart?.type === 'bar', `html=${Boolean(r.output.html)}`);

// 11. generate_report
r = await generateReport({ dataset: 'cities', title: 'City Analysis', sections: ['overview', 'stats', 'missing'] });
check('generate_report', r.success && r.output.report?.startsWith('#'), `len=${r.output.report?.length}`);

// 12. export_data (CSV)
const outPath = join(tmpDir, 'export.csv');
r = await exportData({ dataset: 'cities', path: outPath });
check('export_data', r.success && r.output.rows === 5, `fmt=${r.output.format}`);

// Cleanup
try { unlinkSync(csvPath); unlinkSync(jsonPath); unlinkSync(outPath); } catch(e) {}

console.log(`\n${failures === 0 ? '✅ All tests passed' : '❌ ' + failures + ' test(s) failed'}`);
process.exit(failures > 0 ? 1 : 0);