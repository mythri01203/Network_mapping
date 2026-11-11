import { describe, expect, it } from 'vitest';

import { type Account, checkChangeAccess, type StoredLookup } from '../src/domain/access';
import { applyPatch } from '../src/domain/command';
import { ruleSettingProblem } from '../src/domain/editableLists';
import {
  addCapturedEquipment,
  buildCapturedEquipment,
  type CaptureLocation,
  fieldFollowUps,
  findNearbySameType,
  removeCapturedRecord,
} from '../src/domain/fieldCapture';
import {
  acceptFieldCapture,
  fieldReviewQueue,
  isAwaitingReview,
  isInProduction,
  rejectedCaptures,
  rejectFieldCapture,
  reopenFieldCapture,
} from '../src/domain/fieldReview';
import {
  activeChecklist,
  BUILT_IN_CHECKLISTS,
  checklistAnswersFor,
  checklistSettingId,
  checklistSettingProblem,
  resolveChecklist,
} from '../src/domain/inspectionChecklist';
import { createInspection, inspectionProblem } from '../src/domain/ospInspections';
import type { CollectionName } from '../src/model/collections';
import { equipmentSchema, inspectionSchema } from '../src/model/schemas';
import type { Equipment } from '../src/model/types';
import { emptyNetwork, equipment, NOW } from './fixtures';

const here: CaptureLocation = { lat: 12.9352, lng: 77.6245, method: 'gps_averaged', accuracyMeters: 4, sampleCount: 5, capturedAt: NOW.toISOString(), officeMustPlace: false };
const noFix: CaptureLocation = { lat: 12.9352, lng: 77.6245, method: 'not_placed', officeMustPlace: true };

const capture = (id: string, location: CaptureLocation = here, tagCode?: string) =>
  buildCapturedEquipment({ kind: 'pole', id, name: `Pole-${id.slice(-2)}`, photoId: `PH-${id.slice(-10)}`, location, now: NOW, capturedBy: 'Ravi (phone capture)', ownerType: 'telecom', material: 'concrete', tagCode });

const networkWith = (...items: Equipment[]) => ({ ...emptyNetwork(), equipment: items });

describe('a capture stays out of production until accepted', () => {
  it('goes in as a proposal waiting for the office, not as Active', () => {
    const pole = capture('POLE-AAAAAAAA01');
    expect(pole.status).toBe('Planned');
    expect(pole.reviewStatus).toBe('awaiting_review');
    expect(isAwaitingReview(pole)).toBe(true);
    expect(isInProduction(pole)).toBe(false);
    // Stored as it is: the schema keeps the review fields.
    expect(equipmentSchema.parse(pole).reviewStatus).toBe('awaiting_review');
    const added = addCapturedEquipment(emptyNetwork(), pole, NOW);
    expect(added.ok && added.audit[0].details).toMatch(/waits for office review/);
  });

  it('is listed in the review queue with its photo, accuracy and "same one?" hints', () => {
    const older = { ...equipment({ id: 'POLE-OLD', type: 'Telecom Pole', lat: 12.93521, lng: 77.62451 }), tagCode: 'KRM-1' };
    const pole = capture('POLE-AAAAAAAA02', here, 'krm-1');
    const [item, ...rest] = fieldReviewQueue(networkWith(older, pole));
    expect(rest).toEqual([]);
    expect(item.equipment.id).toBe(pole.id);
    expect(item.photoId).toBe(pole.photoIds?.[0]);
    expect(item.accuracyMeters).toBe(4);
    expect(item.capturedBy).toBe('Ravi (phone capture)');
    expect(item.hints.map((h) => [h.equipment.id, h.why])).toEqual([
      ['POLE-OLD', 'near'],
      ['POLE-OLD', 'tag'],
    ]);
  });

  it('becomes a normal, Active record when accepted, with who and when', () => {
    const pole = capture('POLE-AAAAAAAA03');
    const data = networkWith(pole);
    const result = acceptFieldCapture(data, pole.id, { by: 'Office Asha', now: NOW });
    if (!result.ok) throw new Error(result.error.message);
    const after = applyPatch(data, result.patch).equipment[0];
    expect(after).toMatchObject({ reviewStatus: 'accepted', reviewedBy: 'Office Asha', reviewedAt: NOW.toISOString(), status: 'Active' });
    expect(isInProduction(after)).toBe(true);
    expect(result.audit[0]).toMatchObject({ action: 'FIELD_CAPTURE_ACCEPTED', assetId: pole.id });
    expect(fieldReviewQueue(applyPatch(data, result.patch))).toEqual([]);
    // Deciding twice changes nothing.
    const again = acceptFieldCapture(applyPatch(data, result.patch), pole.id, { by: 'Office Asha' });
    expect(again.ok).toBe(false);
  });

  it('asks for a position or a logged reason before accepting one with no GPS fix', () => {
    const pole = capture('POLE-AAAAAAAA04', noFix);
    const data = networkWith(pole);
    const refused = acceptFieldCapture(data, pole.id, { by: 'Office' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatchObject({ title: 'Place it first', tone: 'warning' });
    const withReason = acceptFieldCapture(data, pole.id, { by: 'Office', reason: 'Placed from the survey sheet later' });
    if (!withReason.ok) throw new Error(withReason.error.message);
    const after = applyPatch(data, withReason.patch).equipment[0];
    expect(after.reviewReason).toBe('Placed from the survey sheet later');
    expect(withReason.audit[0].details).toMatch(/without a placed position/);
  });

  it('is kept on record but out of production when rejected, with a reason', () => {
    const pole = capture('POLE-AAAAAAAA05');
    const data = networkWith(pole);
    expect(rejectFieldCapture(data, pole.id, { by: 'Office' }).ok).toBe(false);
    const result = rejectFieldCapture(data, pole.id, { by: 'Office', reason: 'Same as Pole-07', now: NOW });
    if (!result.ok) throw new Error(result.error.message);
    const next = applyPatch(data, result.patch);
    expect(next.equipment).toHaveLength(1);
    expect(next.equipment[0]).toMatchObject({ reviewStatus: 'rejected', reviewReason: 'Same as Pole-07', status: 'Planned' });
    expect(isInProduction(next.equipment[0])).toBe(false);
    expect(rejectedCaptures(next).map((e) => e.id)).toEqual([pole.id]);
    // Not a "same one?" candidate any more, and not a place-or-check follow-up.
    expect(findNearbySameType(next.equipment, 'pole', [here.lat, here.lng], 4)).toEqual([]);
    expect(fieldFollowUps({ equipment: [{ ...next.equipment[0], locationAccuracyMeters: 9 }], faults: [] })).toEqual([]);
    // A mistaken rejection goes back in the queue; the audit trail keeps the earlier decision.
    const reopened = reopenFieldCapture(next, pole.id, { by: 'Office' });
    if (!reopened.ok) throw new Error(reopened.error.message);
    const back = applyPatch(next, reopened.patch).equipment[0];
    expect(back.reviewStatus).toBe('awaiting_review');
    expect(back.reviewReason).toBeUndefined();
    expect(reopened.audit[0].details).toMatch(/Same as Pole-07/);
  });

  it('can no longer be undone from the phone once the office has decided', () => {
    const accepted = { ...capture('POLE-AAAAAAAA06'), reviewStatus: 'accepted' as const };
    expect(removeCapturedRecord(networkWith(accepted), 'equipment', accepted.id).ok).toBe(false);
    const waiting = capture('POLE-AAAAAAAA07');
    expect(removeCapturedRecord(networkWith(waiting), 'equipment', waiting.id).ok).toBe(true);
  });
});

describe('only the office decides the review', () => {
  const account = (role: Account['role']): Account => ({ id: 'U1', username: 'u', displayName: 'Ravi', role });
  const storeOf = (records: Partial<Record<CollectionName, { id: string }[]>>): StoredLookup => (collection, id) => {
    const record = records[collection]?.find((r) => r.id === id);
    return record ? { record: record as unknown as Record<string, unknown>, createdBy: 'U1' } : undefined;
  };
  const waiting = capture('POLE-BBBBBBBB01');

  it('keeps today\'s technician rights to add captures', () => {
    expect(checkChangeAccess(account('technician'), { upserts: { equipment: [waiting] } }, storeOf({}))).toEqual([]);
  });

  it('refuses a technician accepting, or sending a capture already accepted', () => {
    const accepted = { ...waiting, reviewStatus: 'accepted' as const, status: 'Active' as const };
    const update = checkChangeAccess(account('technician'), { upserts: { equipment: [accepted] } }, storeOf({ equipment: [waiting] }));
    expect(update[0].message).toMatch(/Only the office accepts/);
    const create = checkChangeAccess(account('technician'), { upserts: { equipment: [{ ...accepted, id: 'POLE-BBBBBBBB02' }] } }, storeOf({}));
    expect(create).toHaveLength(1);
  });

  it('refuses a technician changing or undoing a capture the office has decided', () => {
    const rejected = { ...waiting, reviewStatus: 'rejected' as const, reviewReason: 'Duplicate' };
    const moved = { ...rejected, lat: rejected.lat + 0.0001 };
    expect(checkChangeAccess(account('technician'), { upserts: { equipment: [moved] } }, storeOf({ equipment: [rejected] }))[0].message).toMatch(/already checked/);
    expect(checkChangeAccess(account('technician'), { deletes: { equipment: [rejected.id] } }, storeOf({ equipment: [rejected] }))).toHaveLength(1);
  });

  it('lets the office accept', () => {
    const accepted = { ...waiting, reviewStatus: 'accepted' as const, status: 'Active' as const, reviewedBy: 'Asha', reviewedAt: NOW.toISOString() };
    expect(checkChangeAccess(account('office'), { upserts: { equipment: [accepted] } }, storeOf({ equipment: [waiting] }))).toEqual([]);
  });
});

describe('inspection checklists', () => {
  it('has a starting list for every kind of thing inspected, boxes included', () => {
    for (const target of ['pole', 'chamber', 'span', 'duct', 'box'] as const) expect(BUILT_IN_CHECKLISTS[target].length).toBeGreaterThan(0);
    expect(activeChecklist('box').map((i) => i.id)).toContain('box.closed');
  });

  it('lets the owner rename, hide and add items; built-ins are never removed', () => {
    const value = JSON.stringify({ added: [{ id: 'own.earth', label: 'Earth wire connected' }], labels: { 'pole.tag': 'Number painted on the pole can be read' }, hidden: ['pole.clearance'] });
    const settings = [{ id: checklistSettingId('pole'), value }];
    expect(ruleSettingProblem(checklistSettingId('pole'), value)).toBeNull();
    const all = resolveChecklist('pole', settings);
    expect(all.find((e) => e.id === 'pole.clearance')?.hidden).toBe(true);
    const asked = activeChecklist('pole', settings);
    expect(asked.map((i) => i.id)).not.toContain('pole.clearance');
    expect(asked.find((i) => i.id === 'pole.tag')?.label).toBe('Number painted on the pole can be read');
    expect(asked.at(-1)).toEqual({ id: 'own.earth', label: 'Earth wire connected' });
  });

  it('refuses a checklist setting that is broken', () => {
    expect(checklistSettingProblem('checklist.tree', '{}')).toMatch(/only/);
    expect(checklistSettingProblem(checklistSettingId('pole'), 'not json')).toMatch(/expected form/);
    expect(checklistSettingProblem(checklistSettingId('pole'), JSON.stringify({ added: [{ id: 'pole.straight', label: 'x' }] }))).toMatch(/twice/);
    expect(checklistSettingProblem(checklistSettingId('pole'), JSON.stringify({ labels: { nope: 'x' } }))).toMatch(/not an item/);
  });

  it('stores only the answers given, with the words shown, on the inspection', () => {
    const items = activeChecklist('box');
    const answers = checklistAnswersFor(items, { 'box.closed': 'ok', 'box.water': 'problem' });
    expect(answers).toEqual([
      { itemId: 'box.closed', label: items[0].label, answer: 'ok' },
      { itemId: 'box.water', label: items.find((i) => i.id === 'box.water')!.label, answer: 'problem' },
    ]);
    const box = equipment({ id: 'FAT-1', type: 'FAT' });
    const data = networkWith(box);
    const draft = { targetType: 'box' as const, targetId: 'FAT-1', inspectedOn: '2026-11-03', inspectedBy: 'Ravi', condition: 'fair' as const, checklist: answers };
    const result = createInspection(data, draft, { now: NOW });
    if (!result.ok) throw new Error(result.error.message);
    expect(inspectionSchema.parse(result.value).checklist).toEqual(answers);
    expect(result.audit[0].details).toMatch(/checklist 2 answered \(1 problem\)/);
    // An unanswered checklist stores nothing: "Not recorded", never "OK".
    const none = createInspection(data, { ...draft, checklist: checklistAnswersFor(items, {}) }, { now: NOW });
    expect(none.ok && none.value.checklist).toBeUndefined();
    expect(inspectionProblem(data, { ...draft, checklist: [...answers, answers[0]] }, NOW)).toMatch(/twice/);
  });
});
