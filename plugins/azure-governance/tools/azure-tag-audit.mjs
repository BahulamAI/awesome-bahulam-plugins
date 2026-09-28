import { finding, latestSnapshot, publishFindings, stateOf, tagsOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const snapshot = latestSnapshot(state, args.scan_id);
    const required = Array.isArray(args.required_tags) && args.required_tags.length
      ? args.required_tags
      : ['owner', 'environment', 'costCenter', 'application'];
    const findings = [];
    const targets = [...snapshot.resource_groups, ...snapshot.resources];
    for (const item of targets) {
      const tags = tagsOf(item);
      const missing = required.filter(tag => !Object.prototype.hasOwnProperty.call(tags, tag.toLowerCase()) || String(tags[tag.toLowerCase()]).trim() === '');
      if (missing.length) {
        findings.push(finding('low', 'tagging', `Missing required tags: ${missing.join(', ')}`, item.id || item.name, { missing, tags: item.tags || {} }));
      }
    }
    publishFindings(state, snapshot.id, findings);
    return {
      success: true,
      output: {
        scan_id: snapshot.id,
        required_tags: required,
        target_count: targets.length,
        compliant_count: targets.length - findings.length,
        missing_tag_findings: findings.length,
        findings,
      },
    };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
