/**
 * Update one or more fields on a work item — including state transitions
 * (e.g. moving to "Closed" or "Removed").
 *
 * The agent decides when a change is sensitive enough to need a human's
 * go-ahead by setting `requires_approval`. When it does, this tool refuses
 * to call Azure DevOps until a follow-up call repeats the same change with
 * `approved: true` — mirroring how a browser-automation plugin refuses to
 * click submit until told the user signed off. Both calls are recorded, so
 * the action log shows the proposal and, separately, whether it went ahead.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAdoConfig, resolveProject, adoRequest, workItemUrl, toolFailure, positiveId } from './lib.mjs';
import { recordAction } from './action-log.mjs';

export async function call(args = {}, { state, connection, deps = {}, signal } = {}) {
  const config = getAdoConfig(state, connection);
  if (!config.ready) return { success: false, output: config.error };
  if (config.lockedProject && Object.keys(args.fields || {}).some(key => key.toLowerCase() === 'system.teamproject')) {
    return { success: false, output: 'Moving work items between projects is not allowed by this connection.' };
  }

  const id = Number(args.work_item_id);
  const fields = args.fields && typeof args.fields === 'object' && !Array.isArray(args.fields) ? args.fields : null;
  if (!positiveId(id)) return { success: false, output: 'work_item_id is required and must be a work item number.' };
  if (!fields || !Object.keys(fields).length) return { success: false, output: 'fields is required — a map of ADO field reference names to new values, e.g. {"System.State": "Closed"}.' };

  if (Object.keys(fields).some(key => !/^[A-Za-z][A-Za-z0-9_.]*$/.test(key))) return { success: false, output: 'Invalid ADO field reference name.' };

  const project = resolveProject(config, args.project);
  if (!project.ok) return { success: false, output: project.error };

  const url = workItemUrl(config, project.project, id);
  const summary = Object.entries(fields).map(([k, v]) => `${k} -> ${v}`).join(', ');
  const requiresApproval = Boolean(args.requires_approval);
  const approved = Boolean(args.approved);

  if (requiresApproval && !approved) {
    recordAction(state, {
      tool: 'ado_update_work_item',
      action: 'update_field',
      itemType: 'work_item',
      itemId: String(id),
      project: project.project,
      summary,
      targetUrl: url,
      status: 'needs_approval',
      requiresApproval: true,
    });
    return {
      success: false,
      output: {
        needs_approval: true,
        message: `This change (${summary}) is marked as needing approval. Ask the user, then call again with approved: true.`,
      },
    };
  }

  const patch = Object.entries(fields).map(([path, value]) => ({ op: 'add', path: `/fields/${path}`, value }));

  try {
    await adoRequest(config, {
      method: 'PATCH',
      path: `${encodeURIComponent(project.project)}/_apis/wit/workitems/${id}`,
      contentType: 'application/json-patch+json',
      body: patch,
      deps: { ...deps, signal },
    });

    recordAction(state, {
      tool: 'ado_update_work_item',
      action: 'update_field',
      itemType: 'work_item',
      itemId: String(id),
      project: project.project,
      summary,
      targetUrl: url,
      status: requiresApproval ? 'approved' : 'completed',
      requiresApproval,
    });

    return { success: true, output: { work_item_id: id, updated: Object.keys(fields), url } };
  } catch (error) {
    return toolFailure(error, `Could not update work item ${id}`);
  }
}
