import { getAdoConfig, resolveProject, adoRequest, positiveId, toolFailure } from './lib.mjs';
import { recordAction } from './action-log.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };
  const project = resolveProject(config, args.project);
  if (!project.ok) return { success: false, output: project.error };
  try {
    const p = encodeURIComponent(project.project);
    const action = args.action || 'list';
    const id = args.pipeline_id;
    let path = `${p}/_apis/pipelines?$top=100`;
    let body;
    if (action !== 'list') {
      if (!positiveId(id)) throw new Error('A positive pipeline_id is required.');
      path = `${p}/_apis/pipelines/${Number(id)}/runs`;
      if (action === 'run') {
        body = args.branch ? { resources: { repositories: { self: { refName: args.branch } } } } : {};
      } else if (action !== 'runs') throw new Error('action must be list, runs, or run.');
    }
    const data = await adoRequest(config, { method: body ? 'POST' : 'GET', path, body, deps: { ...deps, signal } });
    if (body) recordAction(state, { tool: 'ado_pipelines', action: 'trigger_pipeline', itemType: 'build', itemId: data.id,
      project: project.project, summary: `Run pipeline ${id}`, targetUrl: data._links?.web?.href || '' });
    return { success: true, output: data };
  } catch (error) { return toolFailure(error, 'Pipeline operation failed'); }
}
