/**
 * Add a comment to a work item. Comments are the outcome the agent is
 * performing directly against Azure DevOps — the comment itself lives in
 * ADO's own discussion thread; this plugin only records that the action
 * happened.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAdoConfig, resolveProject, adoRequest, workItemUrl, toolFailure, positiveId } from './lib.mjs';
import { recordAction } from './action-log.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };

  const id = Number(args.work_item_id);
  const text = String(args.text || '').trim();
  if (!positiveId(id)) return { success: false, output: 'work_item_id is required and must be a work item number.' };
  if (!text) return { success: false, output: 'text is required.' };

  const project = resolveProject(config, args.project);
  if (!project.ok) return { success: false, output: project.error };

  const url = workItemUrl(config, project.project, id);

  try {
    const comment = await adoRequest(config, {
      method: 'POST',
      path: `${encodeURIComponent(project.project)}/_apis/wit/workItems/${id}/comments`,
      apiVersion: '7.1-preview.4',
      body: { text },
      deps: { ...deps, signal },
    });

    recordAction(state, {
      tool: 'ado_add_comment',
      action: 'comment',
      itemType: 'work_item',
      itemId: String(id),
      project: project.project,
      summary: text.length > 160 ? `${text.slice(0, 157)}...` : text,
      targetUrl: url,
      status: 'completed',
    });

    return {
      success: true,
      output: { comment_id: comment.id, work_item_id: id, url },
    };
  } catch (error) {
    return toolFailure(error, `Could not comment on work item ${id}`);
  }
}
