/**
 * list_findings — read persisted findings from the notebook, newest first,
 * optionally filtered by topic. Use before re-searching the web.
 */
export async function call(args = {}, options = {}) {
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
  const topicFilter = String(args.topic || '').trim();
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'Shared blackboard unavailable' };

  const rows = state.list('findings', { limit: 500, order: 'desc' }) || [];
  const findings = rows
    .filter(r => !topicFilter || (r.payload?.topic || '').toLowerCase() === topicFilter.toLowerCase())
    .slice(0, limit)
    .map(r => ({ id: r.id, ...(r.payload || {}) }));

  if (!findings.length) {
    return {
      success: true,
      output: topicFilter
        ? `No findings for topic '${topicFilter}' yet.`
        : 'No findings saved yet.',
      findings: [],
    };
  }
  const lines = findings.map(f =>
    `#${f.id} [${f.topic}] ${f.title}\n    ${f.url}${f.notes ? `\n    note: ${f.notes}` : ''}`
  );
  return { success: true, output: lines.join('\n\n'), findings };
}
