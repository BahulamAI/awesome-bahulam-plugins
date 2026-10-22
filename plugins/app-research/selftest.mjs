import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(path.join(root, 'tests'))
  .filter(file => file.endsWith('.test.mjs'))
  .map(file => path.join('tests', file));
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit'
});
process.exit(result.status ?? 1);
