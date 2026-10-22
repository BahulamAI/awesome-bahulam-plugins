import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const runtime = process.env.BAHULAM_RUNTIME;
if (!runtime) throw new Error('Set BAHULAM_RUNTIME to the codekepler-npm checkout');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'research-runtime-'));
process.env.BAHULAM_HOME = fixture;
try {
  const { parsePluginManifestFile } = await import(pathToFileURL(path.join(runtime, 'src/plugins/manifest.mjs')));
  const { createPluginToolExecutor } = await import(pathToFileURL(path.join(runtime, 'src/plugins/executor.mjs')));
  const manifest = parsePluginManifestFile(path.join(root, 'plugin.yaml'));
  assert.equal(manifest.metadata.name, 'app-research');
  assert.equal(manifest.config.views.length, 5);
  assert.ok(manifest.config.agents.some(a => a.entry_agent));
  const director = manifest.config.agents.find(a => a.entry_agent);
  for (const tool of ['research_dashboard', 'research_app_save', 'research_run_create', 'research_run_limits_update', 'research_collect', 'research_run_control', 'research_source_get', 'research_source_import', 'research_sources_import', 'research_source_annotate', 'research_evidence_record', 'research_evidence_review', 'research_analysis_done', 'research_source_remove', 'research_outcome_record', 'research_export', 'research_artifact_get']) {
    assert.ok(director.tools.includes(tool), `director agent can use ${tool}`);
  }
  assert.ok(!director.tools.includes('research_run_delete'), 'run deletion remains UI-only');
  const executor = await createPluginToolExecutor(manifest);
  assert.equal(executor.list().length, 18);
  const config = {
    name: 'Runtime test idea',
    brief: 'Synthetic fixture used only to verify plugin state persistence.',
    audiences: ['Runtime test audience'],
    hypotheses: [{ id: 'H1', statement: 'The synthetic test brief can be stored and retrieved.' }],
    country: 'US', language: 'en',
    criteria: { direct: 2, contexts: 1, families: 1, consequences: 1, months: 24 }
  };
  const app = await executor.execute('research_app_save', { config });
  assert.equal(app.success, true, app.output);
  const dashboard = await executor.execute('research_dashboard', { app_id: app.output.id });
  assert.equal(dashboard.success, true, dashboard.output);
  assert.equal(dashboard.output.apps[0].name, 'Runtime test idea');
  assert.equal(dashboard.output.evidence.length, 0);
  executor.state.close();
  console.log('Bahulam manifest, agents, five panels, 18 panel tools, and native SQLite persistence verified.');
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
