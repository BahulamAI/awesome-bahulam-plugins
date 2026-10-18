/** Hosted PR operations: config and an RPC capability only, never credentials. */
export async function executeReview(operation, args, { connection, signal } = {}) {
  if (connection?.config?.auth_mode !== 'oauth2' || typeof connection?.execute !== 'function') {
    return { error: 'Connect Azure DevOps using OAuth in Bahulam connection settings. Hosted reviews require a brokered connection.' };
  }
  return connection.execute(operation, args, { signal });
}
