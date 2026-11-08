import type { VersionConflict } from '@fibergis/shared';

/** An error that maps directly onto an HTTP response. `code` is a stable, machine-readable identifier. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** Extra fields for the response body, such as the records of a version conflict. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message: string) => new HttpError(404, 'not_found', message);
export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
/** A record would point to something that does not exist. Sending it again unchanged fails again. */
export const linkError = (message: string) => new HttpError(409, 'link_error', message);

/**
 * Someone else changed a record since this client read it. Nothing was written; the body carries
 * each current record so the client can keep both versions and let a person choose.
 */
export const versionConflict = (conflicts: VersionConflict[]) =>
  new HttpError(
    409,
    'version_conflict',
    conflicts.length === 1
      ? `Someone else changed ${conflicts[0].collection}/${conflicts[0].id} since this device read it. Nothing was saved.`
      : `Someone else changed ${conflicts.length} records since this device read them. Nothing was saved.`,
    { conflicts },
  );
