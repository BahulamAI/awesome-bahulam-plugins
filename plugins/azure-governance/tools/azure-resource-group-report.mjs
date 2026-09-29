import { latestSnapshot, stateOf } from './lib.mjs';

function subscriptionIdOf(row = {}) {
  if (row.subscription_id || row.subscriptionId) return String(row.subscription_id || row.subscriptionId);
  const match = String(row.id || '').match(/\/subscriptions\/([^/]+)/i);
  return match?.[1] || '';
}

function resourceGroupNameOf(row = {}) {
  if (row.resource_group || row.resourceGroup) return String(row.resource_group || row.resourceGroup);
  const match = String(row.id || '').match(/\/resourceGroups\/([^/]+)/i);
  return match?.[1] || '';
}

function markdown(groups) {
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const lines = [
    '| Subscription | Resource group | Location | Resources | Tags |',
    '|---|---|---|---:|---|',
  ];
  for (const group of groups) {
    const tags = Object.entries(group.tags).map(([key, value]) => `${key}=${value}`).join(', ') || 'None';
    lines.push(`| ${escape(group.subscription_name || group.subscription_id)} | ${escape(group.name)} | ${escape(group.location || 'unknown')} | ${group.resource_count} | ${escape(tags)} |`);
  }
  return lines.join('\n');
}

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const snapshot = latestSnapshot(state, args.scan_id);
    const subscriptions = new Map(snapshot.subscriptions.map(row => [
      String(row.id || row.subscription_id || '').toLowerCase(),
      String(row.name || row.display_name || row.displayName || row.id || row.subscription_id || ''),
    ]));
    const requestedSubscription = String(args.subscription_id || '').toLowerCase();
    const requestedName = String(args.name || '').toLowerCase();

    const groups = snapshot.resource_groups.map(group => {
      const subscriptionId = subscriptionIdOf(group);
      const name = String(group.name || resourceGroupNameOf(group));
      const matchingResources = snapshot.resources.filter(resource => {
        const resourceSubscriptionId = subscriptionIdOf(resource);
        const resourceGroup = resourceGroupNameOf(resource);
        return resourceSubscriptionId.toLowerCase() === subscriptionId.toLowerCase()
          && resourceGroup.toLowerCase() === name.toLowerCase();
      });
      const resourceTypes = [...new Set(matchingResources.map(row => String(row.type || '')).filter(Boolean))].sort();
      return {
        id: group.id || `/subscriptions/${subscriptionId}/resourceGroups/${name}`,
        name,
        subscription_id: subscriptionId,
        subscription_name: subscriptions.get(subscriptionId.toLowerCase()) || subscriptionId,
        location: group.location || '',
        tags: group.tags || {},
        resource_count: matchingResources.length,
        resource_types: resourceTypes,
      };
    }).filter(group => {
      if (requestedSubscription && group.subscription_id.toLowerCase() !== requestedSubscription) return false;
      if (requestedName && !group.name.toLowerCase().includes(requestedName)) return false;
      return args.include_empty !== false || group.resource_count > 0;
    }).sort((left, right) => (
      left.subscription_name.localeCompare(right.subscription_name)
      || left.name.localeCompare(right.name)
    ));

    const output = {
      scan_id: snapshot.id,
      resource_group_count: groups.length,
      resource_groups: groups,
    };
    if (String(args.format || 'json').toLowerCase() === 'markdown') output.markdown = markdown(groups);
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
