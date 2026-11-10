/**
 * Update an existing work item comment — the "update a comment" outcome ADO
 * already supports natively. The agent calls this directly; the only thing
 * this plugin adds is a record of which comment changed and when.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAdoConfig, resolveProject, adoRequest, workItemUrl, toolFailure, positiveId } from './lib.mjs';
import { recordAction } from './action-log.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };

  const id = Number(args.work_item_id);
  const commentId = Number(args.comment_id);
  const text = String(args.text || '').trim();
  if (!positiveId(id)) return { success: false, output: 'work_item_id is required and must be a work item number.' };
  if (!positiveId(commentId)) return { success: false, output: 'comment_id is required — fetch it from a prior add_comment call or the ADO thread.' };
  if (!text) return { success: false, output: 'text is required.' };

  const project = resolveProject(config, args.project);
  if (!project.ok) return { success: false, output: project.error };

  const url = workItemUrl(config, project.project, id);

  try {
    await adoRequest(config, {
      method: 'PATCH',
      path: `${encodeURIComponent(project.project)}/_apis/wit/workItems/${id}/comments/${commentId}`,
      apiVersion: '7.1-preview.4',
      body: { text },
      deps: { ...deps, signal },
    });

    recordAction(state, {
      tool: 'ado_update_comment',
      action: 'update_comment',
      itemType: 'work_item',
      itemId: String(id),
      project: project.project,
      summary: text.length > 160 ? `${text.slice(0, 157)}...` : text,
      targetUrl: url,
      status: 'completed',
    });

    return { success: true, output: { comment_id: commentId, work_item_id: id, url } };
  } catch (error) {
    return toolFailure(error, `Could not update comment ${commentId} on work item ${id}`);
  }
}
