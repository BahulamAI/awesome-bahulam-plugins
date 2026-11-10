import { getAdoConfig, resolveProject, resolveTeam, adoRequest, toolFailure } from './lib.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };
  try {
    const resource = args.resource || 'projects';
    let path;
    const page = Number(args.page || 0);
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('page must be a nonnegative integer.');
    const paging = `$top=100&$skip=${page * 100}`;
    if (resource === 'projects') {
      path = config.lockedProject ? `_apis/projects/${encodeURIComponent(config.lockedProject)}` : `_apis/projects?$top=100${args.continuation_token ? `&continuationToken=${encodeURIComponent(args.continuation_token)}` : ''}`;
    } else {
      const project = resolveProject(config, args.project);
      if (!project.ok) throw new Error(project.error);
      const p = encodeURIComponent(project.project);
      if (resource === 'teams') path = config.lockedTeam
        ? `_apis/projects/${p}/teams/${encodeURIComponent(config.lockedTeam)}`
        : `_apis/projects/${p}/teams?${paging}`;
      else if (resource === 'areas') path = `${p}/_apis/wit/classificationnodes/areas?$depth=3`;
      else if (resource === 'work_item_types') path = `${p}/_apis/wit/workitemtypes`;
      else {
        const team = resolveTeam(config, args.team);
        if (!team.ok) throw new Error(team.error);
        const t = encodeURIComponent(team.team);
        if (resource === 'members') path = `_apis/projects/${p}/teams/${t}/members?${paging}`;
        else if (resource === 'iterations') path = `${p}/${t}/_apis/work/teamsettings/iterations`;
        else throw new Error('Unknown discovery resource.');
      }
    }
    const data = await adoRequest(config, { path, deps: { ...deps, signal } });
    return { success: true, output: data };
  } catch (error) { return toolFailure(error, 'Discovery failed'); }
}
