/**
 * Read a work item. Read-only — nothing is recorded here, because recording
 * exists to track what this plugin changed, not what it looked at.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAdoConfig, resolveProject, adoRequest, workItemUrl, toolFailure, positiveId } from './lib.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };

  const id = Number(args.id);
  if (!positiveId(id)) return { success: false, output: 'id is required and must be a work item number.' };

  const project = resolveProject(config, args.project);
  if (!project.ok) return { success: false, output: project.error };

  try {
    const item = await adoRequest(config, {
      path: `${encodeURIComponent(project.project)}/_apis/wit/workitems/${id}`,
      deps: { ...deps, signal },
    });

    const fields = item.fields || {};
    return {
      success: true,
      output: {
        id: item.id,
        type: fields['System.WorkItemType'],
        title: fields['System.Title'],
        state: fields['System.State'],
        assigned_to: fields['System.AssignedTo']?.displayName || null,
        url: workItemUrl(config, project.project, item.id),
      },
    };
  } catch (error) {
    return toolFailure(error, `Could not read work item ${id}`);
  }
}
