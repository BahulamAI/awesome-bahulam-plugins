const ARM = 'https://management.azure.com';
const GRAPH = 'https://graph.microsoft.com';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) {
  const parsed = Number(value && typeof value === 'object' ? value.value : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lowerKeys(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).toLowerCase(), value]));
}

function subscriptionFromId(value = '') {
  return String(value).match(/\/subscriptions\/([^/]+)/i)?.[1] || '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tokenFor(scope, options = {}) {
  if (typeof options.tokenProvider === 'function') return options.tokenProvider(scope);
  if (options.azureSdk?.credential) return (await options.azureSdk.credential.getToken(scope)).token;
  const identity = options.azureSdk?.identity || await import('@azure/identity');
  return (await new identity.DefaultAzureCredential().getToken(scope)).token;
}

async function request(url, init = {}, options = {}, token = '') {
  if (init.method === 'GET' && typeof options.armGet === 'function' && url.startsWith(ARM)) {
    const body = await options.armGet(url);
    return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
  }
  const fetcher = options.fetch || globalThis.fetch;
  if (!fetcher) throw new Error('A fetch implementation is required for Azure enrichment collection.');
  const response = await fetcher(url, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok && response.status !== 202 && response.status !== 204) {
    const detail = await response.text();
    throw new Error(`${response.status} from ${url}: ${detail}`);
  }
  return response;
}

async function list(url, options, token) {
  const rows = [];
  let next = url;
  while (next) {
    const response = await request(next, { method: 'GET' }, options, token);
    const body = await response.json();
    rows.push(...asArray(body.value));
    next = body.nextLink || body['@odata.nextLink'] || '';
  }
  return rows;
}

function parseCsv(text = '') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const [headers = [], ...data] = rows;
  return data.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function normalizeCostDetail(row = {}, subscriptionId = '') {
  const value = lowerKeys(row);
  const sourceCurrency = value.billingcurrency || value.currency || value.pricingcurrency || 'USD';
  const usd = value.costinusd ?? value.pretaxcostinusd ?? (String(sourceCurrency).toUpperCase() === 'USD'
    ? (value.costinbillingcurrency ?? value.pretaxcost ?? value.cost)
    : 0);
  const resourceId = value.resourceid || value.instanceid || '';
  let tags = value.tags || {};
  if (typeof tags === 'string' && tags.trim()) {
    try { tags = JSON.parse(tags); } catch { tags = {}; }
  }
  return {
    subscription_id: value.subscriptionid || subscriptionId || subscriptionFromId(resourceId),
    subscription_name: value.subscriptionname,
    resource_group: value.resourcegroup || value.resourcegroupname,
    resource_id: resourceId,
    resource_name: value.resourcename,
    resource_type: value.resourcetype,
    service: value.servicename || value.metercategory || value.consumedservice,
    region: value.resourcelocation || value.location,
    meter: value.metername || value.meter,
    meter_category: value.metercategory,
    meter_subcategory: value.metersubcategory,
    sku: value.productname || value.product || value.skuname,
    pricing_model: value.pricingmodel,
    charge_type: value.chargetype,
    publisher_type: value.publishertype,
    usage_start: String(value.date || value.usagedatetime || value.usagestart || '').slice(0, 10),
    quantity: number(value.quantity),
    cost: number(usd),
    currency: 'USD',
    source_cost: number(value.costinbillingcurrency ?? value.pretaxcost ?? value.cost),
    source_currency: sourceCurrency,
    tags,
    source: 'cost_details',
  };
}

async function downloadCostBlobs(body, options) {
  const blobs = asArray(body?.manifest?.blobs || body?.properties?.manifest?.blobs || body?.blobs || body?.properties?.blobs);
  const rows = [];
  for (const blob of blobs) {
    const url = blob.blobLink || blob.blob_link || blob.url;
    if (!url) continue;
    const response = await request(url, { method: 'GET' }, options);
    const compressed = /\.gz(?:\?|$)/i.test(url) || /gzip/i.test(response.headers?.get?.('content-type') || response.headers?.get?.('content-encoding') || '');
    let text;
    if (compressed) {
      if (typeof DecompressionStream !== 'function' || typeof response.arrayBuffer !== 'function') {
        throw new Error('This runtime cannot decompress a gzip Cost Details export.');
      }
      const stream = new Blob([await response.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else text = await response.text();
    rows.push(...parseCsv(text));
  }
  return rows;
}

export async function collectCostDetails(args, subscriptions, options = {}) {
  if (!args.include_cost_details) return { rows: [], coverage: false };
  if (!subscriptions.length) throw new Error('Cost Details collection requires at least one subscription scope.');
  if (typeof options.costDetailsResolver === 'function') {
    const rows = await options.costDetailsResolver(subscriptions, args);
    return { rows: asArray(rows).map(row => normalizeCostDetail(row)), coverage: { complete: true, available: asArray(rows).length } };
  }
  const token = await tokenFor('https://management.azure.com/.default', options);
  const all = [];
  const start = args.cost_start_date;
  const end = args.cost_end_date;
  const maxWaitMs = Math.max(1000, Number(args.cost_details_max_wait_seconds || 120) * 1000);
  for (const subscriptionId of subscriptions) {
    const url = `${ARM}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=2025-03-01`;
    const body = {
      metric: 'ActualCost',
      ...(start || end ? { timePeriod: { start: start || end, end: end || start } } : {}),
    };
    let response = await request(url, { method: 'POST', body: JSON.stringify(body) }, options, token);
    if (response.status === 204) continue;
    const started = Date.now();
    while (response.status === 202) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Cost Details response did not include a polling location.');
      const retryMs = Math.max(1000, Number(response.headers.get('retry-after') || 5) * 1000);
      if (Date.now() - started + retryMs > maxWaitMs) throw new Error(`Cost Details generation exceeded ${maxWaitMs / 1000} seconds.`);
      await sleep(retryMs);
      response = await request(location, { method: 'GET' }, options, token);
    }
    const report = await response.json();
    const rows = await downloadCostBlobs(report, options);
    all.push(...rows.map(row => normalizeCostDetail(row, subscriptionId)));
  }
  return { rows: all, coverage: { complete: true, available: all.length } };
}

function normalizeBenefit(row = {}, kind, subscriptionId = '') {
  const properties = row.properties || row;
  const details = properties.recommendationDetails || {};
  const sourceCurrency = properties.currencyCode || properties.currency || properties.netSavings?.currency || 'USD';
  const sourceSavings = number(properties.netSavings ?? properties.totalSavings ?? properties.savingsAmount ?? properties.annualSavingsAmount ?? details.savingsAmount);
  const sourceHourly = number(properties.hourlyCommitment ?? properties.recommendedHourlyCommitment ?? properties.commitmentAmount ?? details.commitmentAmount);
  const savings = String(sourceCurrency).toUpperCase() === 'USD' ? sourceSavings : number(properties.savingsAmountUsd ?? details.savingsAmountUsd);
  const hourly = String(sourceCurrency).toUpperCase() === 'USD' ? sourceHourly : number(properties.commitmentAmountUsd ?? details.commitmentAmountUsd);
  return {
    id: row.id,
    kind,
    subscription_id: properties.subscriptionId || subscriptionId || subscriptionFromId(row.id),
    resource_group: properties.resourceGroup,
    scope: properties.scope || properties.benefitScope || 'Single',
    term: properties.term,
    look_back_period: properties.lookBackPeriod,
    resource_type: properties.resourceType,
    sku: properties.armSkuName || properties.skuName || properties.product || row.sku,
    region: properties.region || row.location,
    recommended_quantity: number(properties.recommendedQuantity),
    hourly_commitment_usd: hourly,
    hourly_commitment_display: `$${hourly.toFixed(2)}`,
    estimated_savings_usd: savings,
    estimated_savings_display: `$${savings.toFixed(2)}`,
    savings_percentage: number(properties.savingsPercentage ?? details.savingsPercentage),
    currency: 'USD',
    source_currency: sourceCurrency,
    source_estimated_savings: sourceSavings,
    source_hourly_commitment: sourceHourly,
    source: kind === 'savings_plan' ? 'azure_benefit_recommendations' : 'azure_reservation_recommendations',
    properties,
  };
}

export async function collectBenefitRecommendations(args, subscriptions, options = {}) {
  if (!args.include_benefit_recommendations) return { rows: [], coverage: false };
  if (!subscriptions.length) throw new Error('Benefit recommendation collection requires at least one subscription scope.');
  if (typeof options.benefitRecommendationsResolver === 'function') {
    const rows = asArray(await options.benefitRecommendationsResolver(subscriptions, args));
    return { rows: rows.map(row => normalizeBenefit(row, row.kind || row.type || 'reservation')), coverage: { complete: true, available: rows.length } };
  }
  const token = await tokenFor('https://management.azure.com/.default', options);
  const rows = [];
  for (const subscriptionId of subscriptions) {
    const scope = `/subscriptions/${subscriptionId}`;
    const savingsUrl = `${ARM}${scope}/providers/Microsoft.CostManagement/benefitRecommendations?api-version=2026-06-01&$expand=properties/allRecommendationDetails`;
    const reservationUrl = `${ARM}${scope}/providers/Microsoft.Consumption/reservationRecommendations?api-version=2026-06-01`;
    rows.push(...(await list(savingsUrl, options, token)).map(row => normalizeBenefit(row, 'savings_plan', subscriptionId)));
    rows.push(...(await list(reservationUrl, options, token)).map(row => normalizeBenefit(row, 'reservation', subscriptionId)));
  }
  return { rows, coverage: { complete: true, available: rows.length } };
}

const METRIC_NAMES = {
  'microsoft.compute/virtualmachines': ['Percentage CPU', 'Available Memory Bytes'],
  'microsoft.sql/servers/databases': ['cpu_percent', 'dtu_consumption_percent', 'storage_percent'],
  'microsoft.dbforpostgresql/flexibleservers': ['cpu_percent', 'memory_percent', 'storage_percent'],
  'microsoft.dbformysql/flexibleservers': ['cpu_percent', 'memory_percent', 'storage_percent'],
  'microsoft.web/serverfarms': ['CpuPercentage', 'MemoryPercentage'],
  'microsoft.containerservice/managedclusters': ['node_cpu_usage_percentage', 'node_memory_working_set_percentage'],
  'microsoft.storage/storageaccounts': ['UsedCapacity', 'Transactions'],
};

function normalizeMetricResponse(body = {}, resource = {}) {
  const metrics = {};
  for (const metric of asArray(body.value)) {
    const name = metric.name?.value || metric.name?.localizedValue || metric.name || 'unknown';
    const points = asArray(metric.timeseries).flatMap(series => asArray(series.data));
    const averages = points.map(point => Number(point.average)).filter(Number.isFinite);
    const maximums = points.map(point => Number(point.maximum)).filter(Number.isFinite);
    const totals = points.map(point => Number(point.total)).filter(Number.isFinite);
    metrics[name] = {
      average: averages.length ? Number((averages.reduce((sum, value) => sum + value, 0) / averages.length).toFixed(3)) : null,
      maximum: maximums.length ? Math.max(...maximums) : null,
      total: totals.length ? Number(totals.reduce((sum, value) => sum + value, 0).toFixed(3)) : null,
      samples: points.length,
      unit: metric.unit,
    };
  }
  const cpu = Object.entries(metrics).find(([name]) => /cpu.*percent|percentage cpu/i.test(name))?.[1]?.average;
  const memory = Object.entries(metrics).find(([name]) => /memory.*percent/i.test(name))?.[1]?.average;
  return {
    resource_id: resource.id,
    subscription_id: resource.subscription_id || subscriptionFromId(resource.id),
    resource_type: resource.type,
    average_cpu_percent: cpu ?? null,
    average_memory_percent: memory ?? null,
    metrics,
  };
}

export async function collectMonitorMetrics(args, resources, options = {}) {
  if (!args.include_monitor_metrics) return { rows: [], coverage: false };
  const candidates = resources.filter(row => METRIC_NAMES[String(row.type || '').toLowerCase()] && row.id);
  const limit = Math.max(1, Number(args.metric_resource_limit || 200));
  const targets = candidates.slice(0, limit);
  if (typeof options.monitorMetricsResolver === 'function') {
    const rows = asArray(await options.monitorMetricsResolver(targets, args));
    return { rows, coverage: { complete: targets.length === candidates.length, attempted: targets.length, available: rows.length } };
  }
  const token = await tokenFor('https://management.azure.com/.default', options);
  const end = args.metrics_end_date ? new Date(args.metrics_end_date) : new Date();
  const start = args.metrics_start_date ? new Date(args.metrics_start_date) : new Date(end.getTime() - Number(args.metric_lookback_days || 14) * 86400000);
  const rows = [];
  let failed = 0;
  for (const resource of targets) {
    try {
      const names = METRIC_NAMES[String(resource.type).toLowerCase()].join(',');
      const query = new URLSearchParams({
        'api-version': '2023-10-01',
        timespan: `${start.toISOString()}/${end.toISOString()}`,
        interval: 'PT1H',
        metricnames: names,
        aggregation: 'Average,Maximum,Total',
        AutoAdjustTimegrain: 'true',
        ValidateDimensions: 'false',
      });
      const response = await request(`${ARM}${resource.id}/providers/Microsoft.Insights/metrics?${query}`, { method: 'GET' }, options, token);
      rows.push(normalizeMetricResponse(await response.json(), resource));
    } catch {
      failed++;
    }
  }
  return { rows, coverage: { complete: failed === 0 && targets.length === candidates.length, attempted: targets.length, failed, available: rows.length } };
}

function normalizePim(row = {}, assignmentType = '') {
  const properties = row.properties || row;
  return {
    id: row.id || properties.id,
    assignment_type: assignmentType || properties.assignmentType,
    principal_id: properties.principalId,
    principal_type: properties.principalType,
    role_definition_id: properties.roleDefinitionId,
    scope: properties.scope,
    start_date_time: properties.startDateTime,
    end_date_time: properties.endDateTime,
    member_type: properties.memberType,
    status: properties.status,
    linked_eligibility_id: properties.linkedRoleEligibilityScheduleInstanceId,
  };
}

export async function collectPimAssignments(args, subscriptions, managementGroups, options = {}) {
  if (!args.include_pim) return { rows: [], coverage: false };
  const scopes = subscriptions.map(id => `/subscriptions/${id}`)
    .concat(managementGroups.map(id => `/providers/Microsoft.Management/managementGroups/${id}`));
  if (typeof options.pimResolver === 'function') {
    const rows = asArray(await options.pimResolver(scopes, args));
    return { rows: rows.map(row => normalizePim(row, row.assignment_type)), coverage: { complete: true, available: rows.length } };
  }
  const token = await tokenFor('https://management.azure.com/.default', options);
  const rows = [];
  for (const scope of scopes) {
    const base = `${ARM}${scope}/providers/Microsoft.Authorization`;
    rows.push(...(await list(`${base}/roleEligibilityScheduleInstances?api-version=2020-10-01&$filter=atScope()`, options, token)).map(row => normalizePim(row, 'eligible')));
    rows.push(...(await list(`${base}/roleAssignmentScheduleInstances?api-version=2020-10-01&$filter=atScope()`, options, token)).map(row => normalizePim(row, 'active')));
  }
  return { rows, coverage: { complete: true, available: rows.length } };
}

function latestActivity(row = {}) {
  const activities = [
    row.lastSuccessfulSignInDateTime,
    row.lastSignInDateTime,
    row.lastNonInteractiveSignInDateTime,
    row.applicationAuthenticationClientSignInActivity?.lastSignInDateTime,
    row.applicationAuthenticationResourceSignInActivity?.lastSignInDateTime,
    row.delegatedClientSignInActivity?.lastSignInDateTime,
  ].filter(Boolean).sort();
  return activities.at(-1) || '';
}

export async function collectIdentityDetails(args, principals, options = {}) {
  if (!args.include_identity_details) return { service_principal_credentials: [], federated_identity_credentials: [], sign_in_activity: [], coverage: false };
  if (typeof options.identityDetailsResolver === 'function') {
    const result = await options.identityDetailsResolver(principals, args);
    return {
      service_principal_credentials: asArray(result.service_principal_credentials),
      federated_identity_credentials: asArray(result.federated_identity_credentials),
      sign_in_activity: asArray(result.sign_in_activity),
      coverage: { complete: true },
    };
  }
  const token = await tokenFor('https://graph.microsoft.com/.default', options);
  const servicePrincipals = principals.filter(row => String(row.principal_type || '').toLowerCase().includes('serviceprincipal'));
  const users = principals.filter(row => String(row.principal_type || '').toLowerCase() === 'user');
  const credentialLimit = Math.max(1, Number(args.identity_detail_limit || 500));
  const credentials = [];
  const federated = [];
  const activity = [];
  let failed = 0;

  for (const principal of servicePrincipals.slice(0, credentialLimit)) {
    try {
      const select = '$select=id,appId,displayName,accountEnabled,servicePrincipalType,passwordCredentials,keyCredentials';
      const response = await request(`${GRAPH}/v1.0/servicePrincipals/${encodeURIComponent(principal.id)}?${select}`, { method: 'GET' }, options, token);
      const servicePrincipal = await response.json();
      for (const item of [...asArray(servicePrincipal.passwordCredentials), ...asArray(servicePrincipal.keyCredentials)]) {
        credentials.push({
          principal_id: principal.id,
          app_id: servicePrincipal.appId,
          principal_name: servicePrincipal.displayName || principal.display_name,
          credential_id: item.keyId,
          credential_type: asArray(servicePrincipal.passwordCredentials).includes(item) ? 'password' : 'certificate',
          display_name: item.displayName,
          start_date_time: item.startDateTime,
          end_date_time: item.endDateTime,
        });
      }
      if (servicePrincipal.appId) {
        const appResponse = await request(`${GRAPH}/v1.0/applications(appId='${encodeURIComponent(servicePrincipal.appId)}')?$select=id,appId,displayName,passwordCredentials,keyCredentials`, { method: 'GET' }, options, token);
        const application = await appResponse.json();
        if (application.id) {
          const seen = new Set(credentials.filter(row => row.principal_id === principal.id).map(row => String(row.credential_id || '').toLowerCase()));
          for (const item of [...asArray(application.passwordCredentials), ...asArray(application.keyCredentials)]) {
            if (seen.has(String(item.keyId || '').toLowerCase())) continue;
            credentials.push({
              principal_id: principal.id,
              application_id: application.id,
              app_id: application.appId,
              principal_name: application.displayName || servicePrincipal.displayName || principal.display_name,
              credential_id: item.keyId,
              credential_type: asArray(application.passwordCredentials).includes(item) ? 'password' : 'certificate',
              credential_owner: 'application',
              display_name: item.displayName,
              start_date_time: item.startDateTime,
              end_date_time: item.endDateTime,
            });
          }
          const rows = await list(`${GRAPH}/v1.0/applications/${encodeURIComponent(application.id)}/federatedIdentityCredentials`, options, token);
          federated.push(...rows.map(row => ({
            id: row.id,
            principal_id: principal.id,
            application_id: application.id,
            app_id: application.appId,
            name: row.name,
            issuer: row.issuer,
            subject: row.subject,
            audiences: row.audiences || [],
            description: row.description,
          })));
        }
      }
    } catch {
      failed++;
    }
  }

  for (const principal of users.slice(0, credentialLimit)) {
    try {
      const response = await request(`${GRAPH}/v1.0/users/${encodeURIComponent(principal.id)}?$select=id,signInActivity`, { method: 'GET' }, options, token);
      const user = await response.json();
      activity.push({ principal_id: principal.id, principal_type: 'user', last_sign_in_at: latestActivity(user.signInActivity), sign_in_activity: user.signInActivity || {} });
    } catch {
      failed++;
    }
  }

  if (args.include_service_principal_sign_ins && servicePrincipals.length) {
    try {
      const rows = await list(`${GRAPH}/beta/reports/servicePrincipalSignInActivities`, options, token);
      const ids = new Map(servicePrincipals.map(row => [String(row.app_id || '').toLowerCase(), row.id]));
      activity.push(...rows.filter(row => ids.has(String(row.appId || '').toLowerCase())).map(row => ({
        principal_id: ids.get(String(row.appId).toLowerCase()),
        principal_type: 'service_principal',
        app_id: row.appId,
        last_sign_in_at: latestActivity(row),
        sign_in_activity: row,
      })));
    } catch {
      failed++;
    }
  }
  const attempted = Math.min(servicePrincipals.length, credentialLimit) + Math.min(users.length, credentialLimit);
  const allTargetsAttempted = servicePrincipals.length <= credentialLimit && users.length <= credentialLimit;
  return {
    service_principal_credentials: credentials,
    federated_identity_credentials: federated,
    sign_in_activity: activity,
    coverage: { complete: failed === 0 && allTargetsAttempted, attempted, failed },
  };
}
