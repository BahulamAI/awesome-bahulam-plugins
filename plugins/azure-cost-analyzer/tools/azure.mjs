/**
 * Azure Cost Management client.
 *
 * Talks to the real API: OAuth2 client-credentials against Entra ID, then the
 * Cost Management Query endpoint. There is no sample-data fallback anywhere in
 * this file — a failure returns a failure, because a fabricated cost figure is
 * worse than a visible error.
 *
 * Secrets never appear in a thrown message, a log line, or a URL.
 */

const LOGIN_HOST = 'https://login.microsoftonline.com';
const ARM_HOST = 'https://management.azure.com';
const COST_API_VERSION = '2026-06-01';
const SUBSCRIPTIONS_API_VERSION = '2022-12-01';
const BUDGETS_API_VERSION = '2024-08-01';

/** Failure that is safe to show a user and safe to log. */
export class AzureError extends Error {
  constructor(message, { status = 0, code = '', retryable = false } = {}) {
    super(message);
    this.name = 'AzureError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

// Tokens are cached per credential so a multi-tool turn does not re-authenticate
// six times. Keyed by tenant+client only — never by secret.
const tokenCache = new Map();

function tokenKey(config) {
  return `${config.tenant_id}:${config.client_id}`;
}

function redact(text) {
  // Defence in depth: if a provider ever echoes a credential back, it does not
  // travel onward into a UI or a log.
  return String(text ?? '').replace(/[A-Za-z0-9_~.-]{24,}/g, '<redacted>');
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 400) }; }
}

/**
 * Acquire an access token via client credentials.
 * Cached until 60s before expiry.
 */
export async function getAccessToken(config, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const key = tokenKey(config);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: `${ARM_HOST}/.default`,
  });

  let response;
  try {
    response = await fetchImpl(`${LOGIN_HOST}/${encodeURIComponent(config.tenant_id)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new AzureError(`Could not reach Entra ID: ${redact(cause.message)}`, { retryable: true });
  }

  const payload = await readJson(response);
  if (!response.ok) {
    // AADSTS7000215 = bad secret, AADSTS700016 = unknown app, and so on. The
    // description is Microsoft's own and is safe to surface; it is what tells a
    // user whether to fix the secret or the app registration.
    const detail = redact(payload.error_description || payload.error || response.statusText);
    throw new AzureError(`Azure sign-in failed (${response.status}): ${detail}`, {
      status: response.status,
      code: payload.error || '',
      retryable: response.status >= 500,
    });
  }
  if (!payload.access_token) {
    throw new AzureError('Azure sign-in returned no access token', { status: response.status });
  }

  const expiresIn = Number(payload.expires_in) || 3600;
  tokenCache.set(key, { token: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  return payload.access_token;
}

/** Clears cached tokens. Used by tests and after a credential change. */
export function clearTokenCache() {
  tokenCache.clear();
}

async function armRequest(config, { method, path, body, deps = {}, attempt = 0 }) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const token = await getAccessToken(config, deps);

  let response;
  try {
    response = await fetchImpl(`${ARM_HOST}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    throw new AzureError(`Could not reach Azure: ${redact(cause.message)}`, { retryable: true });
  }

  // Cost Management is aggressively throttled. Honour Retry-After rather than
  // hammering it, and give up after two waits so a tool call cannot hang.
  if (response.status === 429 && attempt < 2) {
    const wait = Math.min(30, Number(response.headers.get('retry-after')) || 5);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return armRequest(config, { method, path, body, deps, attempt: attempt + 1 });
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const error = payload.error || {};
    const message = redact(error.message || payload.raw || response.statusText);
    const code = error.code || '';
    if (response.status === 401 || response.status === 403) {
      throw new AzureError(
        `Azure denied the request (${response.status}). The service principal needs the ` +
          `Cost Management Reader role on this subscription. ${message}`,
        { status: response.status, code },
      );
    }
    if (response.status === 404) {
      throw new AzureError(`Azure resource not found (404): ${message}`, { status: 404, code });
    }
    throw new AzureError(`Azure request failed (${response.status}): ${message}`, {
      status: response.status,
      code,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return payload;
}

/**
 * Map a Cost Management response to `{ columns, rows, get(row, name) }`.
 *
 * Column ORDER IS NOT GUARANTEED — the documented example returns cost first,
 * then the grouping dimension, then currency. Indexing by position is a bug
 * waiting for Microsoft to reorder a response, so everything here goes by name.
 */
export function indexResult(properties) {
  const columns = Array.isArray(properties?.columns) ? properties.columns : [];
  const rows = Array.isArray(properties?.rows) ? properties.rows : [];
  const byName = new Map(columns.map((column, index) => [column.name, index]));
  return {
    columns,
    rows,
    has: (name) => byName.has(name),
    get(row, name, fallback = null) {
      const index = byName.get(name);
      return index === undefined ? fallback : row[index];
    },
    /** First column whose name matches one of `names`. */
    pick(row, names, fallback = null) {
      for (const name of names) {
        const index = byName.get(name);
        if (index !== undefined) return row[index];
      }
      return fallback;
    },
  };
}

/** `Cost` on MCA and pay-as-you-go; `PreTaxCost` on Enterprise Agreements. */
const COST_MEASURES = ['Cost', 'PreTaxCost'];

/**
 * Run a Cost Management query over the configured subscription, following
 * `nextLink` pages.
 *
 * `measure` is retried across the two spellings because which one a
 * subscription accepts depends on its billing agreement, and there is no way to
 * know from the credentials alone.
 */
export async function queryCost(config, { timeframe, timePeriod, granularity = 'None', grouping = [], filter, deps = {} }) {
  const scope = `subscriptions/${encodeURIComponent(config.subscription_id)}`;
  const path = `/${scope}/providers/Microsoft.CostManagement/query?api-version=${COST_API_VERSION}`;

  let lastError;
  for (const measure of COST_MEASURES) {
    const body = {
      type: 'ActualCost',
      timeframe,
      ...(timePeriod ? { timePeriod } : {}),
      dataset: {
        granularity,
        aggregation: { totalCost: { name: measure, function: 'Sum' } },
        ...(grouping.length ? { grouping } : {}),
        ...(filter ? { filter } : {}),
      },
    };

    try {
      const first = await armRequest(config, { method: 'POST', path, body, deps });
      const properties = first.properties ?? {};
      const rows = [...(properties.rows ?? [])];

      // Follow pagination. Bounded: a runaway nextLink must not loop forever.
      let next = properties.nextLink;
      for (let page = 0; next && page < 20; page++) {
        const url = new URL(next);
        const paged = await armRequest(config, {
          method: 'POST',
          path: `${url.pathname}${url.search}`,
          body,
          deps,
        });
        rows.push(...(paged.properties?.rows ?? []));
        next = paged.properties?.nextLink;
      }

      const indexed = indexResult(properties);
      // The billing currency comes from Azure, never from plugin config. A
      // subscription billed in INR must not be labelled USD because a settings
      // field says so: selecting a currency label is not a conversion, and
      // mislabelling is an ~85x error rather than a cosmetic one.
      let currency = null;
      for (const row of rows) {
        const value = indexed.get(row, 'Currency');
        if (value) { currency = String(value); break; }
      }
      return { ...indexed, rows, measure, currency, truncated: Boolean(next) };
    } catch (error) {
      lastError = error;
      // Only a rejected measure name is worth retrying with the other spelling.
      const badMeasure =
        error instanceof AzureError &&
        error.status === 400 &&
        /PreTaxCost|Cost|aggregation|measure/i.test(error.message);
      if (!badMeasure) throw error;
    }
  }
  throw lastError;
}

/** Subscriptions the service principal can see. */
export async function listSubscriptions(config, deps = {}) {
  const payload = await armRequest(config, {
    method: 'GET',
    path: `/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`,
    deps,
  });
  return (payload.value ?? []).map((item) => ({
    subscription_id: item.subscriptionId,
    name: item.displayName,
    state: item.state,
  }));
}

/** Consumption budgets defined on the subscription. */
export async function listBudgets(config, deps = {}) {
  const payload = await armRequest(config, {
    method: 'GET',
    path: `/subscriptions/${encodeURIComponent(config.subscription_id)}` +
      `/providers/Microsoft.Consumption/budgets?api-version=${BUDGETS_API_VERSION}`,
    deps,
  });
  return (payload.value ?? []).map((item) => ({
    name: item.name,
    amount: Number(item.properties?.amount ?? 0),
    current_spend: Number(item.properties?.currentSpend?.amount ?? 0),
    currency: item.properties?.currentSpend?.unit || item.properties?.forecastSpend?.unit || null,
    time_grain: item.properties?.timeGrain || null,
  }));
}

/** Inclusive ISO date window ending today, in UTC. */
export function lastNDays(days) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: `${iso(from)}T00:00:00+00:00`, to: `${iso(to)}T23:59:59+00:00` };
}

/** Azure returns daily buckets as 20260918 or an ISO timestamp. */
export function normalizeDate(value) {
  const text = String(value ?? '');
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text.slice(0, 10);
}
