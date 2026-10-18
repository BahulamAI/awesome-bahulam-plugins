/**
 * Create a work item. The created item is the outcome, living in Azure
 * DevOps as a normal work item; this plugin records that it was created and
 * links to it.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAdoConfig, resolveProject, adoRequest, workItemUrl, toolFailure, positiveId } from './lib.mjs';
import { recordAction } from './action-log.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };

  const type = String(args.type || '').trim();
  const title = String(args.title || '').trim();
  if (!type) return { success: false, output: 'type is required, e.g. "Bug", "Task", "User Story".' };
  if (!title) return { success: false, output: 'title is required.' };

  const project = resolveProject(config, args.project);
  if (!project.ok) return { success: false, output: project.error };

  const patch = [{ op: 'add', path: '/fields/System.Title', value: title }];
  if (args.description) patch.push({ op: 'add', path: '/fields/System.Description', value: String(args.description) });
  if (args.assigned_to) patch.push({ op: 'add', path: '/fields/System.AssignedTo', value: String(args.assigned_to) });
  if (Array.isArray(args.tags) && args.tags.length) patch.push({ op: 'add', path: '/fields/System.Tags', value: args.tags.join('; ') });

  if (args.area_path) patch.push({ op: 'add', path: '/fields/System.AreaPath', value: String(args.area_path) });
  if (args.iteration_path) patch.push({ op: 'add', path: '/fields/System.IterationPath', value: String(args.iteration_path) });

  try {
    const item = await adoRequest(config, {
      method: 'POST',
      path: `${encodeURIComponent(project.project)}/_apis/wit/workitems/$${encodeURIComponent(type)}`,
      contentType: 'application/json-patch+json',
      body: patch,
      deps: { ...deps, signal },
    });

    const url = workItemUrl(config, project.project, item.id);

    recordAction(state, {
      tool: 'ado_create_work_item',
      action: 'create',
      itemType: 'work_item',
      itemId: String(item.id),
      project: project.project,
      summary: `${type}: ${title}`,
      targetUrl: url,
      status: 'completed',
    });

    return { success: true, output: { work_item_id: item.id, type, title, url } };
  } catch (error) {
    return toolFailure(error, `Could not create ${type} "${title}"`);
  }
}
