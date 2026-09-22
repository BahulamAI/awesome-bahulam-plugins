/**
 * Shared helpers for Azure Cost Analyzer tools.
 *
 * All tools read credentials from plugin config via `state.getConfig()`.
 * The LLM never sees these values — they stay in the local SQLite state
 * and are injected by the tool handler at runtime.
 */

/**
 * Read Azure credentials from plugin config.
 * Returns `{ ready: false, missing: [...], error: "..." }` when any
 * required field is absent, or `{ ready: true, subscription_id, tenant_id,
 * client_id, client_secret, currency }` when fully configured.
 *
 * @param {object} state — the plugin state proxy (injected by executor)
 * @returns {{ ready: boolean } & Record<string, any>}
 */
export function getAzureConfig(state) {
  const sub = state.getConfig('subscription_id');
  const tenant = state.getConfig('tenant_id');
  const client = state.getConfig('client_id');
  const secret = state.getConfig('client_secret');
  const currency = state.getConfig('currency');

  const missing = [];
  if (!sub) missing.push('subscription_id');
  if (!tenant) missing.push('tenant_id');
  if (!client) missing.push('client_id');
  if (!secret) missing.push('client_secret');

  if (missing.length) {
    return {
      ready: false,
      missing,
      error: `Azure credentials not configured. Missing: ${missing.join(', ')}. Open plugin Settings to configure.`,
    };
  }

  return {
    ready: true,
    subscription_id: sub,
    tenant_id: tenant,
    client_id: client,
    client_secret: secret,
    currency: currency || 'USD',
  };
}

/**
 * Keep the legacy dashboard payload during the migration, while publishing
 * typed workplane widgets for the generic renderer. Widgets contain data,
 * never arbitrary HTML or executable chart code.
 */
export function updateAzureWorkplane(state, legacy, widgets) {
  state.patch('dashboard_data', legacy);
  if (typeof state.upsertWorkplaneWidgets === 'function') {
    state.upsertWorkplaneWidgets(widgets, { title: 'Azure Cost Analyzer' });
  }
}
