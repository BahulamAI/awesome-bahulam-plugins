/**
 * Shared helpers for Azure DevOps tools.
 *
 * All tools read the organization, project and PAT from plugin config via
 * `state.getConfig()`. The LLM never sees these values — they stay in the
 * local SQLite state and are injected by the tool handler at runtime.
 */

const API_VERSION = '7.1';

/**
 * Read Azure DevOps credentials/config from plugin config.
 * Returns `{ ready: false, missing: [...], error: "..." }` when any required
 * field is absent, or `{ ready: true, organization, project, pat }`.
 *
 * @param {object} state — the plugin state proxy (injected by executor)
 */
export function getAdoConfig(state, connection) {
  const read = key => connection ? connection.config?.[key] : state?.getConfig(key);
  const organization = read('organization');
  const project = read('project');
  const pat = connection ? null : read('personal_access_token');

  const missing = [];
  if (!organization) missing.push('organization');
  if (!pat && typeof connection?.request !== 'function') missing.push('personal_access_token');

  if (missing.length) {
    return {
      ready: false,
      missing,
      error: `Azure DevOps is not configured. Missing: ${missing.join(', ')}. Open plugin Settings to configure.`,
    };
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(organization)) {
    return { ready: false, error: 'organization must be an ADO organization name, not a URL.' };
  }
  return { ready: true, organization, project: project || null, pat,
    team: read('team'), lockedProject: read('locked_project'),
    lockedTeam: read('locked_team'), connection };
}

/**
 * Resolve the project to act against: an explicit argument wins, otherwise
 * the plugin's configured default project. Fails loudly rather than guessing
 * — an action against the wrong project is worse than an error.
 */
export function resolveProject(config, argProject) {
  const project = argProject || config.project;
  if (config.lockedProject && project !== config.lockedProject) {
    return { ok: false, error: 'This connection is restricted to its mapped ADO project.' };
  }
  if (!project) {
    return { ok: false, error: 'No project given and no default project configured in plugin Settings.' };
  }
  return { ok: true, project };
}

function authHeader(pat) {
  // ADO Basic auth: empty username, PAT as password.
  const encoded = Buffer.from(`:${pat}`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Call the Azure DevOps REST API.
 *
 * @param {{organization: string, pat: string}} config
 * @param {{method?: string, path: string, body?: any, contentType?: string, apiVersion?: string, deps?: any}} opts
 *   `path` is relative to `https://dev.azure.com/{organization}/` and should
 *   already include any project segment, e.g. `myproj/_apis/wit/workitems/42`.
 */
export async function adoRequest(config, { method = 'GET', path, body, contentType = 'application/json', apiVersion = API_VERSION, deps = {} } = {}) {
  if (config.connection) {
    return config.connection.request({ method, path, body, contentType, apiVersion, signal: deps.signal });
  }
  const fetchImpl = deps.fetch || globalThis.fetch;
  const separator = path.includes('?') ? '&' : '?';
  const url = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${path}${separator}api-version=${apiVersion}`;

  const response = await fetchImpl(url, {
    method,
    redirect: 'error',
    signal: deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    headers: {
      Authorization: authHeader(config.pat),
      ...(body !== undefined ? { 'Content-Type': contentType } : {}),
      Accept: 'application/json',
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    const message = (data && typeof data === 'object' && (data.message || data.value?.Message))
      || (typeof data === 'string' ? data : null)
      || `${response.status} ${response.statusText}`;
    const safeMessage = String(message).split(config.pat).join('[redacted]')
      .split(authHeader(config.pat)).join('[redacted]');
    const error = new Error(safeMessage);
    error.status = response.status;
    throw error;
  }

  const continuation = response.headers?.get('x-ms-continuationtoken');
  if (continuation && data && typeof data === 'object') data.continuation_token = continuation;
  return data;
}

/** Build the human-facing URL for a work item, for linking rather than re-rendering it. */
export function workItemUrl(config, project, id) {
  return `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
}

export function resolveTeam(config, argTeam) {
  const team = argTeam || config.team;
  if (!team) return { ok: false, error: 'An ADO team is required. Configure team or supply it explicitly.' };
  if (config.lockedTeam && team !== config.lockedTeam) {
    return { ok: false, error: 'This connection is restricted to its mapped ADO team.' };
  }
  return { ok: true, team };
}

export function positiveId(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export function summarizeItem(config, project, item) {
  const f = item.fields || {};
  return { id: item.id, type: f['System.WorkItemType'], title: f['System.Title'],
    state: f['System.State'], assigned_to: f['System.AssignedTo']?.displayName || null,
    area_path: f['System.AreaPath'], iteration_path: f['System.IterationPath'],
    url: workItemUrl(config, project, item.id) };
}

/**
 * Turn any thrown error into the `{ success: false, output }` envelope the
 * runtime expects. Never substitutes a plausible-looking result — a tool
 * that could not reach Azure DevOps must say so.
 */
export function toolFailure(error, context) {
  const message = error?.message ? String(error.message) : String(error);
  return { success: false, output: context ? `${context}: ${message}` : message };
}
