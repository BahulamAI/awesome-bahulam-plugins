import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function azCommand() {
  return process.platform === 'win32' ? 'cmd.exe' : 'az';
}

function azArgs(args) {
  return process.platform === 'win32' ? ['/d', '/s', '/c', 'az', ...args] : args;
}

function asSubscriptionIds(args = {}, subscriptions = []) {
  const explicit = Array.isArray(args.subscription_ids) ? args.subscription_ids : [];
  const one = args.subscription_id ? [args.subscription_id] : [];
  const selected = [...explicit, ...one].map(value => String(value).trim()).filter(Boolean);
  if (selected.length) return [...new Set(selected)];
  return subscriptions
    .filter(row => !row.state || String(row.state).toLowerCase() === 'enabled')
    .map(row => String(row.id || row.subscriptionId || '').trim())
    .filter(Boolean);
}

function parseJson(command, stdout) {
  try {
    return JSON.parse(stdout || '[]');
  } catch (err) {
    throw new Error(`Azure CLI returned invalid JSON for "${command}": ${err.message}`);
  }
}

function setupError(err) {
  const text = [err.message, err.stderr, err.stdout].filter(Boolean).join('\n');
  if (err.code === 'ENOENT' || /not recognized|not found|cannot find/i.test(text)) {
    return 'Azure CLI was not found. Install Azure CLI, then run az login before using collect_from: "azure_cli".';
  }
  if (/az login|login|not logged|Please run/i.test(text)) {
    return 'Azure CLI is not logged in. Run az login, then retry collect_from: "azure_cli".';
  }
  return `Azure CLI command failed: ${text.trim()}`;
}

function graphError(err) {
  const text = [err.message, err.stderr, err.stdout].filter(Boolean).join('\n').trim();
  if (/extension|az graph|unrecognized|not recognized|misspelled/i.test(text)) {
    return `Azure Resource Graph CLI extension is unavailable: ${text}`;
  }
  return setupError(err);
}

export async function runAz(args, options = {}) {
  const runner = options.exec || (async argv => {
    const { stdout } = await execFileAsync(azCommand(), azArgs(argv), { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  });
  const argv = [...args, '--only-show-errors', '-o', 'json'];
  const stdout = await runner(argv);
  return parseJson(`az ${argv.join(' ')}`, stdout);
}

export async function runAzRest(args, options = {}) {
  const runner = options.exec || (async argv => {
    const { stdout } = await execFileAsync(azCommand(), azArgs(argv), { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  });
  const argv = ['rest', ...args, '--only-show-errors', '-o', 'json'];
  const stdout = await runner(argv);
  return parseJson(`az ${argv.join(' ')}`, stdout);
}

async function runAzGraphQuery(query, subscriptionIds, args = {}, options = {}) {
  const rows = [];
  let skipToken = '';
  do {
    const command = [
      'graph', 'query',
      '--graph-query', query,
      '--subscriptions', ...subscriptionIds,
      '--first', String(Math.min(1000, Math.max(1, Number(args.graph_page_size || 1000)))),
    ];
    if (skipToken) command.push('--skip-token', skipToken);
    const response = await runAz(command, options);
    if (Array.isArray(response)) {
      rows.push(...response);
      skipToken = '';
    } else {
      rows.push(...(Array.isArray(response?.data) ? response.data : []));
      skipToken = response?.skip_token || response?.skipToken || response?.$skipToken || '';
    }
  } while (skipToken);
  return rows;
}

function normalizeSubscription(row = {}) {
  return {
    id: row.id || row.subscriptionId,
    name: row.name,
    tenant_id: row.tenantId || row.tenant_id,
    state: row.state,
    is_default: Boolean(row.isDefault),
  };
}

function normalizeGroup(row = {}, subscriptionId) {
  return {
    id: row.id,
    name: row.name,
    subscription_id: subscriptionId,
    location: row.location,
    tags: row.tags || {},
    properties: row.properties || {},
  };
}

function normalizeResource(row = {}, subscriptionId) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    subscription_id: subscriptionId,
    resource_group: row.resourceGroup,
    location: row.location,
    tags: row.tags || {},
    sku: row.sku,
    kind: row.kind,
    managedBy: row.managedBy,
    properties: row.properties || {},
  };
}

function normalizeRoleAssignment(row = {}, subscriptionId) {
  return {
    id: row.id,
    subscription_id: subscriptionId,
    principal: row.principalName || row.signInName || row.principalId,
    principal_id: row.principalId,
    principal_type: row.principalType,
    role: row.roleDefinitionName,
    role_definition_id: row.roleDefinitionId,
    scope: row.scope,
    condition: row.condition,
    can_delegate: row.canDelegate,
  };
}

function normalizeRoleDefinition(row = {}) {
  return {
    id: row.id,
    subscription_id: row.subscriptionId,
    name: row.roleName || row.properties?.roleName || row.name,
    description: row.description || row.properties?.description,
    role_type: row.roleType || row.properties?.type,
    assignable_scopes: row.assignableScopes || row.properties?.assignableScopes || [],
    permissions: row.permissions || row.properties?.permissions || [],
  };
}

function normalizePolicyAssignment(row = {}) {
  return {
    id: row.id,
    assignment_name: row.name,
    name: row.displayName || row.properties?.displayName || row.name,
    subscription_id: row.subscriptionId,
    scope: row.scope || row.properties?.scope,
    policy_definition_id: row.policyDefinitionId || row.properties?.policyDefinitionId,
    enforcement_mode: row.enforcementMode || row.properties?.enforcementMode || 'Default',
    not_scopes: row.notScopes || row.properties?.notScopes || [],
    parameters: row.parameters || row.properties?.parameters || {},
  };
}

function normalizePolicyState(row = {}) {
  return {
    id: row.id,
    subscription_id: row.subscriptionId,
    resource_id: row.resourceId || row.properties?.resourceId,
    resource_type: row.resourceType || row.properties?.resourceType,
    compliance_state: row.complianceState || row.properties?.complianceState,
    policy_assignment_id: row.policyAssignmentId || row.properties?.policyAssignmentId,
    policy_assignment_name: row.policyAssignmentName || row.properties?.policyAssignmentName,
    policy_assignment_scope: row.policyAssignmentScope || row.properties?.policyAssignmentScope,
    policy_definition_id: row.policyDefinitionId || row.properties?.policyDefinitionId,
    policy_definition_name: row.policyDefinitionName || row.properties?.policyDefinitionName,
    policy_definition_action: row.policyDefinitionAction || row.properties?.policyDefinitionAction,
    timestamp: row.timestamp || row.properties?.timestamp,
  };
}

function normalizeSecurityAssessment(row = {}) {
  return {
    id: row.id,
    subscription_id: row.subscriptionId,
    resource_id: row.resourceId || row.properties?.resourceDetails?.id,
    name: row.displayName || row.properties?.displayName || row.name,
    severity: row.severity || row.properties?.metadata?.severity,
    status_code: row.statusCode || row.properties?.status?.code,
    status_cause: row.statusCause || row.properties?.status?.cause,
    remediation: row.remediation || row.properties?.metadata?.remediationDescription,
    properties: row.properties || {},
  };
}

function normalizeAdvisorRecommendation(row = {}) {
  return {
    id: row.id,
    subscription_id: row.subscriptionId,
    resource_id: row.resourceId || row.properties?.resourceMetadata?.resourceId,
    category: row.category || row.properties?.category,
    impact: row.impact || row.properties?.impact,
    problem: row.problem || row.properties?.shortDescription?.problem,
    solution: row.solution || row.properties?.shortDescription?.solution,
    annual_savings_amount: row.annualSavingsAmount ?? row.properties?.extendedProperties?.annualSavingsAmount,
    savings_currency: row.savingsCurrency || row.properties?.extendedProperties?.savingsCurrency,
    properties: row.properties || {},
  };
}

function normalizeSecureScore(row = {}) {
  return {
    id: row.id,
    subscription_id: row.subscriptionId,
    name: row.name,
    current: Number(row.current ?? row.properties?.score?.current ?? 0),
    maximum: Number(row.maximum ?? row.properties?.score?.max ?? 0),
    percentage: Number(row.percentage ?? row.properties?.score?.percentage ?? 0),
    weight: Number(row.weight ?? row.properties?.weight ?? 0),
    properties: row.properties || {},
  };
}

function normalizeRegulatoryCompliance(row = {}) {
  return {
    id: row.id,
    subscription_id: row.subscriptionId,
    standard: row.standard || row.name,
    control: row.control,
    assessment: row.assessment || row.properties?.description,
    state: row.state || row.properties?.state,
    passed: Number(row.passedResources ?? row.passedControls ?? row.properties?.passedResources ?? row.properties?.passedControls ?? 0),
    failed: Number(row.failedResources ?? row.failedControls ?? row.properties?.failedResources ?? row.properties?.failedControls ?? 0),
    skipped: Number(row.skippedResources ?? row.skippedControls ?? row.properties?.skippedResources ?? row.properties?.skippedControls ?? 0),
    unsupported: Number(row.unsupportedControls ?? row.properties?.unsupportedControls ?? 0),
    properties: row.properties || {},
  };
}

const GRAPH_QUERIES = {
  resources: `resources | project id, name, type, subscriptionId, resourceGroup, location, tags, sku, kind, managedBy, properties`,
  role_definitions: `authorizationresources | where type =~ 'microsoft.authorization/roledefinitions' | project id, name, subscriptionId, roleName=tostring(properties.roleName), description=tostring(properties.description), roleType=tostring(properties.type), assignableScopes=properties.assignableScopes, permissions=properties.permissions, properties`,
  policy_assignments: `policyresources | where type =~ 'microsoft.authorization/policyassignments' | project id, name, subscriptionId, displayName=tostring(properties.displayName), scope=tostring(properties.scope), policyDefinitionId=tostring(properties.policyDefinitionId), enforcementMode=tostring(properties.enforcementMode), notScopes=properties.notScopes, parameters=properties.parameters, properties`,
  policy_states: `policyresources | where type =~ 'microsoft.policyinsights/policystates' | project id, subscriptionId, resourceId=tostring(properties.resourceId), resourceType=tostring(properties.resourceType), complianceState=tostring(properties.complianceState), policyAssignmentId=tostring(properties.policyAssignmentId), policyAssignmentName=tostring(properties.policyAssignmentName), policyAssignmentScope=tostring(properties.policyAssignmentScope), policyDefinitionId=tostring(properties.policyDefinitionId), policyDefinitionName=tostring(properties.policyDefinitionName), policyDefinitionAction=tostring(properties.policyDefinitionAction), timestamp=tostring(properties.timestamp), properties`,
  security_assessments: `securityresources | where type =~ 'microsoft.security/assessments' | project id, name, subscriptionId, resourceId=tostring(properties.resourceDetails.id), displayName=tostring(properties.displayName), severity=tostring(properties.metadata.severity), statusCode=tostring(properties.status.code), statusCause=tostring(properties.status.cause), remediation=tostring(properties.metadata.remediationDescription), properties`,
  secure_scores: `securityresources | where type =~ 'microsoft.security/securescores' | project id, name, subscriptionId, current=todouble(properties.score.current), maximum=todouble(properties.score.max), percentage=todouble(properties.score.percentage), weight=todouble(properties.weight), properties`,
  regulatory_compliance: `securityresources | where type =~ 'microsoft.security/regulatorycompliancestandards' or type =~ 'microsoft.security/regulatorycompliancestandards/regulatorycompliancecontrols/regulatorycomplianceassessments' | extend standard=iff(type =~ 'microsoft.security/regulatorycompliancestandards', name, extract(@'/regulatoryComplianceStandards/(.+)/regulatoryComplianceControls', 1, id)), control=extract(@'/regulatoryComplianceControls/(.+)/regulatoryComplianceAssessments', 1, id) | project id, name, subscriptionId, standard, control, assessment=tostring(properties.description), state=tostring(properties.state), passedResources=toint(properties.passedResources), failedResources=toint(properties.failedResources), skippedResources=toint(properties.skippedResources), passedControls=toint(properties.passedControls), failedControls=toint(properties.failedControls), skippedControls=toint(properties.skippedControls), unsupportedControls=toint(properties.unsupportedControls), properties`,
  advisor_recommendations: `advisorresources | where type =~ 'microsoft.advisor/recommendations' | project id, subscriptionId, resourceId=tostring(properties.resourceMetadata.resourceId), category=tostring(properties.category), impact=tostring(properties.impact), problem=tostring(properties.shortDescription.problem), solution=tostring(properties.shortDescription.solution), annualSavingsAmount=todouble(properties.extendedProperties.annualSavingsAmount), savingsCurrency=tostring(properties.extendedProperties.savingsCurrency), properties`,
};

function normalizeCost(row = {}, subscriptionId) {
  const sourceCurrency = row.currency || row.billingCurrency || 'USD';
  const usdCost = row.costInUsd ?? row.pretaxCostInUsd ?? (String(sourceCurrency).toUpperCase() === 'USD' ? (row.pretaxCost ?? row.cost) : 0);
  return {
    subscription_id: subscriptionId,
    resource_group: row.resourceGroup || row.resourceGroupName,
    service: row.consumedService || row.meterCategory,
    region: row.instanceLocation || row.resourceLocation,
    resource_id: row.instanceId,
    cost: usdCost,
    currency: 'USD',
    source_cost: row.pretaxCost ?? row.cost,
    source_currency: sourceCurrency,
    usage_start: row.usageStart,
    usage_end: row.usageEnd,
    meter_category: row.meterCategory,
    meter_subcategory: row.meterSubCategory,
    raw: row,
  };
}

function costTimeframe(args = {}) {
  if (args.cost_start_date || args.cost_end_date) {
    const from = args.cost_start_date ? `${args.cost_start_date}T00:00:00Z` : undefined;
    const to = args.cost_end_date ? `${args.cost_end_date}T23:59:59Z` : undefined;
    return {
      timeframe: 'Custom',
      timePeriod: {
        from: from || `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
        to: to || new Date().toISOString(),
      },
    };
  }
  return { timeframe: 'MonthToDate' };
}

function costManagementGrouping(args = {}) {
  const dimensions = {
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
  const requested = Array.isArray(args.cost_dimensions) && args.cost_dimensions.length
    ? args.cost_dimensions
    : ['resource_group', 'resource'];
  return [...new Set(requested.map(value => dimensions[String(value).toLowerCase()]).filter(Boolean))]
    .slice(0, 2)
    .map(name => ({ type: 'Dimension', name }));
}

function costManagementFilter(args = {}) {
  if (!args.cost_resource_group) return undefined;
  return {
    dimensions: {
      name: 'ResourceGroup',
      operator: 'In',
      values: [String(args.cost_resource_group)],
    },
  };
}

function costManagementBody(args = {}) {
  const filter = costManagementFilter(args);
  return {
    type: 'Usage',
    ...costTimeframe(args),
    dataset: {
      granularity: args.cost_granularity === 'None' ? 'None' : 'Daily',
      aggregation: {
        totalCost: {
          name: 'CostUSD',
          function: 'Sum',
        },
      },
      grouping: costManagementGrouping(args),
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

function normalizeCostManagementRows(response = {}, subscriptionId, args = {}) {
  const properties = response.properties || response;
  const columns = indexColumns(properties.columns || []);
  return (properties.rows || []).map(row => ({
    subscription_id: subscriptionId,
    resource_group: row[columns.resourcegroup] || args.cost_resource_group || 'unknown',
    resource_id: row[columns.resourceid],
    service: row[columns.servicename] || 'unknown',
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
    usage_start: String(row[columns.usagedate] || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') || undefined,
    source: 'cost_management_query',
  }));
}

async function collectCostManagement(subscriptionId, args, options) {
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2024-08-01`;
  const tokenResponse = options.tokenProvider
    ? { accessToken: await options.tokenProvider('https://management.azure.com/.default') }
    : await runAz(['account', 'get-access-token', '--resource', 'https://management.azure.com/'], options);
  const token = tokenResponse.accessToken || tokenResponse.access_token || tokenResponse.token;
  if (!token) throw new Error('Azure CLI did not return an Azure Resource Manager access token. Run az login and retry.');

  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Cost Management collection requires the built-in fetch API.');
  const maxRetries = Math.min(2, Math.max(0, Number(args.cost_retry_count ?? 1)));
  const maxDelayMs = Math.min(30000, Math.max(1000, Number(args.cost_retry_max_seconds ?? 10) * 1000));
  const wait = options.sleep || sleep;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(costManagementBody(args)),
    });
    if (response.ok) {
      return normalizeCostManagementRows(await response.json(), subscriptionId, args);
    }

    const responseText = await response.text();
    if (response.status !== 429 || attempt === maxRetries) {
      throw new Error(`Cost Management query failed with HTTP ${response.status}: ${responseText || response.statusText}`);
    }
    const retryAfterSeconds = Number(response.headers.get('retry-after') || 5);
    await wait(Math.min(maxDelayMs, Math.max(1000, retryAfterSeconds * 1000)));
  }
  return [];
}

export async function collectAzureCli(args = {}, options = {}) {
  let accounts;
  try {
    accounts = await runAz(['account', 'list', '--all'], options);
  } catch (err) {
    throw new Error(setupError(err));
  }

  let tenants = [];
  try {
    tenants = await runAz(['account', 'tenant', 'list'], options);
  } catch {
    tenants = [];
  }

  const subscriptions = accounts.map(normalizeSubscription);
  const selectedSubscriptionIds = asSubscriptionIds(args, subscriptions);
  if (!selectedSubscriptionIds.length) {
    throw new Error('Azure CLI returned no enabled subscriptions. Pass subscription_id or subscription_ids if you need to scan disabled/non-default subscriptions.');
  }

  const resourceGroups = [];
  const resources = [];
  const roleAssignments = [];
  const roleDefinitions = [];
  const costs = [];
  const policyAssignments = [];
  const policyStates = [];
  const securityAssessments = [];
  const secureScores = [];
  const regulatoryCompliance = [];
  const advisorRecommendations = [];
  const warnings = [];
  let resourceFailures = 0;
  let resourceGraphSucceeded = false;
  let policyAssignmentsCollected = false;
  const graphCoverage = {
    role_definitions: false,
    policy_states: false,
    security_assessments: false,
    secure_scores: false,
    regulatory_compliance: false,
    advisor_recommendations: false,
  };

  if (args.use_resource_graph !== false) {
    try {
      const graphResources = await runAzGraphQuery(GRAPH_QUERIES.resources, selectedSubscriptionIds, args, options);
      resources.push(...graphResources.map(row => normalizeResource(row, row.subscriptionId || row.subscription_id)));
      resourceGraphSucceeded = true;
    } catch (err) {
      warnings.push(`Azure CLI Resource Graph unavailable; falling back to az resource list: ${graphError(err)} Install or update the resource-graph extension with az extension add --name resource-graph.`);
    }

    if (resourceGraphSucceeded) {
      const graphCollectors = [
        ['role_definitions', roleDefinitions, normalizeRoleDefinition],
        ['policy_assignments', policyAssignments, normalizePolicyAssignment],
        ['policy_states', policyStates, normalizePolicyState],
        ['security_assessments', securityAssessments, normalizeSecurityAssessment],
        ['secure_scores', secureScores, normalizeSecureScore],
        ['regulatory_compliance', regulatoryCompliance, normalizeRegulatoryCompliance],
        ['advisor_recommendations', advisorRecommendations, normalizeAdvisorRecommendation],
      ];
      for (const [name, target, normalize] of graphCollectors) {
        try {
          const rows = await runAzGraphQuery(GRAPH_QUERIES[name], selectedSubscriptionIds, args, options);
          target.push(...rows.map(normalize));
          if (name === 'policy_assignments') policyAssignmentsCollected = true;
          else graphCoverage[name] = true;
        } catch (err) {
          warnings.push(`${name.replace(/_/g, ' ')} Resource Graph query failed: ${setupError(err)}`);
        }
      }
    }
  }

  for (const subscriptionId of selectedSubscriptionIds) {
    try {
      const rows = await runAz(['group', 'list', '--subscription', subscriptionId], options);
      resourceGroups.push(...rows.map(row => normalizeGroup(row, subscriptionId)));
    } catch (err) {
      warnings.push(`resource groups failed for ${subscriptionId}: ${setupError(err)}`);
    }

    if (!resourceGraphSucceeded) {
      try {
        const rows = await runAz(['resource', 'list', '--subscription', subscriptionId], options);
        resources.push(...rows.map(row => normalizeResource(row, subscriptionId)));
      } catch (err) {
        resourceFailures++;
        warnings.push(`resources failed for ${subscriptionId}: ${setupError(err)}`);
      }
    }

    try {
      const rows = await runAz(['role', 'assignment', 'list', '--all', '--subscription', subscriptionId], options);
      roleAssignments.push(...rows.map(row => normalizeRoleAssignment(row, subscriptionId)));
    } catch (err) {
      warnings.push(`role assignments failed for ${subscriptionId}: ${setupError(err)}`);
    }

    if (args.include_costs) {
      try {
        const rows = await collectCostManagement(subscriptionId, args, options);
        costs.push(...rows);
      } catch (err) {
        warnings.push(`cost management query failed for ${subscriptionId}: ${setupError(err)}`);
        const costArgs = ['consumption', 'usage', 'list', '--subscription', subscriptionId, '--include-additional-properties'];
        if (args.cost_start_date) costArgs.push('--start-date', String(args.cost_start_date));
        if (args.cost_end_date) costArgs.push('--end-date', String(args.cost_end_date));
        try {
          const rows = await runAz(costArgs, options);
          costs.push(...rows.map(row => normalizeCost(row, subscriptionId)));
        } catch (usageErr) {
          warnings.push(`cost usage failed for ${subscriptionId}: ${setupError(usageErr)}`);
        }
      }
    }
  }

  if (args.include_costs && costs.length && !costs.some(row => Number(row.cost) > 0)) {
    warnings.push('Cost rows were collected, but Azure returned no numeric cost values. Check Cost Management Reader/Billing Reader permissions or query a billing scope.');
  }

  const definitionsById = new Map(roleDefinitions.map(row => [String(row.id || '').split('/').pop().toLowerCase(), row]));
  for (const assignment of roleAssignments) {
    const definition = definitionsById.get(String(assignment.role_definition_id || '').split('/').pop().toLowerCase());
    if (!definition) continue;
    assignment.role ||= definition.name;
    assignment.role_type = definition.role_type;
    assignment.role_description = definition.description;
    assignment.role_permissions = definition.permissions;
    assignment.role_assignable_scopes = definition.assignable_scopes;
  }

  return {
    tenant_id: args.tenant_id || subscriptions.find(row => selectedSubscriptionIds.includes(row.id))?.tenant_id || tenants[0]?.tenantId || '',
    subscriptions: subscriptions.filter(row => selectedSubscriptionIds.includes(row.id)),
    resource_groups: resourceGroups,
    resources,
    role_assignments: roleAssignments,
    role_definitions: roleDefinitions,
    costs,
    policy_assignments: policyAssignments,
    policy_states: policyStates,
    security_assessments: securityAssessments,
    secure_scores: secureScores,
    regulatory_compliance: regulatoryCompliance,
    advisor_recommendations: advisorRecommendations,
    coverage: {
      resources: {
        complete: resourceGraphSucceeded || resourceFailures === 0,
        attempted: resourceGraphSucceeded ? 1 : selectedSubscriptionIds.length,
        failed: resourceFailures,
        source: resourceGraphSucceeded ? 'azure_resource_graph' : 'az_resource_list',
      },
      policy_assignments: policyAssignmentsCollected,
      secure_scores: graphCoverage.secure_scores,
      regulatory_compliance: graphCoverage.regulatory_compliance,
      diagnostic_settings: false,
      subscription_diagnostic_settings: false,
      resource_locks: false,
    },
    collector: {
      source: 'azure_cli',
      engine: resourceGraphSucceeded ? 'azure_cli_resource_graph' : 'azure_cli',
      subscriptions: selectedSubscriptionIds,
      include_costs: Boolean(args.include_costs),
      use_resource_graph: args.use_resource_graph !== false,
      resource_graph_succeeded: resourceGraphSucceeded,
      resource_graph_coverage: graphCoverage,
      warnings,
    },
  };
}
