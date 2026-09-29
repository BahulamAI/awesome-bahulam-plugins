import { customPrivilegeReason, latestSnapshot, privilegeReason, scopeText, stateOf } from './lib.mjs';

function unique(values = []) {
  return [...new Set(values.filter(value => value !== undefined && value !== null && value !== ''))];
}

function principalName(row = {}) {
  return row.principal || row.principalName || row.display_name || row.principal_id || 'unknown';
}

function principalId(row = {}) {
  return String(row.principal_id || row.principalId || principalName(row)).toLowerCase();
}

function principalType(row = {}) {
  const raw = String(row.principal_type || row.principalType || row.member_type || '').toLowerCase();
  const servicePrincipalType = String(row.service_principal_type || row.servicePrincipalType || '').toLowerCase();
  if (raw.includes('managedidentity') || servicePrincipalType.includes('managedidentity')) return 'managed_identity';
  if (raw.includes('serviceprincipal')) return 'service_principal';
  if (raw === 'user') return 'user';
  if (raw === 'group') return 'group';
  return raw || 'unknown';
}

function scopeInfo(value = '') {
  const scope = String(value || '/');
  const lower = scope.toLowerCase().replace(/\/$/, '') || '/';
  const managementGroup = scope.match(/\/providers\/Microsoft\.Management\/managementGroups\/([^/]+)/i)?.[1];
  const subscription = scope.match(/\/subscriptions\/([^/]+)/i)?.[1];
  const resourceGroup = scope.match(/\/resourceGroups\/([^/]+)/i)?.[1];
  const providerIndex = lower.indexOf('/providers/', lower.indexOf('/resourcegroups/') + 1);

  if (lower === '/') return { scope_level: 'tenant', scope_name: 'tenant root' };
  if (managementGroup) return { scope_level: 'management_group', scope_name: managementGroup, management_group_id: managementGroup };
  if (resourceGroup && providerIndex >= 0) {
    return { scope_level: 'resource', scope_name: scope.split('/').filter(Boolean).pop(), subscription_id: subscription, resource_group: resourceGroup };
  }
  if (resourceGroup) return { scope_level: 'resource_group', scope_name: resourceGroup, subscription_id: subscription, resource_group: resourceGroup };
  if (subscription) return { scope_level: 'subscription', scope_name: subscription, subscription_id: subscription };
  return { scope_level: 'resource', scope_name: scope.split('/').filter(Boolean).pop() || scope };
}

function lastActivity(row = {}) {
  return row.principal_last_sign_in_at || row.last_sign_in_at || row.lastSignInDateTime || row.signInActivity?.lastSignInDateTime || '';
}

function isStale(row, staleDays, asOf) {
  const raw = lastActivity(row);
  if (!raw) return false;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return false;
  return asOf.getTime() - time > staleDays * 86400000;
}

function identityActivity(snapshot = {}) {
  return new Map(snapshot.sign_in_activity.map(row => [String(row.principal_id || row.principalId || '').toLowerCase(), row]));
}

function enrichActivity(row, activityById) {
  const activity = activityById.get(principalId(row));
  if (!activity) return row;
  return {
    ...row,
    principal_last_sign_in_at: activity.last_sign_in_at || activity.lastSignInDateTime || lastActivity(row),
    sign_in_activity: activity.sign_in_activity || activity,
  };
}

function pimAccessRows(snapshot, activityById, staleDays, asOf) {
  const principals = new Map(snapshot.principals.map(row => [String(row.id || '').toLowerCase(), row]));
  const definitions = new Map(snapshot.role_definitions.map(row => [String(row.id || '').split('/').pop().toLowerCase(), row]));
  return snapshot.pim_assignments.map(row => {
    const principal = principals.get(String(row.principal_id || '').toLowerCase()) || {};
    const definition = definitions.get(String(row.role_definition_id || '').split('/').pop().toLowerCase()) || {};
    const assignmentType = String(row.assignment_type || 'eligible').toLowerCase();
    const end = Date.parse(row.end_date_time || '');
    const expiresInDays = Number.isFinite(end) ? Math.ceil((end - asOf.getTime()) / 86400000) : null;
    return {
      ...decorate(enrichActivity({
        ...row,
        principal: principal.display_name || principal.user_principal_name || row.principal_id,
        principal_type: principal.principal_type || row.principal_type,
        principal_account_enabled: principal.account_enabled,
        role: definition.name || row.role_definition_id,
        role_type: definition.role_type,
        role_permissions: definition.permissions || [],
      }, activityById), `pim_${assignmentType}`, null, staleDays, asOf),
      assignment_type: assignmentType,
      time_bound: Boolean(row.start_date_time || row.end_date_time),
      expires_in_days: expiresInDays,
      expired: expiresInDays !== null && expiresInDays < 0,
    };
  });
}

function credentialReview(snapshot, asOf, expiryDays) {
  return snapshot.service_principal_credentials.map(row => {
    const end = Date.parse(row.end_date_time || row.endDateTime || '');
    const days = Number.isFinite(end) ? Math.ceil((end - asOf.getTime()) / 86400000) : null;
    return {
      ...row,
      expires_in_days: days,
      expired: days !== null && days < 0,
      expiring_soon: days !== null && days >= 0 && days <= expiryDays,
    };
  });
}

function decorate(row, accessPath = 'direct', viaGroup = null, staleDays = 90, asOf = new Date()) {
  const scope = scopeInfo(row.scope);
  const type = principalType(row);
  const reason = privilegeReason(row);
  const unknown = Boolean(row.deleted || row.principal_missing || type === 'unknown');
  const inactive = row.principal_account_enabled === false || row.account_enabled === false;
  const stale = isStale(row, staleDays, asOf);
  return {
    ...row,
    principal: principalName(row),
    principal_id: row.principal_id || row.principalId || '',
    principal_type: type,
    access_path: accessPath,
    via_group_id: viaGroup?.group_id || '',
    via_group: viaGroup?.group_name || '',
    ...scope,
    privileged: Boolean(reason),
    privilege_reason: reason,
    unknown_principal: unknown,
    inactive_principal: inactive,
    stale_principal: stale,
    last_activity_at: lastActivity(row) || null,
  };
}

function effectiveGroupAssignments(directAssignments, memberships, staleDays, asOf) {
  const assignmentsByGroup = new Map();
  for (const assignment of directAssignments) {
    if (principalType(assignment) !== 'group') continue;
    const key = principalId(assignment);
    if (!assignmentsByGroup.has(key)) assignmentsByGroup.set(key, []);
    assignmentsByGroup.get(key).push(assignment);
  }

  const expanded = [];
  for (const membership of memberships) {
    const groupId = String(membership.group_id || membership.groupId || '').toLowerCase();
    for (const assignment of assignmentsByGroup.get(groupId) || []) {
      expanded.push(decorate({
        ...assignment,
        principal: membership.member_name || membership.memberName || membership.display_name || membership.member_id,
        principal_id: membership.member_id || membership.memberId,
        principal_type: membership.member_type || membership.memberType,
        principal_account_enabled: membership.account_enabled ?? membership.accountEnabled,
        principal_deleted_date_time: membership.deleted_date_time || membership.deletedDateTime,
        principal_last_sign_in_at: membership.last_sign_in_at || membership.lastSignInDateTime,
      }, 'group', {
        group_id: membership.group_id || membership.groupId,
        group_name: membership.group_name || membership.groupName || principalName(assignment),
      }, staleDays, asOf));
    }
  }
  return expanded;
}

function assignmentKey(row = {}) {
  return [row.id || row.assignment_id || row.role, principalId(row), row.scope, row.access_path, row.via_group_id].join('|').toLowerCase();
}

function dedupeAssignments(rows = []) {
  const seen = new Set();
  return rows.filter(row => {
    const key = assignmentKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function principalReports(assignments = []) {
  const reports = new Map();
  for (const row of assignments) {
    const key = principalId(row);
    if (!reports.has(key)) {
      reports.set(key, {
        principal: row.principal,
        principal_id: row.principal_id,
        principal_type: row.principal_type,
        assignments: [],
      });
    }
    reports.get(key).assignments.push(row);
  }
  return [...reports.values()].map(report => {
    const rows = report.assignments;
    const flags = [];
    if (rows.some(row => row.privileged)) flags.push('privileged');
    if (rows.some(row => ['tenant', 'management_group', 'subscription'].includes(row.scope_level))) flags.push('broad_scope');
    if (rows.some(row => row.unknown_principal)) flags.push('unknown');
    if (rows.some(row => row.inactive_principal)) flags.push('inactive');
    if (rows.some(row => row.stale_principal)) flags.push('stale');
    return {
      principal: report.principal,
      principal_id: report.principal_id,
      principal_type: report.principal_type,
      assignment_count: rows.length,
      direct_assignment_count: rows.filter(row => row.access_path === 'direct').length,
      group_based_assignment_count: rows.filter(row => row.access_path === 'group').length,
      privileged_assignment_count: rows.filter(row => row.privileged).length,
      broad_scope_assignment_count: rows.filter(row => ['tenant', 'management_group', 'subscription'].includes(row.scope_level)).length,
      roles: unique(rows.map(row => row.role || row.roleDefinitionName)),
      scopes: unique(rows.map(row => row.scope)),
      via_groups: unique(rows.map(row => row.via_group)),
      risk_flags: flags,
      assignments: rows,
    };
  }).sort((a, b) => b.privileged_assignment_count - a.privileged_assignment_count || b.assignment_count - a.assignment_count || a.principal.localeCompare(b.principal));
}

function scopeReports(assignments = []) {
  const reports = new Map();
  for (const row of assignments) {
    const key = String(row.scope || '/').toLowerCase();
    if (!reports.has(key)) reports.set(key, { scope: row.scope || '/', scope_level: row.scope_level, assignments: [] });
    reports.get(key).assignments.push(row);
  }
  return [...reports.values()].map(report => ({
    scope: report.scope,
    scope_level: report.scope_level,
    assignment_count: report.assignments.length,
    privileged_assignment_count: report.assignments.filter(row => row.privileged).length,
    principals: unique(report.assignments.map(row => row.principal)),
    roles: unique(report.assignments.map(row => row.role || row.roleDefinitionName)),
    assignments: report.assignments,
  })).sort((a, b) => b.privileged_assignment_count - a.privileged_assignment_count || b.assignment_count - a.assignment_count || a.scope.localeCompare(b.scope));
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvExport(assignments = []) {
  const columns = ['principal', 'principal_id', 'principal_type', 'access_path', 'via_group', 'role', 'privileged', 'scope_level', 'scope', 'risk_flags'];
  const rows = assignments.map(row => ({
    ...row,
    role: row.role || row.roleDefinitionName,
    risk_flags: [row.unknown_principal && 'unknown', row.inactive_principal && 'inactive', row.stale_principal && 'stale'].filter(Boolean).join(';'),
  }));
  return [columns.join(','), ...rows.map(row => columns.map(column => csvValue(row[column])).join(','))].join('\n');
}

function markdownExport(snapshot, assignments, principalRows, scopeRows, pimRows = [], credentials = []) {
  const lines = [
    '# Azure RBAC Access Review',
    '',
    `- Scan: ${snapshot.name || snapshot.id}`,
    `- Effective assignments: ${assignments.length}`,
    `- Principals: ${principalRows.length}`,
    `- Scopes: ${scopeRows.length}`,
    `- PIM assignments: ${pimRows.length}`,
    `- Expired or expiring application credentials: ${credentials.filter(row => row.expired || row.expiring_soon).length}`,
    '',
    '| Principal | Type | Path | Role | Scope level | Scope | Risks |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of assignments) {
    const risks = [row.privileged && 'privileged', row.unknown_principal && 'unknown', row.inactive_principal && 'inactive', row.stale_principal && 'stale'].filter(Boolean).join(', ');
    const values = [row.principal, row.principal_type, row.access_path, row.role || row.roleDefinitionName, row.scope_level, row.scope, risks]
      .map(value => String(value || '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '));
    lines.push(`| ${values.join(' | ')} |`);
  }
  return lines.join('\n');
}

function matchesFilters(row, args = {}) {
  const principal = String(args.principal || '').toLowerCase();
  const scope = scopeText(args.scope);
  const scopeLevel = String(args.scope_level || '').toLowerCase();
  if (principal && !`${row.principal} ${row.principal_id} ${row.via_group}`.toLowerCase().includes(principal)) return false;
  if (scope && !scopeText(row.scope).startsWith(scope)) return false;
  if (scopeLevel && row.scope_level !== scopeLevel) return false;
  return true;
}

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const snapshot = latestSnapshot(state, args.scan_id);
    const staleDays = Math.max(1, Number(args.stale_days || 90));
    const asOf = args.as_of ? new Date(args.as_of) : new Date();
    if (!Number.isFinite(asOf.getTime())) throw new Error(`Invalid as_of date: ${args.as_of}`);

    const activityById = identityActivity(snapshot);
    const direct = snapshot.role_assignments.map(row => decorate(enrichActivity(row, activityById), 'direct', null, staleDays, asOf));
    const inherited = args.include_group_access === false
      ? []
      : effectiveGroupAssignments(snapshot.role_assignments, snapshot.group_memberships, staleDays, asOf);
    const assignments = dedupeAssignments([...direct, ...inherited]).filter(row => matchesFilters(row, args));
    const directAssignments = assignments.filter(row => row.access_path === 'direct');
    const privileged = assignments.filter(row => row.privileged);
    const broad = assignments.filter(row => ['tenant', 'management_group', 'subscription'].includes(row.scope_level));
    const directUsers = directAssignments.filter(row => row.principal_type === 'user');
    const groupAssignments = directAssignments.filter(row => row.principal_type === 'group');
    const groupBased = assignments.filter(row => row.access_path === 'group');
    const unknownPrincipals = assignments.filter(row => row.unknown_principal);
    const inactivePrincipals = assignments.filter(row => row.inactive_principal);
    const stalePrincipals = assignments.filter(row => row.stale_principal);
    const workloadBroadAccess = broad.filter(row => ['service_principal', 'managed_identity'].includes(row.principal_type));
    const principalRows = principalReports(assignments);
    const scopeRows = scopeReports(assignments);
    const pimRows = pimAccessRows(snapshot, activityById, staleDays, asOf).filter(row => matchesFilters(row, args));
    const eligiblePim = pimRows.filter(row => row.assignment_type === 'eligible');
    const activePim = pimRows.filter(row => row.assignment_type === 'active');
    const expiringPim = pimRows.filter(row => row.expires_in_days !== null && row.expires_in_days >= 0 && row.expires_in_days <= Number(args.pim_expiry_days || 30));
    const credentials = credentialReview(snapshot, asOf, Math.max(1, Number(args.credential_expiry_days || 30)));
    const expiredCredentials = credentials.filter(row => row.expired);
    const expiringCredentials = credentials.filter(row => row.expiring_soon);
    const principalFilter = String(args.principal || '').toLowerCase();
    const federatedIdentities = snapshot.federated_identity_credentials.filter(row => !principalFilter || `${row.principal_id} ${row.app_id} ${row.name} ${row.subject}`.toLowerCase().includes(principalFilter));
    const format = String(args.format || 'json').toLowerCase();

    const output = {
      scan_id: snapshot.id,
      assignment_count: directAssignments.length,
      effective_assignment_count: assignments.length,
      privileged_count: privileged.length,
      custom_privileged_count: privileged.filter(row => customPrivilegeReason(row)).length,
      broad_scope_count: broad.length,
      direct_user_assignment_count: directUsers.length,
      group_assignment_count: groupAssignments.length,
      effective_group_access_count: groupBased.length,
      workload_broad_access_count: workloadBroadAccess.length,
      unknown_principal_count: unknownPrincipals.length,
      inactive_principal_count: inactivePrincipals.length,
      stale_principal_count: stalePrincipals.length,
      pim_assignment_count: pimRows.length,
      eligible_pim_assignment_count: eligiblePim.length,
      active_pim_assignment_count: activePim.length,
      expiring_pim_assignment_count: expiringPim.length,
      service_principal_credential_count: credentials.length,
      expired_credential_count: expiredCredentials.length,
      expiring_credential_count: expiringCredentials.length,
      federated_identity_count: federatedIdentities.length,
      stale_days: staleDays,
      assignments,
      privileged,
      broad_scopes: broad,
      direct_users: directUsers,
      group_assignments: groupAssignments,
      group_based_access: groupBased,
      workload_broad_access: workloadBroadAccess,
      unknown_principals: unknownPrincipals,
      inactive_principals: inactivePrincipals,
      stale_principals: stalePrincipals,
      pim_assignments: pimRows,
      eligible_pim_assignments: eligiblePim,
      active_pim_assignments: activePim,
      expiring_pim_assignments: expiringPim,
      service_principal_credentials: credentials,
      expired_credentials: expiredCredentials,
      expiring_credentials: expiringCredentials,
      federated_identities: federatedIdentities,
      sign_in_activity: snapshot.sign_in_activity,
      principal_reports: principalRows,
      scope_reports: scopeRows,
    };
    const exportAssignments = [...assignments, ...pimRows];
    if (format === 'csv' || format === 'all') output.csv = csvExport(exportAssignments);
    if (format === 'markdown' || format === 'all') output.markdown = markdownExport(snapshot, exportAssignments, principalRows, scopeRows, pimRows, credentials);
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
