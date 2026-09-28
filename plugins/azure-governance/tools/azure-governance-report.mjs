import { costAmount, dollars, formatDollars, isPrivilegedAssignment, latestSnapshot, listStream, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const snapshot = latestSnapshot(state, args.scan_id);
    const findings = listStream(state, 'azure_findings', 200)
      .map(row => row.payload || row)
      .filter(row => Number(row.scan_id) === Number(snapshot.id));
    const totalCost = dollars(snapshot.costs.reduce((sum, row) => sum + costAmount(row), 0));
    const privileged = snapshot.role_assignments.filter(isPrivilegedAssignment);
    const groupAssignments = snapshot.role_assignments.filter(row => String(row.principal_type || row.principalType || '').toLowerCase() === 'group');
    const inactivePrincipals = snapshot.role_assignments.filter(row => row.principal_account_enabled === false || row.account_enabled === false);
    const unknownPrincipals = snapshot.role_assignments.filter(row => {
      const type = String(row.principal_type || row.principalType || '').toLowerCase();
      return row.deleted || row.principal_missing || type === 'unknown';
    });
    const nonCompliant = snapshot.policy_states.filter(row => String(row.compliance_state || row.complianceState || '').toLowerCase() === 'noncompliant');
    const disabledPolicyAssignments = snapshot.policy_assignments.filter(row => String(row.enforcement_mode || row.enforcementMode || '').toLowerCase() === 'donotenforce');
    const unhealthyAssessments = snapshot.security_assessments.filter(row => String(row.status_code || row.statusCode || '').toLowerCase() === 'unhealthy');
    const costAdvisor = snapshot.advisor_recommendations.filter(row => String(row.category || '').toLowerCase() === 'cost');
    const securityAdvisor = snapshot.advisor_recommendations.filter(row => String(row.category || '').toLowerCase() === 'security');
    const expiredCredentials = snapshot.service_principal_credentials.filter(row => Date.parse(row.end_date_time || row.endDateTime || '') < Date.now());
    const eligiblePim = snapshot.pim_assignments.filter(row => String(row.assignment_type || '').toLowerCase() === 'eligible');
    const activePim = snapshot.pim_assignments.filter(row => String(row.assignment_type || '').toLowerCase() === 'active');
    const nativeSavings = dollars(snapshot.benefit_recommendations.reduce((sum, row) => sum + Number(row.estimated_savings_usd || row.net_savings || row.netSavings || 0), 0));
    const secureCurrent = snapshot.secure_scores.reduce((sum, row) => sum + Number(row.current || 0), 0);
    const secureMaximum = snapshot.secure_scores.reduce((sum, row) => sum + Number(row.maximum || 0), 0);
    const secureScorePercent = secureMaximum > 0 ? Number((secureCurrent / secureMaximum * 100).toFixed(2)) : null;
    const regulatoryFailures = snapshot.regulatory_compliance.reduce((sum, row) => sum + Number(row.failed || 0), 0);
    const high = findings.filter(row => row.severity === 'high').length;
    const medium = findings.filter(row => row.severity === 'medium').length;
    const markdown = [
      `# Azure Governance Report: ${snapshot.name}`,
      '',
      `- Subscriptions: ${snapshot.subscriptions.length}`,
      `- Resource groups: ${snapshot.resource_groups.length}`,
      `- Resources: ${snapshot.resources.length}`,
      `- Role assignments: ${snapshot.role_assignments.length}`,
      `- Privileged assignments: ${privileged.length}`,
      `- Group role assignments: ${groupAssignments.length}`,
      `- Expanded group memberships: ${snapshot.group_memberships.length}`,
      `- PIM assignments: ${snapshot.pim_assignments.length} (${eligiblePim.length} eligible, ${activePim.length} active)`,
      `- Expired service principal credentials: ${expiredCredentials.length}`,
      `- Federated identity credentials: ${snapshot.federated_identity_credentials.length}`,
      `- Inactive or unknown principals: ${inactivePrincipals.length + unknownPrincipals.length}`,
      `- Total observed cost: ${formatDollars(totalCost)}`,
      `- Native quoted commitment savings: ${formatDollars(nativeSavings)}`,
      `- Non-compliant policy states: ${nonCompliant.length}`,
      `- Policy assignments: ${snapshot.policy_assignments.length} (${disabledPolicyAssignments.length} not enforced)`,
      `- Unhealthy Defender assessments: ${unhealthyAssessments.length}`,
      `- Defender secure score: ${secureScorePercent === null ? 'not collected' : `${secureScorePercent}%`}`,
      `- Regulatory compliance failures: ${regulatoryFailures}`,
      `- Diagnostic settings collected: ${snapshot.diagnostic_settings.length}`,
      `- Subscription activity-log diagnostic settings: ${snapshot.subscription_diagnostic_settings.length}`,
      `- Resource locks collected: ${snapshot.resource_locks.length}`,
      `- Advisor recommendations: ${snapshot.advisor_recommendations.length}`,
      `- Findings: ${findings.length} (${high} high, ${medium} medium)`,
      '',
      '## Recommended Next Actions',
      high ? '- Review high-severity exposure and access findings first.' : '- No high-severity findings recorded in this scan.',
      privileged.length ? '- Review privileged RBAC assignments for least privilege.' : '- No privileged RBAC assignments were detected in supplied data.',
      eligiblePim.length || activePim.length ? '- Review eligible and time-bound PIM assignments before renewal.' : '- No Azure RBAC PIM assignments were captured.',
      expiredCredentials.length ? '- Rotate or remove expired service principal credentials.' : '- No expired service principal credentials were captured.',
      groupAssignments.length
        ? (snapshot.group_memberships.length ? '- Review expanded group-derived access alongside direct assignments.' : '- Collect group memberships to review effective group-derived access.')
        : '- No group role assignments were captured.',
      nonCompliant.length ? '- Review non-compliant Azure Policy states by assignment and impacted resource.' : '- No non-compliant Azure Policy states were captured.',
      disabledPolicyAssignments.length ? '- Review policy assignments configured with DoNotEnforce.' : '- No disabled policy enforcement was detected.',
      unhealthyAssessments.length || securityAdvisor.length ? '- Triage Defender and Advisor security recommendations by severity and impact.' : '- No Defender or Advisor security recommendations were captured.',
      costAdvisor.length ? '- Review Advisor cost recommendations for cleanup and right-sizing opportunities.' : '- No Advisor cost recommendations were captured.',
      snapshot.benefit_recommendations.length ? '- Validate Azure native reservation and Savings Plan quotes before purchase.' : '- No native commitment recommendations were captured.',
      totalCost ? '- Review top cost drivers and untagged spend before the next billing cycle.' : '- Add Cost Management export rows to enable spend analysis.',
    ].join('\n');
    return {
      success: true,
      output: {
        scan_id: snapshot.id,
        summary: {
          subscriptions: snapshot.subscriptions.length,
          resource_groups: snapshot.resource_groups.length,
          resources: snapshot.resources.length,
          role_assignments: snapshot.role_assignments.length,
          privileged_assignments: privileged.length,
          group_role_assignments: groupAssignments.length,
          group_memberships: snapshot.group_memberships.length,
          pim_assignments: snapshot.pim_assignments.length,
          eligible_pim_assignments: eligiblePim.length,
          active_pim_assignments: activePim.length,
          expired_service_principal_credentials: expiredCredentials.length,
          federated_identity_credentials: snapshot.federated_identity_credentials.length,
          inactive_principals: inactivePrincipals.length,
          unknown_principals: unknownPrincipals.length,
          currency: 'USD',
          total_cost: totalCost,
          total_cost_usd: totalCost,
          total_cost_display: formatDollars(totalCost),
          native_estimated_savings_usd: nativeSavings,
          native_estimated_savings_display: formatDollars(nativeSavings),
          non_compliant_policy_states: nonCompliant.length,
          policy_assignments: snapshot.policy_assignments.length,
          disabled_policy_assignments: disabledPolicyAssignments.length,
          unhealthy_security_assessments: unhealthyAssessments.length,
          defender_secure_score_percent: secureScorePercent,
          regulatory_compliance_failures: regulatoryFailures,
          diagnostic_settings: snapshot.diagnostic_settings.length,
          subscription_diagnostic_settings: snapshot.subscription_diagnostic_settings.length,
          resource_locks: snapshot.resource_locks.length,
          advisor_recommendations: snapshot.advisor_recommendations.length,
          findings: findings.length,
          high,
          medium,
        },
        markdown,
      },
    };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
