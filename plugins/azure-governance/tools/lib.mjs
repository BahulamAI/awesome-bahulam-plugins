export function nowIso() {
  return new Date().toISOString();
}

export async function stateOf(options = {}) {
  const state = await options.state;
  if (!state) throw new Error('azure-governance tools require plugin state');
  return state;
}

export function listStream(state, stream, limit = 50) {
  if (typeof state.list !== 'function') return [];
  return state.list(stream, { limit, order: 'desc' }) || [];
}

export function appendStream(state, stream, payload) {
  if (typeof state.append !== 'function') return null;
  return state.append(stream, payload);
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function latestSnapshot(state, scanId) {
  const snapshots = listStream(state, 'azure_scans', 100);
  if (scanId) {
    const found = snapshots.find(row => Number(row.id) === Number(scanId));
    if (!found) throw new Error(`Azure scan not found: ${scanId}`);
    return normalizeRow(found);
  }
  const latest = snapshots[0];
  if (!latest) throw new Error('No Azure inventory scan exists yet.');
  return normalizeRow(latest);
}

export function normalizeRow(row) {
  const payload = row.payload || row;
  return {
    id: row.id,
    created_at: row.created_at,
    ...payload,
    subscriptions: asArray(payload.subscriptions),
    resource_groups: asArray(payload.resource_groups),
    resources: asArray(payload.resources),
    role_assignments: asArray(payload.role_assignments),
    role_definitions: asArray(payload.role_definitions),
    principals: asArray(payload.principals),
    group_memberships: asArray(payload.group_memberships),
    costs: asArray(payload.costs),
    benefit_recommendations: asArray(payload.benefit_recommendations),
    monitor_metrics: asArray(payload.monitor_metrics),
    pim_assignments: asArray(payload.pim_assignments),
    service_principal_credentials: asArray(payload.service_principal_credentials),
    federated_identity_credentials: asArray(payload.federated_identity_credentials),
    sign_in_activity: asArray(payload.sign_in_activity),
    policy_assignments: asArray(payload.policy_assignments),
    policy_states: asArray(payload.policy_states),
    security_assessments: asArray(payload.security_assessments),
    secure_scores: asArray(payload.secure_scores),
    regulatory_compliance: asArray(payload.regulatory_compliance),
    advisor_recommendations: asArray(payload.advisor_recommendations),
    diagnostic_settings: asArray(payload.diagnostic_settings),
    subscription_diagnostic_settings: asArray(payload.subscription_diagnostic_settings),
    resource_locks: asArray(payload.resource_locks),
    coverage: payload.coverage || {},
  };
}

export function costAmount(row) {
  return Number(row.cost ?? row.amount ?? row.pretaxCost ?? row.pretax_cost ?? 0) || 0;
}

export function dollars(value) {
  return Number((Number(value) || 0).toFixed(2));
}

export function formatDollars(value) {
  return `$${dollars(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function valueAt(row = {}, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
    if (row.properties && row.properties[key] !== undefined && row.properties[key] !== null) {
      return row.properties[key];
    }
  }
  return undefined;
}

export function tagsOf(row = {}) {
  const out = {};
  for (const [key, value] of Object.entries(row.tags || {})) {
    out[String(key).toLowerCase()] = value;
  }
  return out;
}

export function resourceId(resource = {}) {
  return String(resource.id || resource.resource_id || resource.name || '').toLowerCase();
}

export function scopeText(value = '') {
  return String(value || '').toLowerCase();
}

export function isPrivilegedRole(role = '') {
  return ['owner', 'contributor', 'user access administrator', 'role based access control administrator']
    .includes(String(role).trim().toLowerCase());
}

export function rolePermissionActions(row = {}) {
  const permissions = Array.isArray(row.role_permissions) ? row.role_permissions : [];
  return [...new Set(permissions.flatMap(permission => [
    ...(Array.isArray(permission.actions) ? permission.actions : []),
    ...(Array.isArray(permission.dataActions) ? permission.dataActions : []),
  ]).map(action => String(action).toLowerCase()))];
}

export function customPrivilegeReason(row = {}) {
  const roleType = String(row.role_type || row.roleType || '').toLowerCase();
  if (roleType && roleType !== 'customrole' && roleType !== 'custom') return '';
  const actions = rolePermissionActions(row);
  if (actions.includes('*')) return 'Custom role grants wildcard actions';
  if (actions.some(action => action === 'microsoft.authorization/*' || action.includes('roleassignments/write') || action.includes('elevateaccess/action'))) {
    return 'Custom role can modify or elevate access';
  }
  if (actions.includes('*/write') || actions.includes('*/delete')) return 'Custom role grants broad write or delete actions';
  return '';
}

export function privilegeReason(row = {}) {
  const role = row.role || row.roleDefinitionName;
  if (isPrivilegedRole(role)) return `Privileged built-in role: ${role}`;
  return customPrivilegeReason(row);
}

export function isPrivilegedAssignment(row = {}) {
  return Boolean(privilegeReason(row));
}

export function groupBy(rows, keyFn, valueFn = row => row) {
  const out = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    out[key] ||= [];
    out[key].push(valueFn(row));
  }
  return out;
}

export function sumBy(rows, keyFn) {
  const out = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    out[key] ||= 0;
    out[key] += costAmount(row);
  }
  return Object.entries(out)
    .map(([name, cost]) => {
      const amount = dollars(cost);
      return { name, cost: amount, cost_usd: amount, cost_display: formatDollars(amount), currency: 'USD' };
    })
    .sort((a, b) => b.cost - a.cost);
}

export function finding(severity, category, title, target = '', evidence = {}) {
  return { severity, category, title, target, evidence };
}

export function publishFindings(state, scanId, findings) {
  for (const item of findings) {
    appendStream(state, 'azure_findings', {
      scan_id: scanId,
      ...item,
      created_at: nowIso(),
    });
  }
}
