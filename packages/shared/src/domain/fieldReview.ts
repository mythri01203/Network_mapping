import type { Equipment } from '../model/types';
import { type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { assetGroupOf, DEFAULT_FIELD_SETTINGS, type FieldCaptureSettings, findNearbySameType, normalizeTag } from './fieldCapture';
import { hasPlacedPosition } from './outsidePlant';

/**
 * Phase 19: the office review queue for phone captures. A pole, box or drop captured on the phone
 * goes in as `reviewStatus: 'awaiting_review'` with status Planned, and waits here. The office
 * accepts it (it becomes a normal record, status Active as before Phase 19) or rejects it with a
 * reason (it stays on record, kept out of the working network and off the map). Nothing is decided
 * for the office: "same one?" hints are only listed.
 *
 * Danger reports and light readings are not held back: a danger report must reach the office at
 * once, and a light reading is already labelled "measured on site" with its meter photo.
 */

type Reviewable = Pick<Equipment, 'reviewStatus'>;

export const isAwaitingReview = (e: Reviewable): boolean => e.reviewStatus === 'awaiting_review';
export const isRejectedCapture = (e: Reviewable): boolean => e.reviewStatus === 'rejected';
/** Part of the working network: never reviewed (older records, office records) or accepted. */
export const isInProduction = (e: Reviewable): boolean => e.reviewStatus === undefined || e.reviewStatus === 'accepted';

/** The fields only the office's review may set. */
export const FIELD_REVIEW_KEYS = ['reviewStatus', 'reviewedAt', 'reviewedBy', 'reviewReason'] as const;

export interface SameOneHint {
  equipment: Equipment;
  /** `near`: within the "same one?" radius of this capture. `tag`: the same tag code. */
  why: 'near' | 'tag';
  distanceMeters?: number;
}

export interface ReviewItem {
  equipment: Equipment;
  photoId?: string;
  /** Who captured it, as the phone wrote it. */
  capturedBy?: string;
  capturedAt?: string;
  accuracyMeters?: number;
  /** No GPS fix: the point is a placeholder until the office places it. */
  unplaced: boolean;
  hints: SameOneHint[];
}

/**
 * Captures waiting for the office, oldest first, each with the "same one?" hints the office should
 * look at: same-kind items near it (the phone's own rule and settings) and items with its tag.
 */
export function fieldReviewQueue(data: Pick<NetworkData, 'equipment'>, settings: FieldCaptureSettings = DEFAULT_FIELD_SETTINGS): ReviewItem[] {
  const others = data.equipment.filter((e) => !isRejectedCapture(e));
  return data.equipment
    .filter(isAwaitingReview)
    .map((e) => {
      const unplaced = !hasPlacedPosition(e);
      const group = assetGroupOf(e.type);
      const hints: SameOneHint[] = [];
      if (group && !unplaced) {
        const near = findNearbySameType(
          others.filter((o) => o.id !== e.id),
          group,
          [e.lat, e.lng],
          e.locationAccuracyMeters ?? 0,
          settings.duplicate,
          5,
        );
        for (const n of near) hints.push({ equipment: n.equipment, why: 'near', distanceMeters: n.distanceMeters });
      }
      if (e.tagCode) {
        const tag = normalizeTag(e.tagCode);
        for (const o of others) {
          if (o.id !== e.id && o.tagCode && normalizeTag(o.tagCode) === tag && !hints.some((h) => h.equipment.id === o.id && h.why === 'tag')) {
            hints.push({ equipment: o, why: 'tag' });
          }
        }
      }
      return {
        equipment: e,
        photoId: e.photoIds?.[0],
        capturedBy: e.images?.[0]?.uploadedBy,
        capturedAt: e.locationCapturedAt ?? e.images?.[0]?.uploadDate,
        accuracyMeters: e.locationAccuracyMeters,
        unplaced,
        hints,
      };
    })
    .sort((a, b) => (a.capturedAt ?? '').localeCompare(b.capturedAt ?? ''));
}

export interface ReviewDecisionInput {
  /** Who decides, as shown in the app. The server records the real account too. */
  by: string;
  now?: Date;
  /** Accept: why it is accepted without a placed position. Reject: why it is rejected. */
  reason?: string;
}

const MIN_REASON = 3;

const replaceEquipment = (data: Pick<NetworkData, 'equipment'>, updated: Equipment) => data.equipment.map((e) => (e.id === updated.id ? updated : e));

const findCapture = (data: Pick<NetworkData, 'equipment'>, id: string) => data.equipment.find((e) => e.id === id);

/**
 * Accepts a capture: it becomes a normal record, status Active ("seen standing there", as before
 * Phase 19). One with no placed position is a warning: place it first, or accept with a reason,
 * which is kept on the record and in the audit trail.
 */
export function acceptFieldCapture(data: NetworkData, id: string, input: ReviewDecisionInput): CommandResult<{ accepted: true }> {
  const record = findCapture(data, id);
  if (!record) return fail('Not found', `${id} was not found.`);
  if (!isAwaitingReview(record)) {
    return fail('Already decided', `${record.name} is not waiting for review${record.reviewStatus ? ` (${record.reviewStatus.replace('_', ' ')})` : ''}. Nothing was changed.`, 'info');
  }
  const reason = input.reason?.trim();
  const unplaced = !hasPlacedPosition(record);
  if (unplaced && (!reason || reason.length < MIN_REASON)) {
    return fail(
      'Place it first',
      `${record.name} has no confirmed position. Show it on the map and use Move this item, or accept it anyway with a reason.`,
      'warning',
    );
  }
  const now = input.now ?? new Date();
  const updated: Equipment = {
    ...record,
    reviewStatus: 'accepted',
    reviewedAt: now.toISOString(),
    reviewedBy: input.by,
    status: record.status === 'Planned' ? 'Active' : record.status,
  };
  if (unplaced && reason) updated.reviewReason = reason;
  else delete updated.reviewReason;
  return succeed(
    { accepted: true },
    { equipment: replaceEquipment(data, updated) },
    {
      notice: notice('success', 'Accepted', `${record.name} is now part of the network.`),
      audit: [
        {
          action: 'FIELD_CAPTURE_ACCEPTED',
          details: `Field capture ${record.name} (${record.id}, ${record.type}) accepted by ${input.by}${unplaced ? `, without a placed position: ${reason}` : ''}`,
          assetId: record.id,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

/** Rejects a capture with a reason. It stays on record (never deleted) and out of the working network. */
export function rejectFieldCapture(data: NetworkData, id: string, input: ReviewDecisionInput): CommandResult<{ rejected: true }> {
  const record = findCapture(data, id);
  if (!record) return fail('Not found', `${id} was not found.`);
  if (!isAwaitingReview(record)) return fail('Already decided', `${record.name} is not waiting for review. Nothing was changed.`, 'info');
  const reason = input.reason?.trim() ?? '';
  if (reason.length < MIN_REASON) return fail('Say why', 'Write why it is rejected, so the field team can learn from it.', 'warning');
  const now = input.now ?? new Date();
  const updated: Equipment = { ...record, reviewStatus: 'rejected', reviewedAt: now.toISOString(), reviewedBy: input.by, reviewReason: reason };
  return succeed(
    { rejected: true },
    { equipment: replaceEquipment(data, updated) },
    {
      notice: notice('info', 'Rejected', `${record.name} is kept out of the network. It stays on record with your reason.`),
      audit: [
        {
          action: 'FIELD_CAPTURE_REJECTED',
          details: `Field capture ${record.name} (${record.id}, ${record.type}) rejected by ${input.by}: ${reason}`,
          assetId: record.id,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

/** Puts a rejected capture back in the queue, for a rejection made by mistake. The audit trail keeps the earlier decision. */
export function reopenFieldCapture(data: NetworkData, id: string, input: Pick<ReviewDecisionInput, 'by'>): CommandResult<{ reopened: true }> {
  const record = findCapture(data, id);
  if (!record) return fail('Not found', `${id} was not found.`);
  if (!isRejectedCapture(record)) return fail('Not rejected', `${record.name} was not rejected. Nothing was changed.`, 'info');
  const { reviewedAt: _at, reviewedBy: _by, reviewReason: _reason, ...rest } = record;
  const updated: Equipment = { ...rest, reviewStatus: 'awaiting_review' };
  return succeed(
    { reopened: true },
    { equipment: replaceEquipment(data, updated) },
    {
      notice: notice('info', 'Back in the queue', `${record.name} waits for review again.`),
      audit: [
        {
          action: 'FIELD_CAPTURE_REOPENED',
          details: `Field capture ${record.name} (${record.id}) put back in the review queue by ${input.by}; it was rejected ${record.reviewedAt ?? ''} by ${record.reviewedBy ?? 'someone'}: ${record.reviewReason ?? 'no reason recorded'}`,
          assetId: record.id,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

/** Rejected captures, newest decision first, for the "Rejected" list. */
export const rejectedCaptures = (data: Pick<NetworkData, 'equipment'>): Equipment[] =>
  data.equipment.filter(isRejectedCapture).sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''));

/** True when a change touches the review fields. */
export function reviewFieldsChanged(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): boolean {
  return FIELD_REVIEW_KEYS.some((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}
