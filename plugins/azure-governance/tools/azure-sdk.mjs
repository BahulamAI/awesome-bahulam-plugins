import {
  collectBenefitRecommendations,
  collectCostDetails,
  collectIdentityDetails,
  collectMonitorMetrics,
  collectPimAssignments,
} from './azure-enhancements.mjs';

function setupError(err) {
  if (err?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package '@azure\/identity'|Cannot find package '@azure\/arm-resourcegraph'|Cannot find package '@azure\/arm-costmanagement'/i.test(err?.message || '')) {
    return 'Azure SDK packages were not found. Install @azure/identity, @azure/arm-resourcegraph, and optionally @azure/arm-costmanagement for include_costs, then configure DefaultAzureCredential before using collect_from: "azure_sdk".';
  }
  if (/credential|authentication|login|tenant|unauthorized|forbidden/i.test(err?.message || '')) {
    return `Azure SDK authentication failed. Configure DefaultAzureCredential with az login, managed identity, or service principal credentials. Details: ${err.message}`;
  }
  return `Azure SDK Resource Graph query failed: ${err?.message || err}`;
}

function asScopeList(value) {
  return Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : [];
}

function selectedSubscriptions(args = {}) {
  const fromList = asScopeList(args.subscription_ids);
  const one = args.subscription_id ? [String(args.subscription_id).trim()] : [];
  const envOne = process.env.AZURE_SUBSCRIPTION_ID ? [String(process.env.AZURE_SUBSCRIPTION_ID).trim()] : [];
  return [...new Set([...fromList, ...one, ...envOne].filter(Boolean))];
}

function selectedManagementGroups(args = {}) {
  return [...new Set(asScopeList(args.management_group_ids).concat(asScopeList(args.management_groups)))];
}

function baseRequest(args, query, requestOptions = {}) {
  const request = {
    query,
    options: {
      resultFormat: 'objectArray',
      top: Number(args.page_size || 1000),
      ...requestOptions,
    },
  };
  const subscriptions = selectedSubscriptions(args);
  const managementGroups = selectedManagementGroups(args);
  if (subscriptions.length) request.subscriptions = subscriptions;
  if (managementGroups.length) request.managementGroups = managementGroups;
  return request;
}

async function createClient(options = {}) {
  if (options.resourceGraphClient) return options.resourceGraphClient;
  if (options.azureSdk?.resourceGraphClient) return options.azureSdk.resourceGraphClient;

  const identity = options.azureSdk?.identity || await import('@azure/identity');
  const resourceGraph = options.azureSdk?.resourceGraph || await import('@azure/arm-resourcegraph');
  const credential = options.azureSdk?.credential || new identity.DefaultAzureCredential();
  return new resourceGraph.ResourceGraphClient(credential);
}

async function createCredential(options = {}) {
  if (options.azureSdk?.credential) return options.azureSdk.credential;
  const identity = options.azureSdk?.identity || await import('@azure/identity');
  return new identity.DefaultAzureCredential();
}

async function createCostClient(options = {}) {
  if (options.costManagementClient) return options.costManagementClient;
  if (options.azureSdk?.costManagementClient) return options.azureSdk.costManagementClient;

  const identity = options.azureSdk?.identity || await import('@azure/identity');
  const costManagement = options.azureSdk?.costManagement || await import('@azure/arm-costmanagement');
  const credential = options.azureSdk?.credential || new identity.DefaultAzureCredential();
  return new costManagement.CostManagementClient(credential);
}

async function runGraphQuery(client, args, query, requestOptions = {}) {
  const rows = [];
  let skipToken;
  do {
    const request = baseRequest(args, query, requestOptions);
    if (skipToken) request.options.skipToken = skipToken;
    const response = await client.resources(request);
    const data = Array.isArray(response.data) ? response.data : [];
    rows.push(...data);
    skipToken = response.skipToken || response.$skipToken;
  } while (skipToken);
  return rows;
}

function costTimeframe(args = {}) {
  if (args.cost_start_date || args.cost_end_date) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      timeframe: 'Custom',
      timePeriod: {
        from: `${args.cost_start_date || today}T00:00:00Z`,
        to: `${args.cost_end_date || today}T23:59:59Z`,
      },
    };
  }
  return { timeframe: 'MonthToDate' };
}

function costFilter(args = {}) {
  if (!args.cost_resource_group) return undefined;
  return {
    dimensions: {
      name: 'ResourceGroup',
      operator: 'In',
      values: [String(args.cost_resource_group)],
    },
  };
}

const COST_DIMENSIONS = {
  resource_group: 'ResourceGroup',
  resource: 'ResourceId',
  resource_id: 'ResourceId',
  service: 'ServiceName',
  region: 'ResourceLocation',
  meter: 'Meter',
  meter_category: 'MeterCategory',
  meter_subcategory: 'MeterSubCategory',
  sku: 'Product',
  resource_type: 'ResourceType',
  pricing_model: 'PricingModel',
};

function costGrouping(args = {}) {
  const requested = Array.isArray(args.cost_dimensions) && args.cost_dimensions.length
    ? args.cost_dimensions
    : ['resource_group', 'resource'];
  const names = requested
    .map(value => COST_DIMENSIONS[String(value).toLowerCase()])
    .filter(Boolean);
  return [...new Set(names)].slice(0, 2).map(name => ({ type: 'Dimension', name }));
}

function costQueryBody(args = {}) {
  const filter = costFilter(args);
  return {
    type: 'Usage',
    ...costTimeframe(args),
    dataset: {
      granularity: 'Daily',
      aggregation: {
        totalCost: {
          name: 'CostUSD',
          function: 'Sum',
        },
      },
      grouping: [
        ...costGrouping(args),
      ],
      ...(filter ? { filter } : {}),
    },
  };
}

function indexColumns(columns = []) {
  const out = {};
  columns.forEach((column, index) => {
    out[String(column.name || '').toLowerCase()] = index;
  });
  return out;
}

function normalizeCostRows(response = {}, subscriptionId, args = {}) {
  const columns = indexColumns(response.columns || response.properties?.columns || []);
  const rows = response.rows || response.properties?.rows || [];
  return rows.map(row => ({
    subscription_id: subscriptionId,
    resource_group: row[columns.resourcegroup] || args.cost_resource_group || 'unknown',
    resource_id: row[columns.resourceid],
    service: row[columns.servicename] || row[columns.metercategory] || 'unknown',
    region: row[columns.resourcelocation],
    meter: row[columns.meter],
    meter_category: row[columns.metercategory],
    meter_subcategory: row[columns.metersubcategory],
    sku: row[columns.sku] || row[columns.product],
    pricing_model: row[columns.pricingmodel],
    charge_type: row[columns.chargetype],
    cost: row[columns.costusd] ?? row[columns.pretaxcostusd] ?? row[columns.pretaxcost] ?? row[columns.cost],
    currency: 'USD',
    source_currency: row[columns.currency] || 'USD',
    usage_start: formatUsageDate(row[columns.usagedate]),
    source: 'cost_management_sdk',
  }));
}

function formatUsageDate(value) {
  const text = String(value || '');
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text || undefined;
}

async function collectSdkCosts(args = {}, options = {}) {
  const client = await createCostClient(options);
  const subscriptions = selectedSubscriptions(args);
  const scopes = subscriptions.length
    ? subscriptions.map(id => ({ subscriptionId: id, scope: `subscriptions/${id}` }))
    : selectedManagementGroups(args).map(id => ({ subscriptionId: '', scope: `providers/Microsoft.Management/managementGroups/${id}` }));
  if (!scopes.length) return [];

  const costs = [];
  for (const item of scopes) {
    const response = await client.query.usage(item.scope, costQueryBody(args));
    costs.push(...normalizeCostRows(response, item.subscriptionId, args));
  }
  return costs;
}

function subscriptionFromId(id = '') {
  return String(id).match(/\/subscriptions\/([^/]+)/i)?.[1] || '';
}

function resourceGroupFromId(id = '') {
  return String(id).match(/\/resourceGroups\/([^/]+)/i)?.[1] || '';
}

function normalizeSubscription(row = {}) {
  return {
    id: row.subscriptionId || row.subscription_id || row.id,
    name: row.name,
    tenant_id: row.tenantId || row.tenant_id,
    state: row.state || row.properties?.state,
  };
}

function normalizeGroup(row = {}) {
  return {
    id: row.id,
    name: row.name || row.resourceGroup,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.id),
    location: row.location,
    tags: row.tags || {},
    properties: row.properties || {},
  };
}

function normalizeResource(row = {}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.id),
    resource_group: row.resourceGroup || row.resource_group || resourceGroupFromId(row.id),
    location: row.location,
    tags: row.tags || {},
    sku: row.sku,
    kind: row.kind,
    managedBy: row.managedBy || row.managed_by,
    properties: row.properties || {},
  };
}

function managedIdentityFederatedCredentials(resources = []) {
  return resources
    .filter(row => String(row.type || '').toLowerCase() === 'microsoft.managedidentity/userassignedidentities/federatedidentitycredentials')
    .map(row => ({
      id: row.id,
      principal_id: row.properties?.principalId,
      managed_identity_id: String(row.id || '').split(/\/federatedIdentityCredentials\//i)[0],
      name: row.name,
      issuer: row.properties?.issuer,
      subject: row.properties?.subject,
      audiences: row.properties?.audiences || [],
      source: 'azure_managed_identity',
    }));
}

function normalizeRoleAssignment(row = {}) {
  return {
    id: row.id,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.id || row.scope),
    principal: row.principalName || row.principal || row.principalId,
    principal_id: row.principalId || row.principal_id,
    principal_type: row.principalType || row.principal_type,
    role: row.roleDefinitionName || row.role || row.roleDefinitionId,
    role_definition_id: row.roleDefinitionId || row.role_definition_id,
    scope: row.scope || row.properties?.scope,
    condition: row.condition || row.properties?.condition,
    can_delegate: row.canDelegate ?? row.properties?.canDelegate,
  };
}

function normalizeRoleDefinition(row = {}) {
  return {
    id: row.id || row.roleDefinitionId || row.role_definition_id,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.id),
    name: row.roleName || row.role_name || row.properties?.roleName || row.name,
    description: row.description || row.properties?.description,
    role_type: row.roleType || row.role_type || row.properties?.type,
    assignable_scopes: row.assignableScopes || row.assignable_scopes || row.properties?.assignableScopes || [],
    permissions: row.permissions || row.properties?.permissions || [],
  };
}

function normalizePrincipal(row = {}) {
  const odataType = String(row['@odata.type'] || row.odata_type || row.type || '').replace('#microsoft.graph.', '');
  return {
    id: row.id,
    display_name: row.displayName || row.display_name || row.userPrincipalName || row.appId || row.id,
    user_principal_name: row.userPrincipalName || row.user_principal_name,
    app_id: row.appId || row.app_id,
    principal_type: row.principalType || row.principal_type || odataType,
    service_principal_type: row.servicePrincipalType || row.service_principal_type,
    account_enabled: row.accountEnabled ?? row.account_enabled,
    deleted_date_time: row.deletedDateTime || row.deleted_date_time,
    created_date_time: row.createdDateTime || row.created_date_time,
    last_sign_in_at: row.lastSignInDateTime || row.last_sign_in_at || row.signInActivity?.lastSignInDateTime,
  };
}

function normalizeGroupMembership(row = {}, group = {}) {
  const principal = normalizePrincipal({
    ...row,
    id: row.member_id || row.memberId || row.id,
    display_name: row.member_name || row.memberName || row.display_name,
    principal_type: row.member_type || row.memberType || row.principal_type,
    service_principal_type: row.service_principal_type,
    account_enabled: row.account_enabled,
    deleted_date_time: row.deleted_date_time,
    last_sign_in_at: row.last_sign_in_at,
  });
  return {
    group_id: group.id || group.group_id,
    group_name: group.display_name || group.displayName || group.name || group.id,
    member_id: principal.id,
    member_name: principal.display_name,
    member_type: principal.principal_type,
    service_principal_type: principal.service_principal_type,
    account_enabled: principal.account_enabled,
    deleted_date_time: principal.deleted_date_time,
    last_sign_in_at: principal.last_sign_in_at,
    membership_type: 'transitive',
  };
}

async function resolvePrincipals(roleAssignments, args = {}, options = {}) {
  const ids = [...new Set(roleAssignments.map(row => row.principal_id).filter(Boolean))];
  if (!args.include_principals || !ids.length) return [];

  if (typeof options.principalResolver === 'function') {
    const resolved = await options.principalResolver(ids, { tenant_id: args.tenant_id });
    const rows = Array.isArray(resolved) ? resolved : Object.values(resolved || {});
    return rows.map(normalizePrincipal);
  }

  const credential = await createCredential(options);
  const token = await credential.getToken('https://graph.microsoft.com/.default');
  const fetcher = options.fetch || globalThis.fetch;
  if (!fetcher) throw new Error('A fetch implementation is required for Microsoft Graph principal enrichment.');

  const principals = [];
  for (let index = 0; index < ids.length; index += 1000) {
    const response = await fetcher('https://graph.microsoft.com/v1.0/directoryObjects/getByIds', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ids.slice(index, index + 1000) }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Microsoft Graph returned ${response.status}: ${detail}`);
    }
    const body = await response.json();
    principals.push(...(body.value || []).map(normalizePrincipal));
  }
  return principals;
}

async function resolveGroupMemberships(roleAssignments, principals, args = {}, options = {}) {
  const groupIds = [...new Set(roleAssignments
    .filter(row => String(row.principal_type || '').toLowerCase() === 'group')
    .map(row => row.principal_id)
    .filter(Boolean))];
  if (!args.include_group_memberships || !groupIds.length) return [];

  const principalsById = new Map(principals.map(row => [String(row.id).toLowerCase(), row]));
  if (typeof options.groupMembershipResolver === 'function') {
    const resolved = await options.groupMembershipResolver(groupIds, { tenant_id: args.tenant_id });
    return (Array.isArray(resolved) ? resolved : []).map(row => normalizeGroupMembership(row, {
      id: row.group_id || row.groupId,
      display_name: row.group_name || row.groupName,
    }));
  }

  const credential = await createCredential(options);
  const token = await credential.getToken('https://graph.microsoft.com/.default');
  const fetcher = options.fetch || globalThis.fetch;
  if (!fetcher) throw new Error('A fetch implementation is required for Microsoft Graph group membership enrichment.');
  const limit = Math.max(1, Number(args.group_membership_limit || 5000));
  const memberships = [];

  for (const groupId of groupIds) {
    const group = principalsById.get(String(groupId).toLowerCase()) || { id: groupId };
    let url = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}/transitiveMembers?$select=id,displayName,userPrincipalName,appId,accountEnabled,servicePrincipalType,deletedDateTime`;
    while (url && memberships.length < limit) {
      const response = await fetcher(url, {
        headers: { authorization: `Bearer ${token.token}` },
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Microsoft Graph returned ${response.status}: ${detail}`);
      }
      const body = await response.json();
      for (const row of body.value || []) {
        memberships.push(normalizeGroupMembership(row, group));
        if (memberships.length >= limit) break;
      }
      url = body['@odata.nextLink'] || '';
    }
    if (memberships.length >= limit) break;
  }
  return memberships;
}

function mergeMemberPrincipals(principals, memberships) {
  const byId = new Map(principals.map(row => [String(row.id).toLowerCase(), row]));
  for (const row of memberships) {
    const id = String(row.member_id || '').toLowerCase();
    if (!id || byId.has(id)) continue;
    byId.set(id, normalizePrincipal({
      id: row.member_id,
      display_name: row.member_name,
      principal_type: row.member_type,
      service_principal_type: row.service_principal_type,
      account_enabled: row.account_enabled,
      deleted_date_time: row.deleted_date_time,
      last_sign_in_at: row.last_sign_in_at,
    }));
  }
  return [...byId.values()];
}

function definitionKey(value = '') {
  return String(value).split('/').filter(Boolean).pop()?.toLowerCase() || '';
}

function enrichRoleAssignments(assignments, roleDefinitions, principals, includePrincipals) {
  const definitionsById = new Map(roleDefinitions.map(row => [definitionKey(row.id), row]));
  const principalsById = new Map(principals.map(row => [String(row.id).toLowerCase(), row]));
  return assignments.map(row => {
    const definition = definitionsById.get(definitionKey(row.role_definition_id)) || {};
    const principal = principalsById.get(String(row.principal_id || '').toLowerCase()) || {};
    return {
      ...row,
      principal: principal.display_name || principal.user_principal_name || row.principal,
      principal_type: principal.principal_type || row.principal_type,
      principal_account_enabled: principal.account_enabled,
      principal_deleted_date_time: principal.deleted_date_time,
      principal_last_sign_in_at: principal.last_sign_in_at,
      service_principal_type: principal.service_principal_type,
      principal_missing: Boolean(includePrincipals && row.principal_id && !principal.id),
      role: definition.name || row.role,
      role_type: definition.role_type,
      role_description: definition.description,
      role_permissions: definition.permissions || [],
      role_assignable_scopes: definition.assignable_scopes || [],
    };
  });
}

function normalizePolicyState(row = {}) {
  return {
    id: row.id,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.resourceId || row.id),
    resource_id: row.resourceId || row.resource_id || row.properties?.resourceId,
    resource_type: row.resourceType || row.resource_type || row.properties?.resourceType,
    location: row.resourceLocation || row.location || row.properties?.resourceLocation,
    compliance_state: row.complianceState || row.compliance_state || row.properties?.complianceState,
    policy_assignment_id: row.policyAssignmentId || row.policy_assignment_id || row.properties?.policyAssignmentId,
    policy_assignment_name: row.policyAssignmentName || row.policy_assignment_name || row.properties?.policyAssignmentName,
    policy_assignment_scope: row.policyAssignmentScope || row.policy_assignment_scope || row.properties?.policyAssignmentScope,
    policy_definition_id: row.policyDefinitionId || row.policy_definition_id || row.properties?.policyDefinitionId,
    policy_definition_name: row.policyDefinitionName || row.policy_definition_name || row.properties?.policyDefinitionName,
    policy_definition_action: row.policyDefinitionAction || row.policy_definition_action || row.properties?.policyDefinitionAction,
    timestamp: row.timestamp || row.properties?.timestamp,
    properties: row.properties || {},
  };
}

function normalizePolicyAssignment(row = {}) {
  const scope = row.scope || row.properties?.scope || '';
  return {
    id: row.id,
    name: row.displayName || row.display_name || row.properties?.displayName || row.name,
    assignment_name: row.name,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.id || scope),
    scope,
    policy_definition_id: row.policyDefinitionId || row.policy_definition_id || row.properties?.policyDefinitionId,
    enforcement_mode: row.enforcementMode || row.enforcement_mode || row.properties?.enforcementMode || 'Default',
    not_scopes: row.notScopes || row.not_scopes || row.properties?.notScopes || [],
    parameters: row.parameters || row.properties?.parameters || {},
    metadata: row.metadata || row.properties?.metadata || {},
    identity: row.identity || {},
  };
}

function normalizeDiagnosticSetting(row = {}, resourceId = '') {
  const properties = row.properties || {};
  return {
    id: row.id,
    name: row.name,
    resource_id: resourceId || String(row.id || '').split(/\/providers\/microsoft\.insights\/diagnosticsettings/i)[0],
    workspace_id: properties.workspaceId,
    storage_account_id: properties.storageAccountId,
    event_hub_authorization_rule_id: properties.eventHubAuthorizationRuleId,
    event_hub_name: properties.eventHubName,
    marketplace_partner_id: properties.marketplacePartnerId,
    logs: properties.logs || [],
    metrics: properties.metrics || [],
  };
}

function normalizeResourceLock(row = {}, scope = '') {
  return {
    id: row.id,
    name: row.name,
    scope: scope || String(row.id || '').split(/\/providers\/microsoft\.authorization\/locks/i)[0],
    level: row.properties?.level || row.level,
    notes: row.properties?.notes || row.notes,
  };
}

const DIAGNOSTIC_RESOURCE_TYPES = new Set([
  'microsoft.keyvault/vaults',
  'microsoft.storage/storageaccounts',
  'microsoft.sql/servers',
  'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.dbformysql/flexibleservers',
  'microsoft.documentdb/databaseaccounts',
  'microsoft.containerregistry/registries',
  'microsoft.containerservice/managedclusters',
  'microsoft.eventhub/namespaces',
  'microsoft.servicebus/namespaces',
  'microsoft.web/sites',
]);

function diagnosticCandidates(resources, args = {}) {
  const configured = Array.isArray(args.diagnostic_resource_types) && args.diagnostic_resource_types.length
    ? new Set(args.diagnostic_resource_types.map(value => String(value).toLowerCase()))
    : DIAGNOSTIC_RESOURCE_TYPES;
  return resources.filter(row => row.id && configured.has(String(row.type || '').toLowerCase()));
}

async function armGetJson(url, options = {}, token = '') {
  if (typeof options.armGet === 'function') return options.armGet(url);
  const fetcher = options.fetch || globalThis.fetch;
  if (!fetcher) throw new Error('A fetch implementation is required for Azure governance detail collection.');
  const response = await fetcher(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure Resource Manager returned ${response.status}: ${detail}`);
  }
  return response.json();
}

async function armList(url, options = {}, token = '') {
  const rows = [];
  let next = url;
  while (next) {
    const body = await armGetJson(next, options, token);
    rows.push(...(body.value || []));
    next = body.nextLink || '';
  }
  return rows;
}

async function collectGovernanceDetails(resources, resourceGroups, subscriptions, args = {}, options = {}) {
  if (!args.include_governance_details) {
    return {
      diagnostic_settings: [],
      subscription_diagnostic_settings: [],
      resource_locks: [],
      coverage: { diagnostic_settings: false, subscription_diagnostic_settings: false, resource_locks: false },
      warnings: [],
    };
  }

  let token = '';
  if (typeof options.armGet !== 'function') {
    const credential = await createCredential(options);
    token = (await credential.getToken('https://management.azure.com/.default')).token;
  }
  const limit = Math.max(1, Number(args.governance_detail_limit || 500));
  const diagnostics = diagnosticCandidates(resources, args);
  const groups = resourceGroups.filter(row => row.id);
  const diagnosticTargets = diagnostics.slice(0, limit);
  const lockTargets = groups.slice(0, limit);
  const diagnosticSettings = [];
  const resourceLocks = [];
  const subscriptionDiagnosticSettings = [];
  const warnings = [];
  let diagnosticFailures = 0;
  let lockFailures = 0;
  let subscriptionDiagnosticFailures = 0;

  for (const resource of diagnosticTargets) {
    try {
      const url = `https://management.azure.com${resource.id}/providers/Microsoft.Insights/diagnosticSettings?api-version=2021-05-01-preview`;
      const rows = await armList(url, options, token);
      diagnosticSettings.push(...rows.map(row => normalizeDiagnosticSetting(row, resource.id)));
    } catch (err) {
      diagnosticFailures++;
      if (warnings.length < 10) warnings.push(`diagnostic settings failed for ${resource.id}: ${err.message}`);
    }
  }

  for (const group of lockTargets) {
    try {
      const url = `https://management.azure.com${group.id}/providers/Microsoft.Authorization/locks?api-version=2016-09-01`;
      const rows = await armList(url, options, token);
      resourceLocks.push(...rows.map(row => normalizeResourceLock(row, group.id)));
    } catch (err) {
      lockFailures++;
      if (warnings.length < 10) warnings.push(`resource locks failed for ${group.id}: ${err.message}`);
    }
  }

  for (const subscription of subscriptions) {
    const subscriptionId = subscription.id || subscription.subscription_id;
    if (!subscriptionId) continue;
    try {
      const url = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Insights/diagnosticSettings?api-version=2021-05-01-preview`;
      const rows = await armList(url, options, token);
      subscriptionDiagnosticSettings.push(...rows.map(row => ({
        ...normalizeDiagnosticSetting(row, `/subscriptions/${subscriptionId}`),
        subscription_id: subscriptionId,
        diagnostic_scope: 'subscription_activity_log',
      })));
    } catch (err) {
      subscriptionDiagnosticFailures++;
      if (warnings.length < 10) warnings.push(`activity log diagnostic settings failed for ${subscriptionId}: ${err.message}`);
    }
  }

  return {
    diagnostic_settings: diagnosticSettings,
    subscription_diagnostic_settings: subscriptionDiagnosticSettings,
    resource_locks: resourceLocks,
    coverage: {
      diagnostic_settings: {
        complete: diagnosticFailures === 0 && diagnosticTargets.length === diagnostics.length,
        attempted: diagnosticTargets.length,
        failed: diagnosticFailures,
        available: diagnosticSettings.length,
      },
      subscription_diagnostic_settings: {
        complete: subscriptionDiagnosticFailures === 0,
        attempted: subscriptions.length,
        failed: subscriptionDiagnosticFailures,
        available: subscriptionDiagnosticSettings.length,
      },
      resource_locks: {
        complete: lockFailures === 0 && lockTargets.length === groups.length,
        attempted: lockTargets.length,
        failed: lockFailures,
        available: resourceLocks.length,
      },
    },
    warnings,
  };
}

function normalizeSecurityAssessment(row = {}) {
  const status = row.status || row.properties?.status || {};
  const metadata = row.metadata || row.properties?.metadata || {};
  return {
    id: row.id,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.resourceId || row.id),
    resource_id: row.resourceId || row.resource_id || row.properties?.resourceDetails?.id || row.properties?.resourceId,
    name: row.displayName || row.name,
    severity: row.severity || metadata.severity,
    status_code: row.statusCode || status.code,
    status_cause: row.statusCause || status.cause,
    status_description: row.statusDescription || status.description,
    categories: row.categories || metadata.categories || [],
    remediation: row.remediation || metadata.remediationDescription,
    properties: row.properties || {},
  };
}

function normalizeSecureScore(row = {}) {
  const score = row.score || row.properties?.score || {};
  return {
    id: row.id,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.id),
    name: row.name,
    current: Number(row.current ?? score.current ?? 0),
    maximum: Number(row.maximum ?? row.max ?? score.max ?? 0),
    percentage: Number(row.percentage ?? score.percentage ?? 0),
    weight: Number(row.weight ?? row.properties?.weight ?? 0),
    properties: row.properties || {},
  };
}

function normalizeRegulatoryCompliance(row = {}) {
  const properties = row.properties || {};
  return {
    id: row.id,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.id),
    standard: row.standard || row.complianceStandard || row.name,
    control: row.control || row.complianceControl,
    assessment: row.assessment || row.assessmentName || properties.description,
    state: row.state || properties.state,
    passed: Number(row.passed ?? row.passedResources ?? row.passedControls ?? properties.passedResources ?? properties.passedControls ?? 0),
    failed: Number(row.failed ?? row.failedResources ?? row.failedControls ?? properties.failedResources ?? properties.failedControls ?? 0),
    skipped: Number(row.skipped ?? row.skippedResources ?? row.skippedControls ?? properties.skippedResources ?? properties.skippedControls ?? 0),
    unsupported: Number(row.unsupported ?? row.unsupportedControls ?? properties.unsupportedControls ?? 0),
    properties,
  };
}

function normalizeAdvisorRecommendation(row = {}) {
  const shortDescription = row.shortDescription || row.properties?.shortDescription || {};
  return {
    id: row.id,
    subscription_id: row.subscriptionId || row.subscription_id || subscriptionFromId(row.resourceId || row.id),
    resource_id: row.resourceId || row.resource_id || row.properties?.resourceMetadata?.resourceId,
    category: row.category || row.properties?.category,
    impact: row.impact || row.properties?.impact,
    problem: row.problem || shortDescription.problem,
    solution: row.solution || shortDescription.solution,
    impacted_field: row.impactedField || row.impacted_field || row.properties?.impactedField,
    impacted_value: row.impactedValue || row.impacted_value || row.properties?.impactedValue,
    annual_savings_amount: row.annualSavingsAmount ?? row.properties?.extendedProperties?.annualSavingsAmount,
    savings_currency: row.savingsCurrency || row.properties?.extendedProperties?.savingsCurrency,
    properties: row.properties || {},
  };
}

const SUBSCRIPTIONS_QUERY = `
resourcecontainers
| where type =~ 'microsoft.resources/subscriptions'
| project id=subscriptionId, subscriptionId, name, tenantId, state=tostring(properties.state), properties
`;

const RESOURCE_GROUPS_QUERY = `
resourcecontainers
| where type =~ 'microsoft.resources/subscriptions/resourcegroups'
| project id, name, subscriptionId, resourceGroup=name, location, tags, properties
`;

const RESOURCES_QUERY = `
resources
| project id, name, type, subscriptionId, resourceGroup, location, tags, kind, sku, managedBy, properties
`;

const ROLE_ASSIGNMENTS_QUERY = `
authorizationresources
| where type =~ 'microsoft.authorization/roleassignments'
| project id, name, type, subscriptionId, scope=tostring(properties.scope), principalId=tostring(properties.principalId), principalType=tostring(properties.principalType), roleDefinitionId=tostring(properties.roleDefinitionId), condition=tostring(properties.condition), canDelegate=tobool(properties.canDelegate), properties
`;

const ROLE_DEFINITIONS_QUERY = `
authorizationresources
| where type =~ 'microsoft.authorization/roledefinitions'
| project id, name, roleName=tostring(properties.roleName), description=tostring(properties.description), roleType=tostring(properties.type), assignableScopes=properties.assignableScopes, permissions=properties.permissions, properties
`;

const POLICY_STATES_QUERY = `
policyresources
| where type =~ 'microsoft.policyinsights/policystates'
| project id, subscriptionId, resourceId=tostring(properties.resourceId), resourceType=tostring(properties.resourceType), resourceLocation=tostring(properties.resourceLocation), complianceState=tostring(properties.complianceState), policyAssignmentId=tostring(properties.policyAssignmentId), policyAssignmentName=tostring(properties.policyAssignmentName), policyAssignmentScope=tostring(properties.policyAssignmentScope), policyDefinitionId=tostring(properties.policyDefinitionId), policyDefinitionName=tostring(properties.policyDefinitionName), policyDefinitionAction=tostring(properties.policyDefinitionAction), timestamp=tostring(properties.timestamp), properties
`;

const POLICY_ASSIGNMENTS_QUERY = `
policyresources
| where type =~ 'microsoft.authorization/policyassignments'
| project id, name, subscriptionId, scope=tostring(properties.scope), displayName=tostring(properties.displayName), policyDefinitionId=tostring(properties.policyDefinitionId), enforcementMode=tostring(properties.enforcementMode), notScopes=properties.notScopes, parameters=properties.parameters, metadata=properties.metadata, identity, properties
`;

const SECURITY_ASSESSMENTS_QUERY = `
securityresources
| where type =~ 'microsoft.security/assessments'
| project id, subscriptionId, resourceId=tostring(properties.resourceDetails.id), displayName=tostring(properties.displayName), severity=tostring(properties.metadata.severity), statusCode=tostring(properties.status.code), statusCause=tostring(properties.status.cause), statusDescription=tostring(properties.status.description), categories=properties.metadata.categories, remediation=tostring(properties.metadata.remediationDescription), properties
`;

const SECURE_SCORES_QUERY = `
securityresources
| where type =~ 'microsoft.security/securescores'
| project id, name, subscriptionId, current=todouble(properties.score.current), maximum=todouble(properties.score.max), percentage=todouble(properties.score.percentage), weight=todouble(properties.weight), properties
`;

const REGULATORY_COMPLIANCE_QUERY = `
securityresources
| where type =~ 'microsoft.security/regulatorycompliancestandards' or type =~ 'microsoft.security/regulatorycompliancestandards/regulatorycompliancecontrols/regulatorycomplianceassessments'
| extend standard=iff(type =~ 'microsoft.security/regulatorycompliancestandards', name, extract(@'/regulatoryComplianceStandards/(.+)/regulatoryComplianceControls', 1, id))
| extend control=extract(@'/regulatoryComplianceControls/(.+)/regulatoryComplianceAssessments', 1, id)
| project id, name, subscriptionId, standard, control, assessment=tostring(properties.description), state=tostring(properties.state), passedResources=toint(properties.passedResources), failedResources=toint(properties.failedResources), skippedResources=toint(properties.skippedResources), passedControls=toint(properties.passedControls), failedControls=toint(properties.failedControls), skippedControls=toint(properties.skippedControls), unsupportedControls=toint(properties.unsupportedControls), properties
`;

const ADVISOR_RECOMMENDATIONS_QUERY = `
advisorresources
| where type =~ 'microsoft.advisor/recommendations'
| project id, subscriptionId, resourceId=tostring(properties.resourceMetadata.resourceId), category=tostring(properties.category), impact=tostring(properties.impact), problem=tostring(properties.shortDescription.problem), solution=tostring(properties.shortDescription.solution), impactedField=tostring(properties.impactedField), impactedValue=tostring(properties.impactedValue), properties
`;

export async function collectAzureSdk(args = {}, options = {}) {
  let client;
  try {
    client = await createClient(options);
  } catch (err) {
    throw new Error(setupError(err));
  }

  const warnings = [];
  let subscriptions = [];
  let resourceGroups = [];
  let resources = [];
  let resourcesCollected = false;
  let roleAssignments = [];
  let roleDefinitions = [];
  let principals = [];
  let groupMemberships = [];
  let pimAssignments = [];
  let servicePrincipalCredentials = [];
  let federatedIdentityCredentials = [];
  let signInActivity = [];
  let principalEnrichmentSucceeded = false;
  let groupMembershipEnrichmentSucceeded = false;
  let policyStates = [];
  let policyAssignments = [];
  let policyAssignmentsCollected = false;
  let securityAssessments = [];
  let secureScores = [];
  let regulatoryCompliance = [];
  let advisorRecommendations = [];
  let costs = [];
  let benefitRecommendations = [];
  let monitorMetrics = [];
  let diagnosticSettings = [];
  let subscriptionDiagnosticSettings = [];
  let resourceLocks = [];
  const enhancementCoverage = {};
  let governanceCoverage = { diagnostic_settings: false, subscription_diagnostic_settings: false, resource_locks: false };

  try {
    subscriptions = (await runGraphQuery(client, args, SUBSCRIPTIONS_QUERY)).map(normalizeSubscription);
  } catch (err) {
    warnings.push(`subscription Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    resourceGroups = (await runGraphQuery(client, args, RESOURCE_GROUPS_QUERY)).map(normalizeGroup);
  } catch (err) {
    warnings.push(`resource group Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    resources = (await runGraphQuery(client, args, RESOURCES_QUERY)).map(normalizeResource);
    federatedIdentityCredentials = managedIdentityFederatedCredentials(resources);
    resourcesCollected = true;
  } catch (err) {
    warnings.push(`resource Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    roleAssignments = (await runGraphQuery(client, args, ROLE_ASSIGNMENTS_QUERY)).map(normalizeRoleAssignment);
  } catch (err) {
    warnings.push(`role assignment Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    roleDefinitions = (await runGraphQuery(client, args, ROLE_DEFINITIONS_QUERY)).map(normalizeRoleDefinition);
  } catch (err) {
    warnings.push(`role definition Resource Graph query failed: ${setupError(err)}`);
  }

  if (args.include_pim) {
    try {
      const pimSubscriptions = selectedSubscriptions(args).length
        ? selectedSubscriptions(args)
        : subscriptions.map(row => row.id).filter(Boolean);
      const pim = await collectPimAssignments(args, pimSubscriptions, selectedManagementGroups(args), options);
      pimAssignments = pim.rows;
      enhancementCoverage.pim_assignments = pim.coverage;
    } catch (err) {
      enhancementCoverage.pim_assignments = false;
      warnings.push(`Azure RBAC PIM collection failed: ${err.message}`);
    }
  }

  if (args.include_principals) {
    try {
      principals = await resolvePrincipals([...roleAssignments, ...pimAssignments], args, options);
      principalEnrichmentSucceeded = true;
    } catch (err) {
      warnings.push(`Microsoft Entra principal enrichment failed: ${err.message}. Directory.Read.All is required.`);
    }
  }

  roleAssignments = enrichRoleAssignments(roleAssignments, roleDefinitions, principals, principalEnrichmentSucceeded);

  if (args.include_group_memberships) {
    try {
      groupMemberships = await resolveGroupMemberships(roleAssignments, principals, args, options);
      principals = mergeMemberPrincipals(principals, groupMemberships);
      groupMembershipEnrichmentSucceeded = true;
    } catch (err) {
      warnings.push(`Microsoft Entra group membership enrichment failed: ${err.message}. GroupMember.Read.All or Directory.Read.All is required.`);
    }
  }

  if (args.include_identity_details) {
    try {
      const identityPrincipalMap = new Map(principals.map(row => [String(row.id || '').toLowerCase(), row]));
      for (const assignment of [...roleAssignments, ...pimAssignments]) {
        const id = String(assignment.principal_id || '').toLowerCase();
        if (!id || identityPrincipalMap.has(id)) continue;
        identityPrincipalMap.set(id, {
          id: assignment.principal_id,
          display_name: assignment.principal,
          principal_type: assignment.principal_type,
          service_principal_type: assignment.service_principal_type,
        });
      }
      const details = await collectIdentityDetails(args, [...identityPrincipalMap.values()], options);
      servicePrincipalCredentials = details.service_principal_credentials;
      federatedIdentityCredentials.push(...details.federated_identity_credentials);
      signInActivity = details.sign_in_activity;
      enhancementCoverage.identity_details = details.coverage;
    } catch (err) {
      enhancementCoverage.identity_details = false;
      warnings.push(`Microsoft Entra identity detail collection failed: ${err.message}. Application.Read.All and AuditLog.Read.All may be required.`);
    }
  }

  try {
    policyStates = (await runGraphQuery(client, args, POLICY_STATES_QUERY)).map(normalizePolicyState);
  } catch (err) {
    warnings.push(`policy state Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    policyAssignments = (await runGraphQuery(client, args, POLICY_ASSIGNMENTS_QUERY, { authorizationScopeFilter: 'AtScopeAndAbove' })).map(normalizePolicyAssignment);
    policyAssignmentsCollected = true;
  } catch (err) {
    warnings.push(`policy assignment Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    securityAssessments = (await runGraphQuery(client, args, SECURITY_ASSESSMENTS_QUERY)).map(normalizeSecurityAssessment);
  } catch (err) {
    warnings.push(`security assessment Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    secureScores = (await runGraphQuery(client, args, SECURE_SCORES_QUERY)).map(normalizeSecureScore);
    enhancementCoverage.secure_scores = true;
  } catch (err) {
    enhancementCoverage.secure_scores = false;
    warnings.push(`Defender secure score Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    regulatoryCompliance = (await runGraphQuery(client, args, REGULATORY_COMPLIANCE_QUERY)).map(normalizeRegulatoryCompliance);
    enhancementCoverage.regulatory_compliance = true;
  } catch (err) {
    enhancementCoverage.regulatory_compliance = false;
    warnings.push(`regulatory compliance Resource Graph query failed: ${setupError(err)}`);
  }

  try {
    advisorRecommendations = (await runGraphQuery(client, args, ADVISOR_RECOMMENDATIONS_QUERY)).map(normalizeAdvisorRecommendation);
  } catch (err) {
    warnings.push(`advisor recommendation Resource Graph query failed: ${setupError(err)}`);
  }

  if (args.include_cost_details) {
    try {
      const details = await collectCostDetails(args, selectedSubscriptions(args), options);
      costs = details.rows;
      enhancementCoverage.cost_details = details.coverage;
    } catch (err) {
      enhancementCoverage.cost_details = false;
      warnings.push(`Cost Details collection failed: ${setupError(err)}`);
    }
  } else if (args.include_costs) {
    try {
      costs = await collectSdkCosts(args, options);
    } catch (err) {
      warnings.push(`cost management SDK query failed: ${setupError(err)}`);
    }
  }


  if (args.include_benefit_recommendations) {
    try {
      const benefits = await collectBenefitRecommendations(args, selectedSubscriptions(args), options);
      benefitRecommendations = benefits.rows;
      enhancementCoverage.benefit_recommendations = benefits.coverage;
    } catch (err) {
      enhancementCoverage.benefit_recommendations = false;
      warnings.push(`native benefit recommendation collection failed: ${setupError(err)}`);
    }
  }

  if (args.include_monitor_metrics) {
    try {
      const metrics = await collectMonitorMetrics(args, resources, options);
      monitorMetrics = metrics.rows;
      enhancementCoverage.monitor_metrics = metrics.coverage;
    } catch (err) {
      enhancementCoverage.monitor_metrics = false;
      warnings.push(`Azure Monitor metric collection failed: ${setupError(err)}`);
    }
  }

  if (args.include_governance_details) {
    try {
      const details = await collectGovernanceDetails(resources, resourceGroups, subscriptions, args, options);
      diagnosticSettings = details.diagnostic_settings;
      subscriptionDiagnosticSettings = details.subscription_diagnostic_settings;
      resourceLocks = details.resource_locks;
      governanceCoverage = details.coverage;
      warnings.push(...details.warnings);
    } catch (err) {
      warnings.push(`governance detail collection failed: ${setupError(err)}`);
    }
  }

  const explicitSubscriptions = selectedSubscriptions(args);
  if (!subscriptions.length && explicitSubscriptions.length) {
    subscriptions = explicitSubscriptions.map(id => ({ id, name: id, tenant_id: args.tenant_id || process.env.AZURE_TENANT_ID || '' }));
  }

  const subscriptionFilter = new Set(explicitSubscriptions);
  if (subscriptionFilter.size) {
    subscriptions = subscriptions.filter(row => subscriptionFilter.has(row.id));
    resourceGroups = resourceGroups.filter(row => subscriptionFilter.has(row.subscription_id));
    resources = resources.filter(row => subscriptionFilter.has(row.subscription_id));
    roleAssignments = roleAssignments.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    roleDefinitions = roleDefinitions.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    policyAssignments = policyAssignments.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    policyStates = policyStates.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    securityAssessments = securityAssessments.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    advisorRecommendations = advisorRecommendations.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    costs = costs.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    benefitRecommendations = benefitRecommendations.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    monitorMetrics = monitorMetrics.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    pimAssignments = pimAssignments.filter(row => subscriptionFilter.has(subscriptionFromId(row.scope)) || !subscriptionFromId(row.scope));
    secureScores = secureScores.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    regulatoryCompliance = regulatoryCompliance.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    diagnosticSettings = diagnosticSettings.filter(row => subscriptionFilter.has(subscriptionFromId(row.resource_id)) || !subscriptionFromId(row.resource_id));
    subscriptionDiagnosticSettings = subscriptionDiagnosticSettings.filter(row => subscriptionFilter.has(row.subscription_id) || !row.subscription_id);
    resourceLocks = resourceLocks.filter(row => subscriptionFilter.has(subscriptionFromId(row.scope)) || !subscriptionFromId(row.scope));
  }

  if (!subscriptions.length && !resourceGroups.length && !resources.length && !roleAssignments.length && !policyStates.length && !securityAssessments.length && !advisorRecommendations.length) {
    throw new Error(warnings.length ? warnings.join('\n') : 'Azure Resource Graph returned no inventory rows for the selected scope.');
  }

  return {
    tenant_id: args.tenant_id || process.env.AZURE_TENANT_ID || subscriptions.find(row => row.tenant_id)?.tenant_id || '',
    subscriptions,
    resource_groups: resourceGroups,
    resources,
    role_assignments: roleAssignments,
    role_definitions: roleDefinitions,
    principals,
    group_memberships: groupMemberships,
    costs,
    benefit_recommendations: benefitRecommendations,
    monitor_metrics: monitorMetrics,
    pim_assignments: pimAssignments,
    service_principal_credentials: servicePrincipalCredentials,
    federated_identity_credentials: federatedIdentityCredentials,
    sign_in_activity: signInActivity,
    policy_assignments: policyAssignments,
    policy_states: policyStates,
    security_assessments: securityAssessments,
    secure_scores: secureScores,
    regulatory_compliance: regulatoryCompliance,
    advisor_recommendations: advisorRecommendations,
    diagnostic_settings: diagnosticSettings,
    subscription_diagnostic_settings: subscriptionDiagnosticSettings,
    resource_locks: resourceLocks,
    coverage: {
      resources: resourcesCollected,
      policy_assignments: policyAssignmentsCollected,
      ...governanceCoverage,
      ...enhancementCoverage,
    },
    collector: {
      source: 'azure_sdk',
      engine: 'resource_graph',
      subscriptions: explicitSubscriptions,
      management_groups: selectedManagementGroups(args),
      include_costs: Boolean(args.include_costs),
      include_cost_details: Boolean(args.include_cost_details),
      include_benefit_recommendations: Boolean(args.include_benefit_recommendations),
      include_monitor_metrics: Boolean(args.include_monitor_metrics),
      include_governance_details: Boolean(args.include_governance_details),
      include_principals: Boolean(args.include_principals),
      principal_enrichment_succeeded: principalEnrichmentSucceeded,
      include_group_memberships: Boolean(args.include_group_memberships),
      group_membership_enrichment_succeeded: groupMembershipEnrichmentSucceeded,
      include_pim: Boolean(args.include_pim),
      include_identity_details: Boolean(args.include_identity_details),
      warnings,
    },
  };
}
