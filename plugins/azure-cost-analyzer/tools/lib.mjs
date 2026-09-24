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
 * Publish typed workplane widgets alongside the legacy dashboard payload.
 * Widgets carry data only — never HTML or executable chart code.
 *
 * Kept after the HTML panel was removed because the Workplane view can import
 * these widgets as a snapshot, and because a tool run should leave a trace of
 * what it read.
 */
export function updateAzureWorkplane(state, legacy, widgets) {
  if (typeof state.patch === 'function') state.patch('dashboard_data', legacy);
  if (typeof state.upsertWorkplaneWidgets === 'function') {
    state.upsertWorkplaneWidgets(widgets, { title: 'Azure Cost Analyzer' });
  }
}

/**
 * Turn any thrown error into the `{ success: false, output }` envelope the
 * runtime expects.
 *
 * Deliberately never substitutes sample data. A tool that cannot read Azure
 * must say so: a plausible-looking cost figure with no source behind it is the
 * one outcome worse than an error message.
 */
export function toolFailure(error, context) {
  const message = error?.message ? String(error.message) : String(error);
  return { success: false, output: context ? `${context}: ${message}` : message };
}
