import { getAdoConfig, resolveProject, adoRequest, summarizeItem, toolFailure } from './lib.mjs';

const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };
  const project = resolveProject(config, args.project);
  if (!project.ok) return { success: false, output: project.error };
  try {
    const limit = args.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('limit must be between 1 and 200.');
    const filters = [`[System.TeamProject] = ${literal(project.project)}`];
    if (args.mine) filters.push('[System.AssignedTo] = @Me');
    for (const [arg, field] of Object.entries({ state: 'System.State', type: 'System.WorkItemType', assigned_to: 'System.AssignedTo', iteration_path: 'System.IterationPath' })) {
      if (args[arg]) filters.push(`[${field}] = ${literal(args[arg])}`);
    }
    if (args.area_path) filters.push(`[System.AreaPath] UNDER ${literal(args.area_path)}`);
    if (args.search) filters.push(`[System.Title] CONTAINS ${literal(args.search)}`);
    const p = encodeURIComponent(project.project);
    const requestDeps = { ...deps, signal };
    const result = await adoRequest(config, { method: 'POST', path: `${p}/_apis/wit/wiql?$top=${limit}`,
      body: { query: `SELECT [System.Id] FROM WorkItems WHERE ${filters.join(' AND ')} ORDER BY [System.ChangedDate] DESC` }, deps: requestDeps });
    const ids = (result.workItems || []).map(item => item.id);
    if (!ids.length) return { success: true, output: { items: [], limit } };
    const items = await adoRequest(config, { method: 'POST', path: `${p}/_apis/wit/workitemsbatch`,
      body: { ids, fields: ['System.Id', 'System.WorkItemType', 'System.Title', 'System.State', 'System.AssignedTo', 'System.AreaPath', 'System.IterationPath'] }, deps: requestDeps });
    return { success: true, output: { items: items.value.map(item => summarizeItem(config, project.project, item)), limit, possibly_truncated: ids.length === limit } };
  } catch (error) { return toolFailure(error, 'Work item search failed'); }
}
