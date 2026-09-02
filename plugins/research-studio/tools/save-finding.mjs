/**
 * save_finding — persist one research finding to the studio's notebook.
 * Uses append-style records (not kv) so a topic can accumulate many
 * findings over time. The workspace panel binds to this stream.
 */
export async function call(args = {}, options = {}) {
  const topic = String(args.topic || '').trim();
  const title = String(args.title || '').trim();
  const url = String(args.url || '').trim();
  if (!topic || !title || !url) {
    return { success: false, output: 'topic, title, and url are required' };
  }
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'Shared blackboard unavailable' };

  const finding = {
    topic,
    title,
    url,
    excerpt: String(args.excerpt || '').slice(0, 1000),
    notes: String(args.notes || '').slice(0, 500),
    at: new Date().toISOString(),
  };
  const record = state.append('findings', finding);
  return {
    success: true,
    output: `Saved finding #${record?.id || ''} on '${topic}': ${title}`,
    finding: { ...finding, id: record?.id },
  };
}
