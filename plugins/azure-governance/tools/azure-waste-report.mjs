import { finding, formatDollars, latestSnapshot, publishFindings, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const snapshot = latestSnapshot(state, args.scan_id);
    const findings = [];
    for (const resource of snapshot.resources) {
      const type = String(resource.type || '').toLowerCase();
      const stateText = String(resource.power_state || resource.state || resource.properties?.powerState || '').toLowerCase();
      const attachedTo = resource.attached_to || resource.managedBy || resource.properties?.managedBy;
      if (type.includes('/disks') && !attachedTo) {
        findings.push(finding('medium', 'waste', 'Managed disk appears unattached', resource.id || resource.name, { resource }));
      }
      if (type.includes('publicipaddresses') && !resource.ipConfiguration && !resource.properties?.ipConfiguration) {
        findings.push(finding('low', 'waste', 'Public IP appears unattached', resource.id || resource.name, { resource }));
      }
      if (type.includes('virtualmachines') && stateText.includes('stopped')) {
        findings.push(finding('medium', 'waste', 'VM is stopped and may still be allocated', resource.id || resource.name, { resource }));
      }
      if (type.includes('snapshots') && Number(resource.age_days || 0) > 30) {
        findings.push(finding('low', 'waste', 'Snapshot is older than 30 days', resource.id || resource.name, { resource }));
      }
    }
    for (const row of snapshot.advisor_recommendations) {
      if (String(row.category || '').toLowerCase() === 'cost') {
        const amount = Number(row.annual_savings_amount ?? row.annualSavingsAmount ?? 0) || 0;
        const title = amount > 0
          ? `Advisor cost recommendation may save ${formatDollars(amount)}`
          : (row.problem || row.solution || 'Azure Advisor cost recommendation');
        findings.push(finding('medium', 'waste', title, row.resource_id || row.resourceId || row.id, { advisor_recommendation: row }));
      }
    }
    publishFindings(state, snapshot.id, findings);
    return { success: true, output: { scan_id: snapshot.id, finding_count: findings.length, findings } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
