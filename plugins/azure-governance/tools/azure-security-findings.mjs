import { finding, latestSnapshot, publishFindings, resourceId, stateOf, tagsOf, valueAt } from './lib.mjs';

const SENSITIVE_PRIVATE_ENDPOINT_TYPES = new Set([
  'microsoft.keyvault/vaults',
  'microsoft.storage/storageaccounts',
  'microsoft.sql/servers',
  'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.dbformysql/flexibleservers',
  'microsoft.documentdb/databaseaccounts',
  'microsoft.containerregistry/registries',
]);

const DEFAULT_DIAGNOSTIC_TYPES = new Set([
  ...SENSITIVE_PRIVATE_ENDPOINT_TYPES,
  'microsoft.containerservice/managedclusters',
  'microsoft.eventhub/namespaces',
  'microsoft.servicebus/namespaces',
  'microsoft.web/sites',
]);

function normalizedId(value = '') {
  return String(value || '').replace(/\/$/, '').toLowerCase();
}

function resourceGroupFromId(value = '') {
  return String(value).match(/\/resourceGroups\/([^/]+)/i)?.[1] || '';
}

function subscriptionFromId(value = '') {
  return String(value).match(/\/subscriptions\/([^/]+)/i)?.[1] || '';
}

function isEnabled(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'enabled';
}

function isDisabled(value) {
  return value === false || ['false', 'disabled'].includes(String(value).toLowerCase());
}

function tlsBelow12(value) {
  if (value === undefined || value === null || value === '') return false;
  const normalized = String(value).toLowerCase().replace('tls', '').replace('_', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed < 1.2 : true;
}

function coverageComplete(value) {
  return value === true || value?.complete === true;
}

function severityFromImpact(value = '', fallback = 'medium') {
  const text = String(value || '').toLowerCase();
  if (['high', 'critical'].includes(text)) return 'high';
  if (['medium', 'moderate'].includes(text)) return 'medium';
  if (text === 'low') return 'low';
  return fallback;
}

function controlFinding(control, severity, category, title, target = '', evidence = {}) {
  return { ...finding(severity, category, title, target, evidence), control };
}

function sourcePrefixes(rule = {}) {
  const one = valueAt(rule, 'source', 'sourceAddressPrefix', 'source_address_prefix');
  const many = valueAt(rule, 'sourceAddressPrefixes', 'source_address_prefixes');
  return [one, ...(Array.isArray(many) ? many : [])].filter(Boolean).map(value => String(value).toLowerCase());
}

function hasOpenSource(rule = {}) {
  return sourcePrefixes(rule).some(source => ['*', '0.0.0.0/0', 'internet', 'any'].includes(source) || source === '::/0');
}

function destinationPorts(rule = {}) {
  const one = valueAt(rule, 'port', 'destinationPortRange', 'destination_port_range');
  const many = valueAt(rule, 'destinationPortRanges', 'destination_port_ranges');
  return [one, ...(Array.isArray(many) ? many : [])].filter(value => value !== undefined && value !== null).map(String);
}

function managementPort(rule = {}) {
  for (const port of destinationPorts(rule)) {
    if (['*', '22', '3389'].includes(port)) return port;
    const match = port.match(/^(\d+)-(\d+)$/);
    if (match && [22, 3389].some(candidate => candidate >= Number(match[1]) && candidate <= Number(match[2]))) return port;
  }
  return '';
}

function firewallRange(rule = {}) {
  return {
    start: String(valueAt(rule, 'start_ip_address', 'startIpAddress') || ''),
    end: String(valueAt(rule, 'end_ip_address', 'endIpAddress') || ''),
  };
}

function firewallExposure(rule = {}) {
  const { start, end } = firewallRange(rule);
  if (start === '0.0.0.0' && end === '255.255.255.255') return { severity: 'high', title: 'Database firewall allows the entire IPv4 internet' };
  if (start === '0.0.0.0' && end === '0.0.0.0') return { severity: 'medium', title: 'Database firewall allows connections from Azure services' };
  if (start === '::' && /^f{4}:/i.test(end)) return { severity: 'high', title: 'Database firewall allows the entire IPv6 internet' };
  return null;
}

function privateEndpointTargets(resources = []) {
  const targets = new Set();
  for (const resource of resources) {
    if (String(resource.type || '').toLowerCase() !== 'microsoft.network/privateendpoints') continue;
    const properties = resource.properties || {};
    const connections = [
      ...(properties.privateLinkServiceConnections || []),
      ...(properties.manualPrivateLinkServiceConnections || []),
    ];
    for (const connection of connections) {
      const target = connection.properties?.privateLinkServiceId || connection.privateLinkServiceId;
      const status = String(connection.properties?.privateLinkServiceConnectionState?.status || connection.privateLinkServiceConnectionState?.status || 'Approved').toLowerCase();
      if (target && status === 'approved') targets.add(normalizedId(target));
    }
  }
  return targets;
}

function resourceHasPrivateEndpoint(resource = {}, targets = new Set()) {
  if (targets.has(normalizedId(resource.id))) return true;
  const connections = valueAt(resource, 'privateEndpointConnections') || [];
  return Array.isArray(connections) && connections.some(connection => {
    const status = connection.properties?.privateLinkServiceConnectionState?.status || connection.privateLinkServiceConnectionState?.status;
    return String(status || '').toLowerCase() === 'approved';
  });
}

function diagnosticTargets(snapshot, args = {}) {
  const configured = Array.isArray(args.diagnostic_resource_types) && args.diagnostic_resource_types.length
    ? new Set(args.diagnostic_resource_types.map(value => String(value).toLowerCase()))
    : DEFAULT_DIAGNOSTIC_TYPES;
  return snapshot.resources.filter(resource => configured.has(String(resource.type || '').toLowerCase()));
}

function effectiveDiagnosticTargets(settings = []) {
  const targets = new Set();
  for (const setting of settings) {
    const hasDestination = setting.workspace_id || setting.workspaceId || setting.storage_account_id || setting.storageAccountId
      || setting.event_hub_authorization_rule_id || setting.eventHubAuthorizationRuleId || setting.marketplace_partner_id;
    const entries = [...(setting.logs || []), ...(setting.metrics || [])];
    const enabled = !entries.length || entries.some(entry => entry.enabled !== false && String(entry.enabled).toLowerCase() !== 'false');
    if (hasDestination && enabled) targets.add(normalizedId(setting.resource_id || setting.resourceId));
  }
  return targets;
}

function productionResourceGroup(group = {}, values = []) {
  const accepted = new Set((values.length ? values : ['prod', 'production', 'critical', 'tier-0', 'tier0']).map(value => String(value).toLowerCase()));
  const tags = tagsOf(group);
  const tagValues = [tags.environment, tags.env, tags.stage, tags.criticality, tags.tier].filter(Boolean).map(value => String(value).toLowerCase());
  return tagValues.some(value => accepted.has(value)) || /(^|[-_])prod(uction)?($|[-_])/i.test(group.name || '');
}

function protectedResourceGroups(locks = []) {
  return locks
    .filter(lock => ['canNotDelete', 'readOnly'].map(value => value.toLowerCase()).includes(String(lock.level || '').toLowerCase()))
    .map(lock => normalizedId(lock.scope || String(lock.id || '').split(/\/providers\/microsoft\.authorization\/locks/i)[0]));
}

function resourceGroupId(group = {}) {
  if (group.id) return group.id;
  if (group.subscription_id && group.name) return `/subscriptions/${group.subscription_id}/resourceGroups/${group.name}`;
  return group.name || '';
}

function resourceGroupProtected(group, lockScopes) {
  const id = normalizedId(resourceGroupId(group));
  return lockScopes.some(scope => id === scope || id.startsWith(`${scope}/`));
}

function latestPolicyStates(rows = []) {
  const states = new Map();
  for (const row of rows) {
    const assignment = row.policy_assignment_id || row.policyAssignmentId || row.policy_assignment_name || row.policyAssignmentName;
    const definition = row.policy_definition_id || row.policyDefinitionId || row.policy_definition_name || row.policyDefinitionName;
    const key = `${normalizedId(row.resource_id || row.resourceId)}|${normalizedId(assignment)}|${normalizedId(definition)}`;
    const existing = states.get(key);
    const timestamp = Date.parse(row.timestamp || 0) || 0;
    const existingTimestamp = Date.parse(existing?.timestamp || 0) || 0;
    if (!existing || timestamp >= existingTimestamp) states.set(key, row);
  }
  return [...states.values()];
}

function scoreRows(rows = [], identity = {}) {
  const counts = { compliant: 0, noncompliant: 0, exempt: 0, conflict: 0, unknown: 0 };
  for (const row of rows) {
    const state = String(row.compliance_state || row.complianceState || '').toLowerCase();
    if (state === 'compliant') counts.compliant++;
    else if (state === 'noncompliant') counts.noncompliant++;
    else if (state === 'exempt') counts.exempt++;
    else if (state === 'conflict') counts.conflict++;
    else counts.unknown++;
  }
  const evaluated = counts.compliant + counts.noncompliant + counts.exempt + counts.conflict;
  const score = evaluated ? Number((((counts.compliant + counts.exempt) / evaluated) * 100).toFixed(1)) : null;
  return { ...identity, score_percent: score, evaluated, ...counts };
}

function groupedScores(rows, keyFn, identityFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, values]) => scoreRows(values, identityFn(key, values)));
}

function complianceReport(snapshot) {
  const states = latestPolicyStates(snapshot.policy_states);
  const overall = scoreRows(states);
  const subscriptions = groupedScores(
    states,
    row => row.subscription_id || row.subscriptionId || subscriptionFromId(row.resource_id || row.resourceId),
    subscriptionId => ({ subscription_id: subscriptionId }),
  );
  const resourceGroups = groupedScores(
    states.filter(row => resourceGroupFromId(row.resource_id || row.resourceId)),
    row => `${row.subscription_id || row.subscriptionId || subscriptionFromId(row.resource_id || row.resourceId)}/${resourceGroupFromId(row.resource_id || row.resourceId)}`.toLowerCase(),
    (key, values) => ({
      subscription_id: values[0].subscription_id || values[0].subscriptionId || subscriptionFromId(values[0].resource_id || values[0].resourceId),
      resource_group: resourceGroupFromId(values[0].resource_id || values[0].resourceId),
    }),
  );
  const assignmentsById = new Map(snapshot.policy_assignments.map(row => [normalizedId(row.id), row]));
  const assignments = groupedScores(
    states,
    row => normalizedId(row.policy_assignment_id || row.policyAssignmentId),
    (assignmentId, values) => {
      const assignment = assignmentsById.get(assignmentId) || {};
      return {
        policy_assignment_id: assignmentId,
        policy_assignment_name: assignment.name || values[0].policy_assignment_name || values[0].policyAssignmentName || assignmentId,
        scope: assignment.scope || values[0].policy_assignment_scope || values[0].policyAssignmentScope,
        enforcement_mode: assignment.enforcement_mode,
      };
    },
  );
  const represented = new Set(assignments.map(row => normalizedId(row.policy_assignment_id)));
  for (const assignment of snapshot.policy_assignments) {
    if (!represented.has(normalizedId(assignment.id))) {
      assignments.push({
        policy_assignment_id: assignment.id,
        policy_assignment_name: assignment.name || assignment.assignment_name,
        scope: assignment.scope,
        enforcement_mode: assignment.enforcement_mode,
        score_percent: null,
        evaluated: 0,
        compliant: 0,
        noncompliant: 0,
        exempt: 0,
        conflict: 0,
        unknown: 0,
      });
    }
  }
  return { overall, subscriptions, resource_groups: resourceGroups, assignments };
}

function defenderSummary(rows = []) {
  const summary = { total: rows.length, healthy: 0, unhealthy: 0, not_applicable: 0, unknown: 0, severity: { high: 0, medium: 0, low: 0, unknown: 0 } };
  for (const row of rows) {
    const status = String(row.status_code || row.statusCode || '').toLowerCase().replace(/\s+/g, '_');
    if (status === 'healthy') summary.healthy++;
    else if (status === 'unhealthy') summary.unhealthy++;
    else if (status === 'notapplicable' || status === 'not_applicable') summary.not_applicable++;
    else summary.unknown++;
    const severity = String(row.severity || '').toLowerCase();
    if (['high', 'medium', 'low'].includes(severity)) summary.severity[severity]++;
    else summary.severity.unknown++;
  }
  return summary;
}

function secureScoreSummary(rows = []) {
  const subscriptions = rows.map(row => {
    const current = Number(row.current || 0);
    const maximum = Number(row.maximum || 0);
    let percentage = Number(row.percentage || 0);
    if (percentage > 0 && percentage <= 1) percentage *= 100;
    if (!percentage && maximum > 0) percentage = current / maximum * 100;
    return { ...row, score_percent: Number(percentage.toFixed(2)) };
  });
  const current = subscriptions.reduce((sum, row) => sum + Number(row.current || 0), 0);
  const maximum = subscriptions.reduce((sum, row) => sum + Number(row.maximum || 0), 0);
  return {
    score_percent: maximum > 0 ? Number((current / maximum * 100).toFixed(2)) : null,
    current,
    maximum,
    subscriptions,
  };
}

function regulatorySummary(rows = []) {
  const standards = new Map();
  for (const row of rows) {
    const name = row.standard || 'unknown';
    if (!standards.has(name)) standards.set(name, { standard: name, passed: 0, failed: 0, skipped: 0, unsupported: 0, assessments: 0 });
    const item = standards.get(name);
    item.passed += Number(row.passed || 0);
    item.failed += Number(row.failed || 0);
    item.skipped += Number(row.skipped || 0);
    item.unsupported += Number(row.unsupported || 0);
    item.assessments++;
  }
  return [...standards.values()].map(row => ({
    ...row,
    score_percent: row.passed + row.failed > 0 ? Number((row.passed / (row.passed + row.failed) * 100).toFixed(2)) : null,
  })).sort((a, b) => b.failed - a.failed || a.standard.localeCompare(b.standard));
}

function findingSummary(findings = []) {
  const severity = { high: 0, medium: 0, low: 0 };
  const controls = {};
  for (const row of findings) {
    if (severity[row.severity] !== undefined) severity[row.severity]++;
    controls[row.control] = (controls[row.control] || 0) + 1;
  }
  return { ...severity, controls };
}

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const snapshot = latestSnapshot(state, args.scan_id);
    const findings = [];
    const evaluateMissing = args.evaluate_missing_controls !== false;
    const privateTargets = privateEndpointTargets(snapshot.resources);

    for (const resource of snapshot.resources) {
      const type = String(resource.type || '').toLowerCase();
      const id = resourceId(resource);
      if (type === 'microsoft.network/publicipaddresses' && String(resource.properties?.ipAddress || resource.ip || '').trim()) {
        findings.push(controlFinding('network.public_ip', 'medium', 'security', 'Public IP address is allocated', id, { resource }));
      }
      if (type === 'microsoft.network/networksecuritygroups') {
        const rules = resource.security_rules || resource.properties?.securityRules || [];
        for (const rule of rules) {
          const port = managementPort(rule);
          const access = String(valueAt(rule, 'access') || 'Allow').toLowerCase();
          const direction = String(valueAt(rule, 'direction') || 'Inbound').toLowerCase();
          if (access === 'allow' && direction === 'inbound' && hasOpenSource(rule) && port) {
            findings.push(controlFinding('network.open_management_port', 'high', 'security', `Open inbound management port ${port}`, id, { rule }));
          }
        }
      }
      if (type === 'microsoft.storage/storageaccounts' && isEnabled(valueAt(resource, 'allow_blob_public_access', 'allowBlobPublicAccess'))) {
        findings.push(controlFinding('storage.public_blob_access', 'high', 'security', 'Storage account allows public blob access', id, { resource }));
      }
      if (type === 'microsoft.storage/storageaccounts' && tlsBelow12(valueAt(resource, 'minimumTlsVersion', 'minimum_tls_version'))) {
        findings.push(controlFinding('storage.minimum_tls', 'high', 'security', 'Storage account permits TLS below 1.2', id, { minimum_tls_version: valueAt(resource, 'minimumTlsVersion', 'minimum_tls_version') }));
      }
      if (type === 'microsoft.storage/storageaccounts' && isDisabled(valueAt(resource, 'supportsHttpsTrafficOnly', 'supports_https_traffic_only'))) {
        findings.push(controlFinding('storage.https_only_disabled', 'high', 'security', 'Storage account does not require secure transfer', id, { resource }));
      }
      if (type === 'microsoft.storage/storageaccounts' && isEnabled(valueAt(resource, 'allowSharedKeyAccess', 'allow_shared_key_access'))) {
        findings.push(controlFinding('storage.local_auth_enabled', 'medium', 'security', 'Storage account shared-key authentication is enabled', id, { resource }));
      }
      const infrastructureEncryption = valueAt(resource, 'requireInfrastructureEncryption', 'require_infrastructure_encryption')
        ?? resource.properties?.encryption?.requireInfrastructureEncryption;
      if (type === 'microsoft.storage/storageaccounts' && isDisabled(infrastructureEncryption)) {
        findings.push(controlFinding('storage.infrastructure_encryption_disabled', 'low', 'security', 'Storage infrastructure encryption is disabled', id, { resource }));
      }
      const publicNetworkAccess = String(valueAt(resource, 'public_network_access', 'publicNetworkAccess') || '').toLowerCase();
      if (type === 'microsoft.keyvault/vaults' && publicNetworkAccess !== 'disabled') {
        findings.push(controlFinding('key_vault.public_network', 'medium', 'security', 'Key Vault public network access is enabled or unknown', id, { resource }));
      }
      if (['microsoft.sql/servers', 'microsoft.dbforpostgresql/flexibleservers', 'microsoft.dbformysql/flexibleservers'].includes(type) && publicNetworkAccess === 'enabled') {
        findings.push(controlFinding('database.public_network', 'medium', 'security', 'Database server public network access is enabled', id, { resource }));
      }
      if (type === 'microsoft.sql/servers' && tlsBelow12(valueAt(resource, 'minimalTlsVersion', 'minimal_tls_version'))) {
        findings.push(controlFinding('sql.minimum_tls', 'high', 'security', 'SQL server permits TLS below 1.2', id, { minimum_tls_version: valueAt(resource, 'minimalTlsVersion', 'minimal_tls_version') }));
      }
      if (type === 'microsoft.sql/servers/azureadonlyauthentications' && isDisabled(valueAt(resource, 'azureADOnlyAuthentication', 'azure_ad_only_authentication'))) {
        findings.push(controlFinding('sql.local_auth_enabled', 'high', 'security', 'SQL server permits SQL authentication', id, { resource }));
      }
      if (type === 'microsoft.sql/servers/databases/transparentdataencryptions' && isDisabled(valueAt(resource, 'status'))) {
        findings.push(controlFinding('sql.data_encryption_disabled', 'high', 'security', 'SQL database transparent data encryption is disabled', id, { resource }));
      }
      const passwordAuth = resource.properties?.authConfig?.passwordAuth;
      if (['microsoft.dbforpostgresql/flexibleservers', 'microsoft.dbformysql/flexibleservers'].includes(type) && isEnabled(passwordAuth)) {
        findings.push(controlFinding('database.local_auth_enabled', 'medium', 'security', 'Database password authentication is enabled', id, { resource_type: resource.type }));
      }
      if (type === 'microsoft.documentdb/databaseaccounts' && isDisabled(valueAt(resource, 'disableLocalAuth', 'disable_local_auth'))) {
        findings.push(controlFinding('cosmos.local_auth_enabled', 'high', 'security', 'Cosmos DB local key authentication is enabled', id, { resource }));
      }
      if (['microsoft.eventhub/namespaces', 'microsoft.servicebus/namespaces', 'microsoft.cognitiveservices/accounts', 'microsoft.search/searchservices'].includes(type)
        && isDisabled(valueAt(resource, 'disableLocalAuth', 'disable_local_auth'))) {
        findings.push(controlFinding('service.local_auth_enabled', 'medium', 'security', 'Service local authentication is enabled', id, { resource_type: resource.type }));
      }
      if (['microsoft.eventhub/namespaces', 'microsoft.servicebus/namespaces', 'microsoft.web/sites'].includes(type)
        && tlsBelow12(valueAt(resource, 'minimumTlsVersion', 'minTlsVersion', 'minimum_tls_version'))) {
        findings.push(controlFinding('service.minimum_tls', 'high', 'security', 'Service permits TLS below 1.2', id, { resource_type: resource.type }));
      }
      if (type === 'microsoft.containerregistry/registries' && isEnabled(valueAt(resource, 'adminUserEnabled', 'admin_user_enabled'))) {
        findings.push(controlFinding('container_registry.local_auth_enabled', 'high', 'security', 'Container Registry admin account is enabled', id, { resource }));
      }
      if (type === 'microsoft.containerregistry/registries' && isDisabled(resource.properties?.encryption?.status)) {
        findings.push(controlFinding('container_registry.encryption_disabled', 'medium', 'security', 'Container Registry customer-managed encryption is disabled', id, { resource }));
      }
      if (type === 'microsoft.containerservice/managedclusters' && (isDisabled(valueAt(resource, 'disableLocalAccounts', 'disable_local_accounts')) || isDisabled(valueAt(resource, 'enableRBAC', 'enable_rbac')))) {
        findings.push(controlFinding('aks.local_auth_or_rbac', 'high', 'security', 'AKS local accounts are enabled or Kubernetes RBAC is disabled', id, { resource }));
      }
      if (/firewallrules$/.test(type)) {
        const exposure = firewallExposure(resource);
        if (exposure) findings.push(controlFinding('database.broad_firewall', exposure.severity, 'security', exposure.title, id, { firewall_rule: resource }));
      }
      for (const rule of resource.firewall_rules || resource.properties?.firewallRules || []) {
        const exposure = firewallExposure(rule);
        if (exposure) findings.push(controlFinding('database.broad_firewall', exposure.severity, 'security', exposure.title, id, { firewall_rule: rule }));
      }
      if (evaluateMissing && coverageComplete(snapshot.coverage.resources) && SENSITIVE_PRIVATE_ENDPOINT_TYPES.has(type) && publicNetworkAccess !== 'disabled' && !resourceHasPrivateEndpoint(resource, privateTargets)) {
        findings.push(controlFinding('network.missing_private_endpoint', 'medium', 'compliance', 'Sensitive service has no approved private endpoint', id, { resource_type: resource.type }));
      }
    }

    if (evaluateMissing && coverageComplete(snapshot.coverage.diagnostic_settings)) {
      const configured = effectiveDiagnosticTargets(snapshot.diagnostic_settings);
      for (const resource of diagnosticTargets(snapshot, args)) {
        if (!configured.has(normalizedId(resource.id))) {
          findings.push(controlFinding('monitoring.missing_diagnostics', 'medium', 'compliance', 'Resource has no active diagnostic setting destination', resource.id, { resource_type: resource.type }));
        }
      }
    }

    if (evaluateMissing && coverageComplete(snapshot.coverage.resource_locks)) {
      const lockScopes = protectedResourceGroups(snapshot.resource_locks);
      for (const group of snapshot.resource_groups.filter(row => productionResourceGroup(row, args.production_tag_values || []))) {
        if (!resourceGroupProtected(group, lockScopes)) {
          findings.push(controlFinding('governance.missing_production_lock', 'medium', 'compliance', 'Production resource group has no CanNotDelete or ReadOnly lock', resourceGroupId(group), { resource_group: group }));
        }
      }
    }

    if (evaluateMissing && coverageComplete(snapshot.coverage.subscription_diagnostic_settings)) {
      const covered = new Set(snapshot.subscription_diagnostic_settings
        .filter(row => effectiveDiagnosticTargets([row]).size > 0)
        .map(row => String(row.subscription_id || subscriptionFromId(row.resource_id)).toLowerCase()));
      for (const subscription of snapshot.subscriptions) {
        const subscriptionId = String(subscription.id || subscription.subscription_id || '').toLowerCase();
        if (subscriptionId && !covered.has(subscriptionId)) {
          findings.push(controlFinding('monitoring.missing_activity_log_export', 'high', 'compliance', 'Subscription activity log has no active diagnostic destination', `/subscriptions/${subscriptionId}`, { subscription }));
        }
      }
    }

    for (const row of snapshot.policy_states) {
      if (String(row.compliance_state || row.complianceState || '').toLowerCase() === 'noncompliant') {
        const policyName = row.policy_definition_name || row.policyDefinitionName || row.policy_assignment_name || row.policyAssignmentName || 'Azure Policy';
        findings.push(controlFinding('policy.noncompliance', 'medium', 'policy', `Policy non-compliance: ${policyName}`, row.resource_id || row.resourceId || row.id, { policy_state: row }));
      }
    }
    for (const row of snapshot.policy_assignments) {
      if (String(row.enforcement_mode || row.enforcementMode || '').toLowerCase() === 'donotenforce') {
        findings.push(controlFinding('policy.enforcement_disabled', 'medium', 'policy', 'Policy assignment enforcement is disabled', row.id || row.scope, { policy_assignment: row }));
      }
    }
    for (const row of snapshot.security_assessments) {
      if (String(row.status_code || row.statusCode || '').toLowerCase() === 'unhealthy') {
        const title = row.name || row.displayName || 'Defender for Cloud recommendation is unhealthy';
        findings.push(controlFinding('defender.unhealthy_assessment', severityFromImpact(row.severity, 'medium'), 'security', title, row.resource_id || row.resourceId || row.id, { security_assessment: row }));
      }
    }
    for (const row of snapshot.advisor_recommendations) {
      if (String(row.category || '').toLowerCase() === 'security') {
        const title = row.problem || row.solution || 'Azure Advisor security recommendation';
        findings.push(controlFinding('advisor.security_recommendation', severityFromImpact(row.impact, 'medium'), 'security', title, row.resource_id || row.resourceId || row.id, { advisor_recommendation: row }));
      }
    }


    const secureScore = secureScoreSummary(snapshot.secure_scores);
    const secureScoreThreshold = Number(args.minimum_secure_score_percent ?? 70);
    for (const row of secureScore.subscriptions.filter(item => item.score_percent < secureScoreThreshold)) {
      findings.push(controlFinding('defender.low_secure_score', row.score_percent < 50 ? 'high' : 'medium', 'security', `Defender secure score is ${row.score_percent}%`, `/subscriptions/${row.subscription_id}`, { secure_score: row, threshold_percent: secureScoreThreshold }));
    }
    const regulatory = regulatorySummary(snapshot.regulatory_compliance);
    for (const row of snapshot.regulatory_compliance.filter(item => Number(item.failed || 0) > 0 || String(item.state || '').toLowerCase() === 'failed')) {
      findings.push(controlFinding('defender.regulatory_compliance_failure', 'medium', 'compliance', `Regulatory compliance failures: ${row.standard || 'unknown standard'}`, row.id || `/subscriptions/${row.subscription_id}`, { regulatory_compliance: row }));
    }

    const compliance = complianceReport(snapshot);
    const defender = defenderSummary(snapshot.security_assessments);
    const summary = findingSummary(findings);
    publishFindings(state, snapshot.id, findings);
    return {
      success: true,
      output: {
        scan_id: snapshot.id,
        finding_count: findings.length,
        summary: {
          ...summary,
          policy_assignment_count: snapshot.policy_assignments.length,
          non_compliant_policy_state_count: compliance.overall.noncompliant,
          compliance_score_percent: compliance.overall.score_percent,
          unhealthy_defender_assessment_count: defender.unhealthy,
          defender_secure_score_percent: secureScore.score_percent,
          regulatory_standard_count: regulatory.length,
          regulatory_failed_control_count: regulatory.reduce((sum, row) => sum + row.failed, 0),
        },
        compliance,
        defender,
        secure_score: secureScore,
        regulatory_compliance: regulatory,
        coverage: snapshot.coverage,
        findings,
      },
    };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
