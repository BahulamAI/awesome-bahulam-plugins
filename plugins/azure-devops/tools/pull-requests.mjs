import { getAdoConfig, resolveProject, adoRequest, positiveId, toolFailure } from './lib.mjs';
import { recordAction } from './action-log.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };
  const project = resolveProject(config, args.project);
  if (!project.ok) return { success: false, output: project.error };
  try {
    const p = encodeURIComponent(project.project);
    const action = args.action || 'repositories';
    let path = `${p}/_apis/git/repositories`;
    let body;
    if (action !== 'repositories') {
      if (!args.repository) throw new Error('repository is required.');
      path += `/${encodeURIComponent(args.repository)}/pullrequests`;
      if (action === 'list') path += '?searchCriteria.status=active&$top=100';
      else if (action === 'get') {
        if (!positiveId(args.pull_request_id)) throw new Error('A positive pull_request_id is required.');
        path += `/${Number(args.pull_request_id)}`;
      } else if (action === 'create') {
        if (!args.title || !args.source_branch?.startsWith('refs/heads/') || !args.target_branch?.startsWith('refs/heads/')) {
          throw new Error('title and source_branch/target_branch starting with refs/heads/ are required.');
        }
        body = { title: args.title, description: args.description || '', sourceRefName: args.source_branch, targetRefName: args.target_branch };
      } else throw new Error('Unknown pull request action.');
    }
    const data = await adoRequest(config, { method: body ? 'POST' : 'GET', path, body, deps: { ...deps, signal } });
    if (body) recordAction(state, { tool: 'ado_pull_requests', action: 'create_pull_request', itemType: 'pull_request', itemId: data.pullRequestId,
      project: project.project, summary: args.title,
      targetUrl: `https://dev.azure.com/${config.organization}/${p}/_git/${encodeURIComponent(args.repository)}/pullrequest/${data.pullRequestId}` });
    return { success: true, output: data };
  } catch (error) { return toolFailure(error, 'Pull request operation failed'); }
}
