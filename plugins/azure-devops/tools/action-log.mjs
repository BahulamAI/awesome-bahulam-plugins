/**
 * Recording what a tool did into this plugin's own SQLite state.
 *
 * The outcome itself lives in Azure DevOps — it already has a work item
 * history, comment thread and PR timeline, and nothing here duplicates that.
 * What this table adds is a single place the agent (and the person it works
 * for) can see every action this plugin has taken or proposed, across tools
 * and conversations, with a link back to the item it touched.
 *
 * One row per action, not one table per tool, because every action here
 * shares the same shape: a tool did something (or proposed something) to one
 * ADO item, at a point in time, and it either completed, failed, or is
 * waiting on approval.
 */

/**
 * @returns {{ recorded: true, id: number|string } | { recorded: false, reason: string }}
 */
export function recordAction(state, {
  tool,
  action,
  itemType,
  itemId,
  project,
  summary,
  targetUrl,
  status = 'completed',
  requiresApproval = false,
}) {
  if (!state || typeof state.query !== 'function') {
    return { recorded: false, reason: 'plugin state is unavailable' };
  }
  const occurredAt = new Date().toISOString();

  try {
    state.query(
      `INSERT INTO ado_actions
         (occurred_at, tool, action, item_type, item_id, project, summary, target_url, status, requires_approval,
          bahulam_organization_id, bahulam_team_id, actor_id, conversation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        occurredAt,
        String(tool),
        String(action),
        String(itemType),
        String(itemId),
        String(project ?? ''),
        String(summary ?? ''),
        String(targetUrl ?? ''),
        String(status),
        requiresApproval ? 1 : 0,
        state.getConfig?.('bahulam_organization_id') || '',
        state.getConfig?.('bahulam_team_id') || '',
        state.getConfig?.('actor_id') || '',
        state.getConfig?.('conversation_id') || '',
      ],
    );
    const id = state.query('SELECT last_insert_rowid() AS id')?.[0]?.id;
    return id === undefined ? { recorded: false, reason: 'could not identify the recorded action' } : { recorded: true, id };
  } catch (error) {
    // Best-effort by design: a lost log entry costs the action panel a row;
    // failing the tool after Azure DevOps already accepted the change would
    // tell the agent its action failed when it actually succeeded.
    return { recorded: false, reason: error?.message ? String(error.message) : String(error) };
  }
}
