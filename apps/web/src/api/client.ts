import {
  API_PREFIX,
  type ApiErrorBody,
  type ChangeResult,
  type ChangeSet,
  COLLECTION_NAMES,
  type CollectionName,
  type HealthResponse,
  type LatLng,
  type NetworkResponse,
  type ParsedBackup,
  type RouteRequest,
  type RouteResponse,
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

  constructor(status: number, code: string, message: string, issues: ApiErrorBody['issues'] = [], conflicts: VersionConflict[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.conflicts = conflicts;
  }

  get isVersionConflict(): boolean {
    return this.status === 409 && this.code === 'version_conflict';
  }

  /** The request itself was refused, so sending it again unchanged will fail again. */
  get isRejection(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
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
}

export interface ApiClient {
  health(options?: RequestOptions): Promise<HealthResponse>;
  getNetwork(options?: RequestOptions): Promise<NetworkResponse>;
  applyChanges(changes: ChangeSet, options?: RequestOptions): Promise<ChangeResult>;
  restore(backup: ParsedBackup, options?: RequestOptions): Promise<RestoreResult>;
  reset(options?: RequestOptions): Promise<{ revision: number }>;
  route(request: RouteRequest, options?: RequestOptions): Promise<RouteResponse>;
}

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

export function createApiClient({
  baseUrl = '',
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions = {}): ApiClient {
  const root = `${baseUrl.replace(/\/+$/, '')}${API_PREFIX}`;

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, options: RequestOptions = {}) {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? timeoutMs);
    const headers: Record<string, string> = { accept: 'application/json' };
    // Fastify rejects an empty body declared as JSON, so body-less POSTs carry no content type.
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
        keepalive: options.keepalive,
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
        throw new ApiError(response.status, payload.error, payload.message, payload.issues, Array.isArray(payload.conflicts) ? payload.conflicts : []);
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
    applyChanges: (changes, options) => request<ChangeResult>('POST', '/changes', changes, options),
    restore: (backup, options) =>
      request<RestoreResult>(
        'POST',
        '/restore',
        { data: backup.collections, projectStartPoint: backup.projectStartPoint },
        options,
      ),
    reset: (options) => request<{ revision: number }>('POST', '/reset', undefined, options),
    route: (routeRequest, options) => request<RouteResponse>('POST', '/routing/route', routeRequest, options),
  };
}

/** Same-origin by default; set `VITE_API_URL` to talk to an API hosted elsewhere. */
export const apiClient = createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' });
