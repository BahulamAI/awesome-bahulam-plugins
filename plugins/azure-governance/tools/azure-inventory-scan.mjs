import { appendStream, asArray, costAmount, dollars, formatDollars, nowIso, stateOf } from './lib.mjs';
import { collectAzureCli } from './azure-cli.mjs';
import { collectAzureSdk } from './azure-sdk.mjs';

async function collectInventory(collectFrom, args, options) {
  if (collectFrom === 'snapshot') return {};
  if (collectFrom === 'azure_cli') return collectAzureCli(args, options);
  if (collectFrom === 'azure_sdk' || collectFrom === 'resource_graph') return collectAzureSdk(args, options);
  throw new Error(`Unsupported collect_from value: ${collectFrom}`);
}

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const collectFrom = String(args.collect_from || args.source || 'snapshot').toLowerCase();
    const collected = await collectInventory(collectFrom, args, options);
    const snapshot = {
      name: String(args.name || '').trim(),
      tenant_id: String(args.tenant_id || collected.tenant_id || '').trim(),
      subscriptions: collectFrom === 'snapshot' ? asArray(args.subscriptions) : asArray(collected.subscriptions),
      resource_groups: collectFrom === 'snapshot' ? asArray(args.resource_groups) : asArray(collected.resource_groups),
      resources: collectFrom === 'snapshot' ? asArray(args.resources) : asArray(collected.resources),
      role_assignments: collectFrom === 'snapshot' ? asArray(args.role_assignments) : asArray(collected.role_assignments),
      role_definitions: collectFrom === 'snapshot' ? asArray(args.role_definitions) : asArray(collected.role_definitions),
      principals: collectFrom === 'snapshot' ? asArray(args.principals) : asArray(collected.principals),
      group_memberships: collectFrom === 'snapshot' ? asArray(args.group_memberships) : asArray(collected.group_memberships),
      costs: collectFrom === 'snapshot' ? asArray(args.costs) : asArray(collected.costs),
      benefit_recommendations: collectFrom === 'snapshot' ? asArray(args.benefit_recommendations) : asArray(collected.benefit_recommendations),
      monitor_metrics: collectFrom === 'snapshot' ? asArray(args.monitor_metrics) : asArray(collected.monitor_metrics),
      pim_assignments: collectFrom === 'snapshot' ? asArray(args.pim_assignments) : asArray(collected.pim_assignments),
      service_principal_credentials: collectFrom === 'snapshot' ? asArray(args.service_principal_credentials) : asArray(collected.service_principal_credentials),
      federated_identity_credentials: collectFrom === 'snapshot' ? asArray(args.federated_identity_credentials) : asArray(collected.federated_identity_credentials),
      sign_in_activity: collectFrom === 'snapshot' ? asArray(args.sign_in_activity) : asArray(collected.sign_in_activity),
      policy_assignments: collectFrom === 'snapshot' ? asArray(args.policy_assignments) : asArray(collected.policy_assignments),
      policy_states: collectFrom === 'snapshot' ? asArray(args.policy_states) : asArray(collected.policy_states),
      security_assessments: collectFrom === 'snapshot' ? asArray(args.security_assessments) : asArray(collected.security_assessments),
      secure_scores: collectFrom === 'snapshot' ? asArray(args.secure_scores) : asArray(collected.secure_scores),
      regulatory_compliance: collectFrom === 'snapshot' ? asArray(args.regulatory_compliance) : asArray(collected.regulatory_compliance),
      advisor_recommendations: collectFrom === 'snapshot' ? asArray(args.advisor_recommendations) : asArray(collected.advisor_recommendations),
      diagnostic_settings: collectFrom === 'snapshot' ? asArray(args.diagnostic_settings) : asArray(collected.diagnostic_settings),
      subscription_diagnostic_settings: collectFrom === 'snapshot' ? asArray(args.subscription_diagnostic_settings) : asArray(collected.subscription_diagnostic_settings),
      resource_locks: collectFrom === 'snapshot' ? asArray(args.resource_locks) : asArray(collected.resource_locks),
      coverage: collectFrom === 'snapshot'
          ? {
            resources: args.resources !== undefined,
            policy_assignments: args.policy_assignments !== undefined,
            diagnostic_settings: args.diagnostic_settings !== undefined,
            subscription_diagnostic_settings: args.subscription_diagnostic_settings !== undefined,
            resource_locks: args.resource_locks !== undefined,
            secure_scores: args.secure_scores !== undefined,
            regulatory_compliance: args.regulatory_compliance !== undefined,
            pim_assignments: args.pim_assignments !== undefined,
            identity_details: args.service_principal_credentials !== undefined || args.sign_in_activity !== undefined,
            monitor_metrics: args.monitor_metrics !== undefined,
            benefit_recommendations: args.benefit_recommendations !== undefined,
            cost_details: args.costs !== undefined,
          }
        : (collected.coverage || {}),
      collector: collectFrom === 'snapshot' ? { source: 'snapshot' } : collected.collector,
      created_at: nowIso(),
    };
    if (!snapshot.name) throw new Error('name is required');

    const totalCost = dollars(snapshot.costs.reduce((sum, row) => sum + costAmount(row), 0));
    snapshot.summary = {
      subscription_count: snapshot.subscriptions.length,
      resource_group_count: snapshot.resource_groups.length,
      resource_count: snapshot.resources.length,
      role_assignment_count: snapshot.role_assignments.length,
      role_definition_count: snapshot.role_definitions.length,
      principal_count: snapshot.principals.length,
      group_membership_count: snapshot.group_memberships.length,
      pim_assignment_count: snapshot.pim_assignments.length,
      service_principal_credential_count: snapshot.service_principal_credentials.length,
      federated_identity_credential_count: snapshot.federated_identity_credentials.length,
      sign_in_activity_count: snapshot.sign_in_activity.length,
      benefit_recommendation_count: snapshot.benefit_recommendations.length,
      monitor_metric_resource_count: snapshot.monitor_metrics.length,
      policy_assignment_count: snapshot.policy_assignments.length,
      secure_score_count: snapshot.secure_scores.length,
      regulatory_compliance_count: snapshot.regulatory_compliance.length,
      diagnostic_setting_count: snapshot.diagnostic_settings.length,
      subscription_diagnostic_setting_count: snapshot.subscription_diagnostic_settings.length,
      resource_lock_count: snapshot.resource_locks.length,
      total_cost: totalCost,
      total_cost_usd: totalCost,
      total_cost_display: formatDollars(totalCost),
      currency: 'USD',
    };
    const id = appendStream(state, 'azure_scans', snapshot);
    appendStream(state, 'azure_activity', { type: 'scan_created', scan_id: id, name: snapshot.name, summary: snapshot.summary });
    return { success: true, output: { id, ...snapshot.summary, collector: snapshot.collector } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
