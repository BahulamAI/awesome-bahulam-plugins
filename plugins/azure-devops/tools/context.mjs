export async function call(args = {}, { state } = {}) {
  const keys = ['bahulam_organization_id', 'bahulam_team_id', 'organization', 'project', 'team'];
  return { success: true, output: Object.fromEntries(keys.map(key => [key, state?.getConfig(key) || null])) };
}
