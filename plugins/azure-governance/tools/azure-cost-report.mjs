import { costAmount, dollars, formatDollars, latestSnapshot, sumBy, stateOf, tagsOf, valueAt } from './lib.mjs';

function resourceNameFromId(id = '') {
  const parts = String(id).split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

function normalizeId(id = '') {
  return String(id || '').toLowerCase();
}

function resourceLookup(resources = []) {
  const out = new Map();
  for (const resource of resources) {
    out.set(normalizeId(resource.id), resource);
  }
  return out;
}

function resourcesWithMetrics(resources = [], metrics = []) {
  const metricById = new Map(metrics.map(row => [normalizeId(row.resource_id || row.resourceId), row]));
  return resources.map(resource => {
    const metric = metricById.get(normalizeId(resource.id));
    if (!metric) return resource;
    return {
      ...resource,
      metrics: { ...(resource.metrics || {}), ...(metric.metrics || {}) },
      average_cpu_percent: metric.average_cpu_percent ?? resource.average_cpu_percent,
      average_memory_percent: metric.average_memory_percent ?? resource.average_memory_percent,
      metric_evidence: metric,
    };
  });
}

function skuName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || value.tier || value.size || '';
}

function enrichCosts(costs = [], resources = []) {
  const byId = resourceLookup(resources);
  return costs.map(row => {
    const id = row.resource_id || row.instanceId || row.resourceId || '';
    const resource = byId.get(normalizeId(id)) || {};
    const service = row.service && row.service !== 'unknown' ? row.service : resource.type;
    return {
      ...row,
      resource_group: row.resource_group || row.resourceGroup || row.resource_group_name || resource.resource_group || resource.resourceGroup,
      service: service || 'unknown',
      region: row.region || row.location || resource.location,
      sku: row.sku || row.sku_name || row.skuName || skuName(resource.sku),
      tags: Object.keys(row.tags || {}).length ? row.tags : (resource.tags || {}),
    };
  });
}

function keyFor(groupBy, args = {}) {
  if (groupBy === 'subscription') return row => row.subscriptionName || row.subscription_id || row.subscriptionId;
  if (groupBy === 'service') return row => row.service || row.meterCategory || row.resource_type;
  if (groupBy === 'region') return row => row.region || row.location;
  if (groupBy === 'meter') return row => row.meter || row.meter_name || row.meterName || row.meter_category || row.meterCategory;
  if (groupBy === 'sku') return row => row.sku || row.sku_name || row.skuName || row.product;
  if (groupBy === 'tag') {
    const tagKey = String(args.tag_key || '').toLowerCase();
    return row => tagKey
      ? tagsOf(row)[tagKey]
      : row.owner || row.costCenter || tagsOf(row).owner || tagsOf(row).costcenter;
  }
  if (groupBy === 'resource') return row => row.resource_id || row.instanceId || row.resourceId || row.instanceName || row.name;
  return row => row.resource_group || row.resourceGroup || row.resource_group_name;
}

function resourcesByGroup(costs, resources = []) {
  const byId = resourceLookup(resources);
  const groups = new Map();
  for (const row of costs) {
    const groupName = row.resource_group || row.resourceGroup || row.resource_group_name || 'unknown';
    const resourceId = row.resource_id || row.instanceId || row.resourceId || row.instanceName || '';
    const resource = byId.get(normalizeId(resourceId)) || {};
    const cost = costAmount(row);
    if (!groups.has(groupName)) {
      groups.set(groupName, { name: groupName, cost: 0, resources: new Map() });
    }
    const group = groups.get(groupName);
    group.cost += cost;
    const key = normalizeId(resourceId) || resourceNameFromId(row.name);
    if (!group.resources.has(key)) {
      group.resources.set(key, {
        name: resource.name || resourceNameFromId(resourceId || row.name),
        id: resourceId || resource.id || '',
        type: resource.type || row.resource_type || '',
        cost: 0,
      });
    }
    group.resources.get(key).cost += cost;
  }
  return [...groups.values()]
    .map(group => {
      const cost = dollars(group.cost);
      return {
        name: group.name,
        cost,
        cost_usd: cost,
        cost_display: formatDollars(cost),
        currency: 'USD',
        resources: [...group.resources.values()]
          .map(resource => {
            const resourceCost = dollars(resource.cost);
            return { ...resource, cost: resourceCost, cost_usd: resourceCost, cost_display: formatDollars(resourceCost), currency: 'USD' };
          })
        .sort((a, b) => b.cost - a.cost),
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

function dateKey(row = {}) {
  const raw = row.usage_start || row.usageStart || row.date || row.usage_date || row.usageDate;
  if (!raw) return '';
  return String(raw).slice(0, 10);
}

function dailyCosts(costs = []) {
  const days = new Map();
  for (const row of costs) {
    const day = dateKey(row);
    if (!day) continue;
    days.set(day, (days.get(day) || 0) + costAmount(row));
  }
  return [...days.entries()]
    .map(([date, cost]) => {
      const amount = dollars(cost);
      return { date, cost: amount, cost_usd: amount, cost_display: formatDollars(amount), currency: 'USD' };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function forecast(costs = []) {
  const days = dailyCosts(costs);
  if (!days.length) return null;
  const observed = days.reduce((sum, row) => sum + row.cost, 0);
  const average_daily_cost = dollars(observed / days.length);
  const last = new Date(`${days[days.length - 1].date}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0));
  const dayOfMonth = last.getUTCDate();
  const daysInMonth = monthEnd.getUTCDate();
  return {
    observed_days: days.length,
    average_daily_cost,
    average_daily_cost_usd: average_daily_cost,
    average_daily_cost_display: formatDollars(average_daily_cost),
    month_end_forecast: dollars(average_daily_cost * daysInMonth),
    month_end_forecast_usd: dollars(average_daily_cost * daysInMonth),
    month_end_forecast_display: formatDollars(average_daily_cost * daysInMonth),
    currency: 'USD',
    remaining_days_in_month: Math.max(daysInMonth - dayOfMonth, 0),
  };
}

function anomalies(costs = []) {
  const days = dailyCosts(costs);
  if (days.length < 4) return [];
  return days.map((day, index) => {
    const prior = days.slice(Math.max(0, index - 7), index);
    if (prior.length < 3) return null;
    const avg = prior.reduce((sum, row) => sum + row.cost, 0) / prior.length;
    if (avg > 0 && day.cost >= avg * 2 && day.cost - avg >= 25) {
      return {
        date: day.date,
        cost: day.cost,
        cost_usd: day.cost,
        cost_display: formatDollars(day.cost),
        baseline: dollars(avg),
        baseline_usd: dollars(avg),
        baseline_display: formatDollars(avg),
        increase: dollars(day.cost - avg),
        increase_usd: dollars(day.cost - avg),
        increase_display: formatDollars(day.cost - avg),
        currency: 'USD',
      };
    }
    return null;
  }).filter(Boolean);
}

function numberAt(row = {}, ...keys) {
  for (const key of keys) {
    const candidates = [row[key], row.metrics?.[key], row.utilization?.[key], row.properties?.[key]];
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null || candidate === '') continue;
      const value = Number(candidate);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function resourceSpend(costs = [], resources = []) {
  const lookup = resourceLookup(resources);
  const spend = new Map();
  for (const row of costs) {
    const id = row.resource_id || row.instanceId || row.resourceId || '';
    const key = normalizeId(id);
    if (!key) continue;
    if (!spend.has(key)) {
      spend.set(key, {
        resource_id: id,
        resource: lookup.get(key) || {},
        cost: 0,
      });
    }
    spend.get(key).cost += costAmount(row);
  }
  return [...spend.values()];
}

function idleReason(resource = {}, cpuIdleThreshold = 5) {
  const type = String(resource.type || '').toLowerCase();
  const state = String(valueAt(resource, 'power_state', 'powerState', 'state', 'status') || '').toLowerCase();
  const attachedTo = resource.attached_to || resource.managedBy || valueAt(resource, 'managedBy');
  const diskState = String(valueAt(resource, 'diskState') || '').toLowerCase();
  const cpu = numberAt(resource, 'average_cpu_percent', 'averageCpuPercent', 'cpu_percent', 'cpuPercent');

  if (type.includes('/disks') && (!attachedTo || diskState === 'unattached')) return 'Managed disk appears unattached';
  if (type.includes('publicipaddresses') && !resource.ipConfiguration && !resource.properties?.ipConfiguration) return 'Public IP appears unattached';
  if (type.includes('virtualmachines') && /stopped|deallocated/.test(state)) return `VM power state is ${state || 'stopped'}`;
  if ((type.includes('serverfarms') || type.includes('/sites')) && state.includes('stopped')) return 'App Service resource is stopped';
  if (/sql|postgres|mysql|database/.test(type) && state.includes('paused')) return 'Database is paused';
  if (/virtualmachines|serverfarms|managedclusters/.test(type) && cpu !== null && cpu <= cpuIdleThreshold) {
    return `Average CPU utilization is ${cpu}%`;
  }
  return '';
}

function idleExpensiveResources(costs, resources, args = {}) {
  const minimumCost = Number(args.min_idle_cost_usd ?? 25);
  const cpuThreshold = Number(args.idle_cpu_threshold_percent ?? 5);
  return resourceSpend(costs, resources)
    .map(item => ({ ...item, reason: idleReason(item.resource, cpuThreshold) }))
    .filter(item => item.reason && item.cost >= minimumCost)
    .map(item => {
      const amount = dollars(item.cost);
      return {
        resource_id: item.resource_id,
        name: item.resource.name || resourceNameFromId(item.resource_id),
        type: item.resource.type || '',
        reason: item.reason,
        observed_cost: amount,
        observed_cost_usd: amount,
        observed_cost_display: formatDollars(amount),
        currency: 'USD',
      };
    })
    .sort((a, b) => b.observed_cost - a.observed_cost);
}

function advisorRightsizing(snapshot = {}) {
  return snapshot.advisor_recommendations
    .filter(row => String(row.category || '').toLowerCase() === 'cost')
    .filter(row => /right.?siz|resize|underutil|shut.?down|idle/i.test(`${row.problem || ''} ${row.solution || ''}`))
    .map(row => {
      const sourceCurrency = String(row.savings_currency || row.savingsCurrency || 'USD').toUpperCase();
      const sourceSavings = dollars(row.annual_savings_amount ?? row.annualSavingsAmount ?? 0);
      const annualSavings = sourceCurrency === 'USD' ? sourceSavings : dollars(row.annual_savings_usd ?? row.annualSavingsUsd ?? 0);
      return {
        source: 'azure_advisor',
        resource_id: row.resource_id || row.resourceId || '',
        recommendation: row.problem || row.solution || 'Review Azure Advisor cost recommendation',
        solution: row.solution || '',
        estimated_annual_savings: annualSavings,
        estimated_annual_savings_usd: annualSavings,
        estimated_annual_savings_display: formatDollars(annualSavings),
        currency: 'USD',
        source_estimated_annual_savings: sourceSavings,
        source_currency: sourceCurrency,
      };
    });
}

function utilizationRightsizing(costs, resources, args = {}) {
  const minimumCost = Number(args.min_rightsizing_cost_usd ?? 50);
  const cpuThreshold = Number(args.rightsizing_cpu_threshold_percent ?? 20);
  return resourceSpend(costs, resources)
    .map(item => {
      const type = String(item.resource.type || '').toLowerCase();
      const cpu = numberAt(item.resource, 'average_cpu_percent', 'averageCpuPercent', 'cpu_percent', 'cpuPercent');
      const memory = numberAt(item.resource, 'average_memory_percent', 'averageMemoryPercent', 'memory_percent', 'memoryPercent');
      if (!/virtualmachines|serverfarms|managedclusters|sql|postgres|mysql|database/.test(type)) return null;
      if (cpu === null || cpu > cpuThreshold || item.cost < minimumCost) return null;
      if (memory !== null && memory > 50) return null;
      const amount = dollars(item.cost);
      return {
        source: 'utilization',
        resource_id: item.resource_id,
        recommendation: `Review a smaller SKU; average CPU utilization is ${cpu}%`,
        average_cpu_percent: cpu,
        average_memory_percent: memory,
        observed_cost: amount,
        observed_cost_usd: amount,
        observed_cost_display: formatDollars(amount),
        currency: 'USD',
      };
    })
    .filter(Boolean);
}

function rightsizingRecommendations(costs, snapshot, args = {}) {
  const advisor = advisorRightsizing(snapshot);
  const advisorIds = new Set(advisor.map(row => normalizeId(row.resource_id)).filter(Boolean));
  const utilization = utilizationRightsizing(costs, snapshot.resources, args)
    .filter(row => !advisorIds.has(normalizeId(row.resource_id)));
  return [...advisor, ...utilization];
}

function commitmentOptions(service = '') {
  const text = String(service).toLowerCase();
  if (/virtual machine|compute|container|kubernetes|aks/.test(text)) return ['savings_plan', 'reservation'];
  if (/sql|cosmos|database|postgres|mysql|cache/.test(text)) return ['reservation'];
  return [];
}

function commitmentCandidates(costs = [], args = {}) {
  const minimumDays = Number(args.min_commitment_days ?? 7);
  const minimumCost = Number(args.min_commitment_cost_usd ?? 100);
  const maximumVariation = Number(args.max_commitment_daily_variation ?? 0.25);
  const groups = new Map();

  for (const row of costs) {
    const service = row.service || row.meterCategory || row.resource_type || 'unknown';
    const sku = row.sku || row.sku_name || row.skuName || row.product || 'all SKUs';
    const options = commitmentOptions(service);
    const day = dateKey(row);
    if (!options.length || !day) continue;
    const key = `${String(service).toLowerCase()}|${String(sku).toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { service, sku, options, days: new Map(), total: 0 });
    const group = groups.get(key);
    const amount = costAmount(row);
    group.total += amount;
    group.days.set(day, (group.days.get(day) || 0) + amount);
  }

  return [...groups.values()].map(group => {
    const daily = [...group.days.values()];
    const average = daily.reduce((sum, amount) => sum + amount, 0) / daily.length;
    const variance = daily.reduce((sum, amount) => sum + ((amount - average) ** 2), 0) / daily.length;
    const coefficientOfVariation = average > 0 ? Math.sqrt(variance) / average : 0;
    return { ...group, average, coefficientOfVariation };
  })
    .filter(group => group.days.size >= minimumDays && group.total >= minimumCost && group.coefficientOfVariation <= maximumVariation)
    .map(group => {
      const observedCost = dollars(group.total);
      const averageDailyCost = dollars(group.average);
      const projectedMonthlyCost = dollars(group.average * 30);
      return {
        service: group.service,
        sku: group.sku,
        observed_days: group.days.size,
        daily_variation: Number(group.coefficientOfVariation.toFixed(3)),
        commitment_options: group.options,
        observed_cost: observedCost,
        observed_cost_usd: observedCost,
        observed_cost_display: formatDollars(observedCost),
        average_daily_cost: averageDailyCost,
        average_daily_cost_usd: averageDailyCost,
        average_daily_cost_display: formatDollars(averageDailyCost),
        projected_monthly_cost: projectedMonthlyCost,
        projected_monthly_cost_usd: projectedMonthlyCost,
        projected_monthly_cost_display: formatDollars(projectedMonthlyCost),
        currency: 'USD',
        recommendation: 'Review sustained usage before purchasing a commitment; this is a screening candidate, not a purchase instruction.',
      };
    })
    .sort((a, b) => b.projected_monthly_cost - a.projected_monthly_cost);
}

function nativeCommitmentRecommendations(rows = []) {
  return rows.map(row => {
    const savings = dollars(row.estimated_savings_usd ?? row.net_savings ?? row.netSavings ?? 0);
    const hourly = dollars(row.hourly_commitment_usd ?? row.hourlyCommitment ?? 0);
    return {
      ...row,
      source: row.source || 'azure_benefit_recommendations',
      estimated_savings_usd: savings,
      estimated_savings_display: formatDollars(savings),
      hourly_commitment_usd: hourly,
      hourly_commitment_display: formatDollars(hourly),
      currency: 'USD',
      recommendation: row.kind === 'savings_plan'
        ? 'Review Azure native Savings Plan recommendation and quoted savings.'
        : 'Review Azure native reservation recommendation and quoted savings.',
    };
  }).sort((a, b) => b.estimated_savings_usd - a.estimated_savings_usd);
}

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const snapshot = latestSnapshot(state, args.scan_id);
    const group_by = args.group_by || 'resource_group';
    const enrichedResources = resourcesWithMetrics(snapshot.resources, snapshot.monitor_metrics);
    const enrichedCosts = enrichCosts(snapshot.costs, enrichedResources);
    const costs = args.resource_group
      ? enrichedCosts.filter(row => String(row.resource_group || row.resourceGroup || '').toLowerCase() === String(args.resource_group).toLowerCase())
      : enrichedCosts;
    const groups = sumBy(costs, keyFor(group_by, args));
    const resource_groups = resourcesByGroup(costs, enrichedResources);
    const daily = dailyCosts(costs);
    const idleResources = idleExpensiveResources(costs, enrichedResources, args);
    const rightsizing = rightsizingRecommendations(costs, { ...snapshot, resources: enrichedResources }, args);
    const commitments = commitmentCandidates(costs, args);
    const nativeCommitments = nativeCommitmentRecommendations(snapshot.benefit_recommendations);
    const totalCost = dollars(groups.reduce((sum, row) => sum + row.cost, 0));
    const untaggedCost = dollars(costs
      .filter(row => Object.keys(tagsOf(row)).length === 0 && !row.owner && !row.costCenter)
      .reduce((sum, row) => sum + costAmount(row), 0));
    return {
      success: true,
      output: {
        scan_id: snapshot.id,
        group_by,
        resource_group: args.resource_group || null,
        currency: 'USD',
        total_cost: totalCost,
        total_cost_usd: totalCost,
        total_cost_display: formatDollars(totalCost),
        groups,
        resource_groups,
        top_drivers: groups.slice(0, 10),
        daily_costs: daily,
        forecast: forecast(costs),
        anomalies: anomalies(costs),
        untagged_cost: untaggedCost,
        untagged_cost_usd: untaggedCost,
        untagged_cost_display: formatDollars(untaggedCost),
        optimization: {
          idle_expensive_resources: idleResources,
          rightsizing_recommendations: rightsizing,
          commitment_candidates: commitments,
          native_commitment_recommendations: nativeCommitments,
          monitor_metric_resources: snapshot.monitor_metrics,
          summary: {
            idle_expensive_resource_count: idleResources.length,
            rightsizing_recommendation_count: rightsizing.length,
            commitment_candidate_count: commitments.length,
            native_commitment_recommendation_count: nativeCommitments.length,
            idle_observed_cost_usd: dollars(idleResources.reduce((sum, row) => sum + row.observed_cost, 0)),
            idle_observed_cost_display: formatDollars(idleResources.reduce((sum, row) => sum + row.observed_cost, 0)),
            advisor_estimated_annual_savings_usd: dollars(rightsizing.reduce((sum, row) => sum + (row.estimated_annual_savings || 0), 0)),
            advisor_estimated_annual_savings_display: formatDollars(rightsizing.reduce((sum, row) => sum + (row.estimated_annual_savings || 0), 0)),
            native_estimated_savings_usd: dollars(nativeCommitments.reduce((sum, row) => sum + row.estimated_savings_usd, 0)),
            native_estimated_savings_display: formatDollars(nativeCommitments.reduce((sum, row) => sum + row.estimated_savings_usd, 0)),
            currency: 'USD',
          },
        },
      },
    };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
