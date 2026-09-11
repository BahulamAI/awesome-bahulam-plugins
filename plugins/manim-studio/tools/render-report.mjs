import { rows, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const state = await stateOf(options);
  if (!state) {
    return { success: false, output: 'Shared blackboard unavailable in this context.' };
  }

  const slug = String(args.slug || args.name || '').trim().toLowerCase();
  if (typeof state.query === 'function') {
    const params = slug ? [slug] : [];
    const where = slug ? 'WHERE slug = ?' : '';
    const scenes = rows(state, `SELECT * FROM render_scenes ${where} ORDER BY id DESC LIMIT 20`, params);
    const jobs = rows(state, `SELECT * FROM render_jobs ${where} ORDER BY id DESC LIMIT 20`, params);
    const approvals = rows(state, `SELECT * FROM render_approvals ${where} ORDER BY id DESC LIMIT 20`, params);
    return {
      success: true,
      output: {
        slug: slug || null,
        inventory: { scenes: scenes.length, jobs: jobs.length, approvals: approvals.length },
        scenes,
        jobs,
        approvals,
        ready_for_user: jobs.some(job => job.status === 'completed' && job.video_path),
        needs_attention: jobs.some(job => job.status === 'failed') || approvals.some(row => row.decision !== 'approved'),
      },
    };
  }

  const renders = state.list('renders', { limit: 50, order: 'desc' }) || [];
  const scenes = state.list('scenes', { limit: 50, order: 'desc' }) || [];
  const approvals = state.list('render_approvals', { limit: 50, order: 'desc' }) || [];
  const pick = row => !slug || row.payload?.slug === slug || row.payload?.name === slug;
  const out = {
    slug: slug || null,
    scenes: scenes.filter(pick).map(row => row.payload),
    jobs: renders.filter(pick).map(row => row.payload),
    approvals: approvals.filter(pick).map(row => row.payload),
  };
  return {
    success: true,
    output: {
      ...out,
      inventory: { scenes: out.scenes.length, jobs: out.jobs.length, approvals: out.approvals.length },
      ready_for_user: out.jobs.some(job => job.status === 'completed' && job.video_path),
      needs_attention: out.jobs.some(job => job.status === 'failed') || out.approvals.some(row => row.decision !== 'approved'),
    },
  };
}
