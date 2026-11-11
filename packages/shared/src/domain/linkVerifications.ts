import type { ChangeSet } from '../model/api';
import { LINK_CHECK_METHOD_LABELS, LINK_CHECK_RESULT_LABELS, type LinkCheckMethod, type LinkCheckResult, type LinkVerification } from '../model/linkVerificationSchemas';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { buildConnectionIndex, checkHasEvidence, type Connection, connectionKindOfId, describeConnection } from './connectionIndex';
import { PHOTO_ID_PATTERN, randomCode } from './fieldCapture';

/**
 * Network mapping Phase 13: checks of physical links (`linkVerifications`). A check names one link
 * by its connection index id and keeps what the link joined at that moment, so it stays readable
 * if the link is later changed or taken out. Broken data is refused (a check with no day, a light
 * meter check with no reading, a photo that is not a saved photo, an id that names no kind of link).
 * Everything else is a warning the person may save anyway, which is written to the audit trail. A
 * check naming a link that no longer exists is kept and shown as such: it never blocks other work.
 */

const checksOf = (data: Partial<Pick<NetworkData, 'linkVerifications'>>) => data.linkVerifications ?? [];

export const newLinkCheckId = (): string => `LCK-${randomCode(10)}`;

export interface LinkCheckDraft {
  connectionId: string;
  method?: LinkCheckMethod;
  result?: LinkCheckResult;
  /** YYYY-MM-DD, as the person chose it. */
  checkedOn: string;
  technician: string;
  photoIds?: string[];
  otdrRef?: string;
  readingDbm?: number;
  wavelengthNm?: number;
  instrument?: string;
  notes?: string;
}

const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

type CheckFields = Pick<LinkVerification, 'connectionId' | 'checkedOn' | 'technician' | 'method' | 'photoIds' | 'readingDbm'> & { method?: LinkCheckMethod };

/**
 * Why this check is broken data, in plain words, or null. `now` is given for new checks only: a
 * day after tomorrow cannot have been checked yet (one day of grace for phones in another time zone).
 */
export function linkCheckError(check: Partial<CheckFields>, now?: Date): string | null {
  if (!check.connectionId?.trim() || !connectionKindOfId(check.connectionId.trim())) {
    return `"${check.connectionId ?? ''}" is not a link FiberGIS knows. Open the link and record the check from there.`;
  }
  if (!check.checkedOn || !/^\d{4}-\d{2}-\d{2}$/.test(check.checkedOn) || Number.isNaN(Date.parse(`${check.checkedOn}T00:00:00`))) return 'Choose the day of the check.';
  if (now && check.checkedOn > localDay(new Date(now.getTime() + 24 * 3600 * 1000))) return 'The day of the check is in the future. Choose the day it was done.';
  if (!check.technician?.trim()) return 'Write who did the check.';
  if (!check.method) return 'Choose how the link was checked.';
  if (check.method === 'power_reading' && (check.readingDbm === undefined || !Number.isFinite(check.readingDbm))) {
    return 'A light meter check needs the reading the meter showed.';
  }
  const bad = (check.photoIds ?? []).find((id) => !PHOTO_ID_PATTERN.test(id));
  if (bad) return `The photo "${bad}" is not a saved photo.`;
  if ((check.photoIds?.length ?? 0) > 20) return 'Keep it to 20 photos or fewer.';
  return null;
}

/** Things worth a second look before saving. Never a reason to refuse. */
export function linkCheckWarnings(draft: LinkCheckDraft, connection: Connection | undefined): string[] {
  const warnings: string[] = [];
  if (!connection) warnings.push('This link is not on record any more. The check will be kept, marked "link not on record".');
  if (!checkHasEvidence(draft)) warnings.push('There is no photo, OTDR reference or reading, so nobody can see what was checked.');
  if (draft.method === 'otdr' && !draft.otdrRef?.trim() && !(draft.photoIds?.length ?? 0)) warnings.push('An OTDR test usually has a file name or a photo of the trace.');
  return warnings;
}

/** Saves one check as the person recorded it. Warnings ask "Save anyway"; saving anyway is audited. */
export function createLinkCheck(data: NetworkData, draft: LinkCheckDraft, ctx: CommandContext = {}): CommandResult<LinkVerification> {
  const now = ctx.now ?? new Date();
  const connectionId = draft.connectionId.trim();
  const error = linkCheckError({ ...draft, connectionId }, now);
  if (error) return fail('Check not saved', error, 'warning');
  if (!draft.result) return fail('Check not saved', 'Choose what you found: good, bad or could not tell.', 'warning');
  const index = buildConnectionIndex(
    { equipment: data.equipment, cables: data.cables, splitters: data.splitters, closures: data.closures, customers: data.customers, onts: data.onts, rfElements: data.rfElements, rfLinks: data.rfLinks },
    ctx.schemes,
    // The label is stored and read by every role: customers by id only, never by name.
    { customerNames: false },
  );
  const connection = index.byId.get(connectionId);
  const text = (value: string | undefined) => value?.trim() || undefined;
  const photoIds = [...new Set(draft.photoIds ?? [])];
  const check: LinkVerification = {
    id: newLinkCheckId(),
    connectionId,
    connectionLabel: (connection ? describeConnection(connection) : 'Link not on record when checked').slice(0, 400),
    ...(connection ? { endsKey: connection.endsKey.slice(0, 600) } : {}),
    method: draft.method!,
    result: draft.result,
    checkedOn: draft.checkedOn,
    technician: draft.technician.trim(),
    ...(photoIds.length ? { photoIds } : {}),
    ...(text(draft.otdrRef) ? { otdrRef: text(draft.otdrRef) } : {}),
    ...(draft.readingDbm !== undefined ? { readingDbm: draft.readingDbm } : {}),
    ...(draft.wavelengthNm !== undefined ? { wavelengthNm: draft.wavelengthNm } : {}),
    ...(text(draft.instrument) ? { instrument: text(draft.instrument) } : {}),
    ...(text(draft.notes) ? { notes: text(draft.notes) } : {}),
    createdAt: now.toISOString(),
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
  };
  const warnings = linkCheckWarnings(draft, connection);
  const evidence = [
    photoIds.length ? `${photoIds.length} photo(s)` : '',
    check.otdrRef ? `OTDR ${check.otdrRef}` : '',
    check.readingDbm !== undefined ? `${check.readingDbm} dBm${check.wavelengthNm ? ` at ${check.wavelengthNm} nm` : ''} (measured)` : '',
  ].filter(Boolean);
  return succeed(
    check,
    { linkVerifications: [...checksOf(data), check] },
    {
      notice: notice('success', 'Check saved', `${LINK_CHECK_RESULT_LABELS[check.result]}, ${check.checkedOn}.`),
      audit: [
        {
          action: 'LINK_CHECK_RECORDED',
          details: `${check.connectionId} (${check.connectionLabel}) checked ${check.checkedOn} by ${check.technician}: ${LINK_CHECK_METHOD_LABELS[check.method]}, ${check.result}${evidence.length ? `, ${evidence.join(', ')}` : ', no evidence'}`.slice(0, 900),
          assetId: check.id,
          assetType: 'LinkCheck',
        },
        ...(warnings.length ? [{ action: 'WARNING_ACCEPTED', details: `Saved after the warning: ${warnings.join(' ')}`.slice(0, 900), assetId: check.id, assetType: 'LinkCheck' as const }] : []),
      ],
      ...(warnings.length ? { confirm: `Please check: ${warnings.join(' ')} Save anyway?` } : {}),
    },
  );
}

/** Removes one check, for a mistake. The caller must confirm. */
export function deleteLinkCheck(data: NetworkData, id: string): CommandResult<LinkVerification> {
  const check = checksOf(data).find((v) => v.id === id);
  if (!check) return fail('Not found', `Check ${id} was not found.`);
  return succeed(
    check,
    { linkVerifications: checksOf(data).filter((v) => v.id !== id) },
    {
      confirm: `Delete the check of ${check.checkedOn} by ${check.technician}? Only do this if it was entered by mistake. You can undo this.`,
      notice: notice('info', 'Check deleted', `${check.checkedOn}, ${check.technician}`),
      audit: [{ action: 'LINK_CHECK_DELETED', details: `Deleted check ${id} of ${check.connectionId}`, assetId: id, assetType: 'LinkCheck' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* Server and restore checks                                           */
/* ------------------------------------------------------------------ */

export const changeSetTouchesLinkVerifications = (changes: ChangeSet): boolean => (changes.upserts?.linkVerifications?.length ?? 0) > 0;

export interface LinkCheckProblem {
  id: string;
  message: string;
}

/**
 * The checks a change stores that are broken data. Needs nothing stored: a check naming a link that
 * is not on record is kept and flagged, never refused (it may have been recorded offline before the
 * link changed). The day is judged against `now` only for checks this change stores.
 */
export function checkChangeSetLinkVerifications(changes: ChangeSet, now: Date = new Date()): LinkCheckProblem[] {
  return (changes.upserts?.linkVerifications ?? []).flatMap((v) => {
    const message = linkCheckError(v, now);
    return message ? [{ id: v.id, message: `Check ${v.id}: ${message}` }] : [];
  });
}

/** Broken checks in a whole network (for a restore). The day is not judged against today here. */
export function findLinkVerificationErrors(data: Partial<Pick<NetworkData, 'linkVerifications'>>): LinkCheckProblem[] {
  return checksOf(data).flatMap((v) => {
    const message = linkCheckError(v);
    return message ? [{ id: v.id, message: `Check ${v.id}: ${message}` }] : [];
  });
}
