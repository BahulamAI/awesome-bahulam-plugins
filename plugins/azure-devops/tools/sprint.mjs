import { getAdoConfig, resolveProject, resolveTeam, adoRequest, summarizeItem, toolFailure } from './lib.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };
  const project = resolveProject(config, args.project);
  const team = resolveTeam(config, args.team);
  if (!project.ok || !team.ok) return { success: false, output: project.error || team.error };
  try {
    const p = encodeURIComponent(project.project);
    const base = `${p}/${encodeURIComponent(team.team)}/_apis/work/teamsettings/iterations`;
    const requestDeps = { ...deps, signal };
    const iterations = await adoRequest(config, { path: `${base}?$timeframe=current`, deps: requestDeps });
    if (iterations.value?.length !== 1) return { success: false, output: 'No unique current iteration. Check this team’s sprint dates in ADO.' };
    const iteration = iterations.value[0];
    const links = await adoRequest(config, { path: `${base}/${encodeURIComponent(iteration.id)}/workitems`, deps: requestDeps });
    const ids = [...new Set((links.workItemRelations || []).map(link => link.target?.id).filter(Boolean))];
    const items = [];
    for (let i = 0; i < ids.length; i += 200) {
      const batch = await adoRequest(config, { method: 'POST', path: `${p}/_apis/wit/workitemsbatch`, body: { ids: ids.slice(i, i + 200) }, deps: requestDeps });
      items.push(...batch.value.map(item => summarizeItem(config, project.project, item)));
    }
    const byState = {};
    const byAssignee = {};
    for (const item of items) {
      byState[item.state] = (byState[item.state] || 0) + 1;
      const owner = item.assigned_to || 'Unassigned';
      byAssignee[owner] = (byAssignee[owner] || 0) + 1;
    }
    return { success: true, output: { iteration, total: items.length, by_state: byState, by_assignee: byAssignee, items } };
  } catch (error) { return toolFailure(error, 'Sprint lookup failed'); }
}
