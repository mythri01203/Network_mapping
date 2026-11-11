import {
  type AccountRole,
  type AccountSummary,
  API_PREFIX,
  type ApiErrorBody,
  type AreaResponse,
  type AuthStatus,
  type ChangeResult,
  type ChangeSet,
  type ChangesResponse,
  COLLECTION_NAMES,
  type CollectionName,
  type HealthResponse,
  type LatLng,
  type NetworkResponse,
  type ParsedBackup,
  type RecordsResponse,
  type RouteRequest,
  type RouteResponse,
  SEARCH_MAX_LIMIT,
  type SearchHit,
  type VersionConflict,
} from '@fibergis/shared';

const DEFAULT_TIMEOUT_MS = 15_000;

/** The server answered with an error status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: NonNullable<ApiErrorBody['issues']>;
  /** With `version_conflict`: each record someone else changed, as the server now has it. */
  readonly conflicts: VersionConflict[];
  /** The whole answer, for errors that carry more (such as a refused restore's problem list). */
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, message: string, issues: ApiErrorBody['issues'] = [], conflicts: VersionConflict[] = [], body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.conflicts = conflicts;
    this.body = body;
  }

  /** Login is on and this device has no valid session (Phase 9). Nothing was refused: log in and send again. */
  get isLoginRequired(): boolean {
    return this.status === 401 && this.code === 'login_required';
  }

  /** Logged in with a temporary password: nothing was refused; choose a password and send again. */
  get isPasswordChangeRequired(): boolean {
    return this.status === 403 && this.code === 'password_change_required';
  }

  get isVersionConflict(): boolean {
    return this.status === 409 && this.code === 'version_conflict';
  }

  /** The request itself was refused, so sending it again unchanged will fail again. */
  get isRejection(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429 && !this.isLoginRequired && !this.isPasswordChangeRequired;
  }
}

/** The server could not be reached, timed out, or did not answer like the FiberGIS API. */
export class ApiUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiUnavailableError';
  }
}

/** True when retrying later may succeed (connectivity problems and server-side failures). */
export const isTransientError = (error: unknown): boolean =>
  error instanceof ApiUnavailableError || (error instanceof ApiError && !error.isRejection);

export const describeApiError = (error: unknown): string => {
  if (error instanceof ApiError) {
    const issue = error.issues[0];
    return issue ? `${error.message} (${issue.path || 'record'}: ${issue.message})` : error.message;
  }
  if (error instanceof ApiUnavailableError) return error.message;
  return 'Unexpected error while talking to the server.';
};

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Lets the request outlive the page (used to flush changes while the tab closes). */
  keepalive?: boolean;
}

export interface RestoreResult {
  revision: number;
  restored: CollectionName[];
  projectStartPoint?: LatLng;
  /** Phase 9: the safety copy the server saved first, and what happened to photos and problems. */
  safetyCopy?: string;
  photosAdded?: number;
  photosSkipped?: number;
  acceptedProblems?: number;
}

export interface RestoreOptions extends RequestOptions {
  /** Restore even though the checks found problems (administrator, after reading them). */
  acceptProblems?: boolean;
}

export interface CreatedAccount {
  user: AccountSummary;
  /** Shown once, when the server made the password. */
  temporaryPassword?: string;
}

export interface DataQualitySummary {
  revision: number;
  checkedAt: string;
  rules: { rule: string; severity: 'error' | 'warning' | 'note'; count: number; exampleIds: string[] }[];
}

export interface ApiClient {
  health(options?: RequestOptions): Promise<HealthResponse>;
  getNetwork(options?: RequestOptions): Promise<NetworkResponse>;
  /** Phase 24: what changed on the server after a revision. Optional: without it the engine loads the whole network. */
  getChanges?(since: number, options?: RequestOptions): Promise<ChangesResponse>;
  /** Phase 24b: every collection but these, in full (`GET /network?except=`). For loading big networks by map area. */
  getNetworkExcept?(except: readonly CollectionName[], options?: RequestOptions): Promise<RecordsResponse>;
  /** Phase 24b: the records touching a box (south, west, north, east) in these collections (`GET /network/area`). */
  getArea?(bbox: readonly [number, number, number, number], collections: readonly CollectionName[], options?: RequestOptions): Promise<AreaResponse>;
  /** Phase 24b: records by id in these collections, at most 1000 ids (`GET /network/records`). */
  getRecords?(ids: readonly string[], collections: readonly CollectionName[], options?: RequestOptions): Promise<RecordsResponse>;
  /** Phase 24b: the server's search over the whole network (`GET /search`), for a device loaded by map area. */
  search?(query: string, options?: RequestOptions): Promise<{ total: number; hits: SearchHit[] }>;
  applyChanges(changes: ChangeSet, options?: RequestOptions): Promise<ChangeResult>;
  restore(backup: ParsedBackup, options?: RestoreOptions): Promise<RestoreResult>;
  /** A `.zip` backup with photos, sent as it is. */
  restoreZip?(zip: Blob, options?: RestoreOptions): Promise<RestoreResult>;
  reset(options?: RequestOptions): Promise<{ revision: number; safetyCopy?: string }>;
  route(request: RouteRequest, options?: RequestOptions): Promise<RouteResponse>;
}

/** Login and accounts (Phase 9). Kept apart from `ApiClient` so tests of the sync engine need not fake them. */
export interface AuthClient {
  status(options?: RequestOptions): Promise<AuthStatus>;
  setup(input: { username: string; displayName: string; password: string; setupToken?: string }): Promise<AuthStatus>;
  login(input: { username: string; password: string }): Promise<AuthStatus>;
  logout(): Promise<AuthStatus>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<AuthStatus>;
  listUsers(): Promise<AccountSummary[]>;
  createUser(input: { username: string; displayName: string; role: AccountRole; password?: string }): Promise<CreatedAccount>;
  updateUser(id: string, input: { displayName?: string; role?: AccountRole; active?: boolean }): Promise<AccountSummary>;
  setUserPassword(id: string, password?: string): Promise<CreatedAccount>;
  dataQuality(): Promise<DataQualitySummary>;
  /** Network mapping Phase 15: run the map check on the server and store what it finds. */
  runValidation?(): Promise<ValidationRunResult>;
}

export interface ValidationRunResult {
  revision: number;
  checkedAt: string;
  written: number;
  summary: { found: number; opened: number; foundAgain: number; reopened: number; noLongerFound: number; unchanged: number };
  counts: { open: number; acknowledged: number; resolved: number; noLongerFound: number; errors: number };
}

export type RawRequest = <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, options?: RequestOptions) => Promise<T>;

export interface ApiClientOptions {
  /** Origin of the API server; empty means same origin (served by the API or proxied by Vite). */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  isRecord(value) && typeof value.error === 'string' && typeof value.message === 'string';

const isNetworkResponse = (value: unknown): value is NetworkResponse =>
  isRecord(value) &&
  typeof value.revision === 'number' &&
  isRecord(value.data) &&
  COLLECTION_NAMES.every((name) => Array.isArray((value.data as Record<string, unknown>)[name]));

/** Phase 24b: `data` holds only known collections, each an array of records; versions per collection. */
const isPartialResponse = (value: unknown): value is RecordsResponse =>
  isRecord(value) &&
  typeof value.revision === 'number' &&
  isRecord(value.data) &&
  Object.entries(value.data).every(([name, list]) => COLLECTION_NAMES.includes(name as CollectionName) && Array.isArray(list) && list.every((r) => isRecord(r) && typeof r.id === 'string')) &&
  isRecord(value.versions);

const isChangesResponse = (value: unknown): value is ChangesResponse => {
  if (!isRecord(value) || typeof value.revision !== 'number' || typeof value.since !== 'number') return false;
  if (value.reload === true) return true;
  const lists = (map: unknown, item: (v: unknown) => boolean) =>
    isRecord(map) && Object.entries(map).every(([name, list]) => COLLECTION_NAMES.includes(name as CollectionName) && Array.isArray(list) && list.every(item));
  return (
    lists(value.upserts, (r) => isRecord(r) && typeof r.id === 'string') &&
    lists(value.deletes, (id) => typeof id === 'string') &&
    isRecord(value.versions)
  );
};

export function createApiClient({
  baseUrl = '',
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions = {}): ApiClient {
  const root = `${baseUrl.replace(/\/+$/, '')}${API_PREFIX}`;

  // The session cookie goes with every request: same-origin by default, or to the configured API.
  const credentials: RequestCredentials = baseUrl ? 'include' : 'same-origin';

  async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, options: RequestOptions = {}) {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? timeoutMs);
    const headers: Record<string, string> = { accept: 'application/json' };
    const raw = typeof Blob !== 'undefined' && body instanceof Blob;
    // Fastify rejects an empty body declared as JSON, so body-less POSTs carry no content type.
    if (body !== undefined) headers['content-type'] = raw ? 'application/zip' : 'application/json';

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body),
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
        keepalive: options.keepalive,
        credentials,
      });
      text = await response.text();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new ApiUnavailableError(
        timedOut ? 'The FiberGIS server did not respond in time.' : 'The FiberGIS server could not be reached.',
        { cause: error },
      );
    }

    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      // An HTML page (static host fallback, proxy error page) means the API is not behind this URL.
      throw new ApiUnavailableError('The FiberGIS server returned an unexpected response.');
    }

    if (!response.ok) {
      if (isErrorBody(payload)) {
        throw new ApiError(
          response.status,
          payload.error,
          payload.message,
          payload.issues,
          Array.isArray(payload.conflicts) ? payload.conflicts : [],
          payload as unknown as Record<string, unknown>,
        );
      }
      throw new ApiError(response.status, 'http_error', `The server responded with HTTP ${response.status}.`);
    }
    return payload as T;
  }

  return {
    health: (options) => request<HealthResponse>('GET', '/health', undefined, options),
    getNetwork: async (options) => {
      const payload = await request<unknown>('GET', '/network', undefined, options);
      if (!isNetworkResponse(payload)) throw new ApiUnavailableError('The server sent malformed network data.');
      return payload;
    },
    getChanges: async (since, options) => {
      const payload = await request<unknown>('GET', `/changes?since=${encodeURIComponent(String(since))}`, undefined, options);
      if (!isChangesResponse(payload)) throw new ApiUnavailableError('The server sent malformed change data.');
      return payload;
    },
    getNetworkExcept: async (except, options) => {
      const payload = await request<unknown>('GET', `/network?except=${encodeURIComponent(except.join(','))}`, undefined, options);
      if (!isPartialResponse(payload)) throw new ApiUnavailableError('The server sent malformed network data.');
      return payload;
    },
    getArea: async (bbox, collections, options) => {
      // Rounded outwards, so the box asked for always covers the box meant.
      const [s, w, n, e] = bbox;
      const edges = [Math.floor(s * 1e6) / 1e6, Math.floor(w * 1e6) / 1e6, Math.ceil(n * 1e6) / 1e6, Math.ceil(e * 1e6) / 1e6];
      const query = `bbox=${edges.join(',')}&collections=${encodeURIComponent(collections.join(','))}`;
      const payload = await request<unknown>('GET', `/network/area?${query}`, undefined, options);
      if (!isPartialResponse(payload) || typeof (payload as unknown as AreaResponse).truncated !== 'boolean') throw new ApiUnavailableError('The server sent malformed map-area data.');
      return payload as unknown as AreaResponse;
    },
    getRecords: async (ids, collections, options) => {
      const query = `ids=${encodeURIComponent(ids.join(','))}&collections=${encodeURIComponent(collections.join(','))}`;
      const payload = await request<unknown>('GET', `/network/records?${query}`, undefined, options);
      if (!isPartialResponse(payload)) throw new ApiUnavailableError('The server sent malformed record data.');
      return payload;
    },
    search: async (query, options) => {
      const payload = await request<unknown>('GET', `/search?q=${encodeURIComponent(query.slice(0, 200))}&limit=${SEARCH_MAX_LIMIT}`, undefined, options);
      const body = payload as { total?: unknown; hits?: unknown };
      if (!isRecord(payload) || typeof body.total !== 'number' || !Array.isArray(body.hits)) throw new ApiUnavailableError('The server sent malformed search results.');
      return payload as unknown as { total: number; hits: SearchHit[] };
    },
    applyChanges: (changes, options) => request<ChangeResult>('POST', '/changes', changes, options),
    restore: (backup, options) =>
      request<RestoreResult>(
        'POST',
        `/restore${options?.acceptProblems ? '?accept=problems' : ''}`,
        { data: backup.collections, projectStartPoint: backup.projectStartPoint },
        { timeoutMs: 120_000, ...options },
      ),
    restoreZip: (zip, options) =>
      request<RestoreResult>('POST', `/restore${options?.acceptProblems ? '?accept=problems' : ''}`, zip, { timeoutMs: 300_000, ...options }),
    // The server asks for this word once login is on, so a stray request cannot wipe the network.
    reset: (options) => request<{ revision: number; safetyCopy?: string }>('POST', '/reset', { confirm: 'reset' }, { timeoutMs: 120_000, ...options }),
    route: (routeRequest, options) => request<RouteResponse>('POST', '/routing/route', routeRequest, options),
    raw: request,
  } as ApiClient & { raw: RawRequest };
}

/** Login and account requests, with the same error handling as the network API. */
export function createAuthClient(options: ApiClientOptions = {}): AuthClient {
  const call = (createApiClient(options) as ApiClient & { raw: RawRequest }).raw;
  return {
    status: (o) => call<AuthStatus>('GET', '/auth/status', undefined, o),
    setup: (input) => call<AuthStatus>('POST', '/auth/setup', input),
    login: (input) => call<AuthStatus>('POST', '/auth/login', input),
    logout: () => call<AuthStatus>('POST', '/auth/logout', {}),
    changePassword: (input) => call<AuthStatus>('POST', '/auth/password', input),
    listUsers: () => call<AccountSummary[]>('GET', '/users'),
    createUser: (input) => call<CreatedAccount>('POST', '/users', input),
    updateUser: (id, input) => call<AccountSummary>('PATCH', `/users/${encodeURIComponent(id)}`, input),
    setUserPassword: (id, password) => call<CreatedAccount>('POST', `/users/${encodeURIComponent(id)}/password`, password ? { password } : {}),
    dataQuality: () => call<DataQualitySummary>('GET', '/reports/data-quality', undefined, { timeoutMs: 60_000 }),
    runValidation: () => call<ValidationRunResult>('POST', '/reports/validation-run', undefined, { timeoutMs: 120_000 }),
  };
}

/** Same-origin by default; set `VITE_API_URL` to talk to an API hosted elsewhere. */
export const apiClient = createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' });
export const authClient = createAuthClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' });
