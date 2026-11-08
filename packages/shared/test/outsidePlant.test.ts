import { describe, expect, it } from 'vitest';

import { deleteCable } from '../src/domain/cables';
import { applyPatch, type NetworkData } from '../src/domain/command';
import { deleteEquipment } from '../src/domain/equipment';
import { addCapturedEquipment, removeCapturedRecord } from '../src/domain/fieldCapture';
import { DEFAULT_OSP_SETTINGS, OSP_SETTING_DEFS, resolveOspSettings } from '../src/domain/ospSettings';
import {
  addAttachments,
  cableLengths,
  cablesOnStructure,
  changeSetTouchesLinks,
  checkChangeSetLinks,
  createDuct,
  createSlackLoop,
  createSpan,
  deleteSpan,
  describeLinkProblems,
  findBrokenLinks,
  findPossibleDuplicates,
  lengthFromMarks,
  pointToLine,
  polesSupportingCable,
  savePermission,
  setSpanStatus,
  suggestPolesForCable,
  updateDuct,
} from '../src/domain/outsidePlant';
import { attachmentSchema, cableSchema, spanSchema } from '../src/model/schemas';
import type { Attachment, Span } from '../src/model/types';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Planner' };

/** Three poles roughly 50 m apart along a street running east, a cable drawn along them, one pole 100 m off. */
function street(): NetworkData {
  return {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'P1', type: 'Telecom Pole', category: 'Supporting Infrastructure', lat: 12.9, lng: 77.6 }),
      equipment({ id: 'P2', type: 'Telecom Pole', category: 'Supporting Infrastructure', lat: 12.9, lng: 77.60046 }),
      equipment({ id: 'P3', type: 'Electric Pole', category: 'Supporting Infrastructure', lat: 12.90003, lng: 77.60092 }),
      equipment({ id: 'FAR', type: 'Telecom Pole', category: 'Supporting Infrastructure', lat: 12.9009, lng: 77.6005 }),
      equipment({ id: 'MH1', type: 'Manhole', category: 'Supporting Infrastructure', lat: 12.901, lng: 77.6 }),
    ],
    cables: [
      cable({
        id: 'C1',
        coordinates: [
          [12.9, 77.59995],
          [12.9, 77.601],
        ],
      }),
      cable({ id: 'C2', coordinates: [] }),
    ],
    spans: [],
    attachments: [],
    ducts: [],
    slackLoops: [],
    permissions: [],
  };
}

const ok = <T>(result: { ok: true; value: T } | { ok: false }) => {
  if (!result.ok) throw new Error('expected success');
  return result as { ok: true; value: T; patch: Partial<NetworkData> };
};

describe('outside plant settings', () => {
  it('has a source for every default and ignores impossible overrides', () => {
    for (const def of OSP_SETTING_DEFS) expect(def.source.length).toBeGreaterThan(10);
    expect(DEFAULT_OSP_SETTINGS.duplicateRadiusMeters).toBe(5);
    const s = resolveOspSettings([
      { id: 'osp.duplicate.radiusMeters', value: 8 },
      { id: 'osp.length.opticalShortPercent', value: 250 },
      { id: 'osp.attachment.corridorMeters', value: 'wide' },
    ]);
    expect(s.duplicateRadiusMeters).toBe(8);
    expect(s.opticalShortRatio).toBe(0.01);
    expect(s.attachmentCorridorMeters).toBe(15);
  });
});

describe('spans', () => {
  it('joins two existing poles and refuses a missing end, the same pole twice, or a second span', () => {
    const data = street();
    const created = ok(createSpan(data, { fromStructureId: 'P1', toStructureId: 'P2', status: 'built', basis: 'office_drawn' }, ctx));
    expect(created.value).toMatchObject({ name: 'P1 – P2', status: 'built', basis: 'office_drawn', createdBy: 'Planner' });
    expect(spanSchema.safeParse(created.value).success).toBe(true);
    const after = applyPatch(data, created.patch);
    expect(createSpan(after, { fromStructureId: 'P2', toStructureId: 'P1', status: 'built', basis: 'office_drawn' }).ok).toBe(false);
    expect(createSpan(data, { fromStructureId: 'P1', toStructureId: 'NOPE', status: 'built', basis: 'office_drawn' }).ok).toBe(false);
    expect(createSpan(data, { fromStructureId: 'P1', toStructureId: 'P1', status: 'built', basis: 'office_drawn' }).ok).toBe(false);
  });

  it('allows a field-order span only as proposed, and the office confirms it', () => {
    const data = street();
    expect(createSpan(data, { fromStructureId: 'P1', toStructureId: 'P2', status: 'built', basis: 'field_sequence' }).ok).toBe(false);
    const proposed = ok(createSpan(data, { fromStructureId: 'P1', toStructureId: 'P2', status: 'proposed', basis: 'field_sequence' }, ctx));
    const after = applyPatch(data, proposed.patch);
    const confirmed = ok(setSpanStatus(after, proposed.value.id, 'built', ctx));
    expect(confirmed.value).toMatchObject({ status: 'built', basis: 'field_sequence', confirmedBy: 'Planner' });
  });

  it('removes the cable records on a span with it, after asking', () => {
    let data = street();
    const span = ok(createSpan(data, { fromStructureId: 'P1', toStructureId: 'P2', status: 'built', basis: 'office_drawn' }, ctx));
    data = applyPatch(data, span.patch);
    data = applyPatch(data, ok(addAttachments(data, [{ cableId: 'C1', spanId: span.value.id, status: 'built', basis: 'office_confirmed' }], ctx)).patch);
    const removed = deleteSpan(data, span.value.id);
    expect(removed.ok && removed.confirm).toMatch(/1 cable record/);
    expect(removed.ok && removed.patch.attachments).toEqual([]);
  });
});

describe('"Next pole" in the field', () => {
  const pole = (id: string, previousAssetId?: string) =>
    equipment({
      id,
      type: 'Telecom Pole',
      category: 'Supporting Infrastructure',
      captureSource: 'field_capture',
      photoIds: [`PH-${id}`],
      ...(previousAssetId ? { previousAssetId } : {}),
    });

  it('proposes a span from the previous pole, once, and never claims a cable', () => {
    let data: NetworkData = { ...emptyNetwork(), equipment: [pole('POLE-AAAAAAAAAA')] };
    const second = pole('POLE-BBBBBBBBBB', 'POLE-AAAAAAAAAA');
    const result = ok(addCapturedEquipment(data, second, NOW));
    data = applyPatch(data, result.patch);
    expect(data.spans).toHaveLength(1);
    expect(data.spans?.[0]).toMatchObject({
      id: 'SPN-BBBBBBBBBB',
      fromStructureId: 'POLE-AAAAAAAAAA',
      toStructureId: 'POLE-BBBBBBBBBB',
      status: 'proposed',
      basis: 'field_sequence',
    });
    expect(data.attachments ?? []).toEqual([]);
    expect(data.cables).toEqual([]);
    // Saving the same capture again changes nothing.
    expect(addCapturedEquipment(data, second, NOW)).toMatchObject({ ok: true, patch: {} });
  });

  it('makes no span after a box, or for the first pole', () => {
    const box = equipment({ id: 'BOX-AAAAAAAAAA', type: 'FAT' });
    const data: NetworkData = { ...emptyNetwork(), equipment: [box] };
    expect(ok(addCapturedEquipment(data, pole('POLE-CCCCCCCCCC', 'BOX-AAAAAAAAAA'))).patch.spans).toBeUndefined();
    expect(ok(addCapturedEquipment(data, pole('POLE-DDDDDDDDDD'))).patch.spans).toBeUndefined();
  });

  it('Undo removes the pole and its proposed span together', () => {
    let data: NetworkData = { ...emptyNetwork(), equipment: [pole('POLE-AAAAAAAAAA')] };
    data = applyPatch(data, ok(addCapturedEquipment(data, pole('POLE-BBBBBBBBBB', 'POLE-AAAAAAAAAA'))).patch);
    data = applyPatch(data, ok(removeCapturedRecord(data, 'equipment', 'POLE-BBBBBBBBBB')).patch);
    expect(data.equipment.map((e) => e.id)).toEqual(['POLE-AAAAAAAAAA']);
    expect(data.spans).toEqual([]);
  });
});

describe('attachments and the two engineer questions', () => {
  it('suggests only poles near the drawn line, in order, and saves nothing by itself', () => {
    const data = street();
    const suggestions = suggestPolesForCable(data, 'C1');
    expect(suggestions.map((s) => s.pole.id)).toEqual(['P1', 'P2', 'P3']);
    expect(suggestions[2].distanceMeters).toBeGreaterThan(2);
    expect(suggestions[2].distanceMeters).toBeLessThan(5);
    expect(data.attachments).toEqual([]);
    expect(suggestPolesForCable(data, 'C2')).toEqual([]);
    expect(suggestPolesForCable(data, 'C1', { attachmentCorridorMeters: 2 }).map((s) => s.pole.id)).toEqual(['P1', 'P2']);
  });

  it('answers "which poles support this route?" and "which cables are on this pole?"', () => {
    let data = street();
    expect(polesSupportingCable(data, 'C1')).toEqual([]);
    expect(cablesOnStructure(data, 'P2')).toEqual([]);

    const span = ok(createSpan(data, { fromStructureId: 'P2', toStructureId: 'P3', status: 'built', basis: 'office_drawn' }, ctx));
    data = applyPatch(data, span.patch);
    const saved = ok(
      addAttachments(
        data,
        [
          { cableId: 'C1', structureId: 'P1', status: 'built', basis: 'route_proposal_confirmed' },
          { cableId: 'C1', spanId: span.value.id, status: 'verified', basis: 'inspected' },
        ],
        ctx,
      ),
    );
    for (const a of saved.value) expect(attachmentSchema.safeParse(a).success).toBe(true);
    data = applyPatch(data, saved.patch);

    const poles = polesSupportingCable(data, 'C1');
    expect(poles.map((p) => [p.structure.id, p.via])).toEqual([
      ['P1', 'pole'],
      ['P2', 'span'],
      ['P3', 'span'],
    ]);
    expect(cablesOnStructure(data, 'P3').map((c) => [c.cable.id, c.via])).toEqual([['C1', 'span']]);
    expect(cablesOnStructure(data, 'FAR')).toEqual([]);
    // The same fact twice is not saved twice.
    expect(addAttachments(data, [{ cableId: 'C1', structureId: 'P1', status: 'built', basis: 'office_confirmed' }]).ok).toBe(false);
  });

  it('refuses an attachment to a missing pole, span or cable, or to both at once', () => {
    const data = street();
    expect(addAttachments(data, [{ cableId: 'C1', structureId: 'NOPE', status: 'built', basis: 'office_confirmed' }]).ok).toBe(false);
    expect(addAttachments(data, [{ cableId: 'C1', spanId: 'NOPE', status: 'built', basis: 'office_confirmed' }]).ok).toBe(false);
    expect(addAttachments(data, [{ cableId: 'NOPE', structureId: 'P1', status: 'built', basis: 'office_confirmed' }]).ok).toBe(false);
    expect(addAttachments(data, [{ cableId: 'C1', structureId: 'P1', spanId: 'S', status: 'built', basis: 'office_confirmed' }]).ok).toBe(false);
    expect(attachmentSchema.safeParse({ id: 'A', cableId: 'C1', status: 'built', basis: 'imported', createdAt: '' }).success).toBe(false);
  });
});

describe('ducts and occupancy', () => {
  it('records cables in a duct and its sub-ducts, refusing a missing cable or one listed twice', () => {
    let data = street();
    const duct = ok(
      createDuct(
        data,
        {
          name: 'Duct MH1 east',
          coordinates: [
            [12.901, 77.6],
            [12.901, 77.601],
          ],
          fromStructureId: 'MH1',
          status: 'built',
          basis: 'office_drawn',
          subductLabels: ['Blue', 'Orange'],
        },
        ctx,
      ),
    );
    data = applyPatch(data, duct.patch);
    const filled = { ...duct.value, subducts: duct.value.subducts.map((s, i) => (i === 0 ? { ...s, cableIds: ['C1'] } : s)) };
    expect(updateDuct(data, filled).ok).toBe(true);
    expect(updateDuct(data, { ...filled, cableIds: ['C1'] }).ok).toBe(false);
    expect(updateDuct(data, { ...filled, cableIds: ['NOPE'] }).ok).toBe(false);
    expect(createDuct(data, { name: 'x', coordinates: [[12.9, 77.6]], status: 'built', basis: 'office_drawn' }).ok).toBe(false);
  });
});

describe('slack loops and lengths', () => {
  it('stores a loop at its place with the length entered or worked out from the marks', () => {
    const data = street();
    const loop = ok(createSlackLoop(data, { cableId: 'C1', structureId: 'P2', marks: { before: 1520, after: 1480, unit: 'ft' } }, ctx));
    expect(loop.value).toMatchObject({ lengthMeters: 12.2, lengthSource: 'marks', lat: 12.9, lng: 77.60046, structureId: 'P2' });
    expect(createSlackLoop(data, { cableId: 'C1', lengthMeters: 10 }).ok).toBe(false);
    expect(createSlackLoop(data, { cableId: 'C1', structureId: 'P2' }).ok).toBe(false);
    expect(lengthFromMarks(100, 30, 'm')).toBe(70);
  });

  it('keeps drawn, sheath and optical lengths apart and says when they disagree', () => {
    const drawn = cable({
      id: 'L1',
      coordinates: [
        [12.9, 77.6],
        [12.9, 77.60923],
      ],
    });
    const plain = cableLengths(drawn);
    expect(plain.drawnMeters).toBeGreaterThan(995);
    expect(plain.drawnMeters).toBeLessThan(1005);
    expect(plain.sheathMeters).toBeUndefined();
    expect(plain.opticalMeters).toBeUndefined();
    expect(plain.flags).toEqual([]);

    const recorded = { ...drawn, sheathMarkStart: 4000, sheathMarkEnd: 2950, sheathMarkUnit: 'm' as const, opticalLengthMeters: 1020 };
    expect(cableSchema.safeParse(recorded).success).toBe(true);
    const lengths = cableLengths(recorded);
    expect(lengths.sheathMeters).toBe(1050);
    expect(lengths.opticalMeters).toBe(1020);
    expect(lengths.flags.map((f) => f.code)).toEqual(['optical_short']);
    // The drawn length is still the map's own figure: nothing was overwritten.
    expect(lengths.drawnMeters).toBe(plain.drawnMeters);

    const far = cableLengths({ ...recorded, sheathMarkEnd: 2700, opticalLengthMeters: 1400 });
    expect(far.flags.map((f) => f.code)).toEqual(['optical_long', 'drawn_vs_sheath']);
  });
});

describe('duplicate check before creating', () => {
  it('lists the same kind of item within the setting, nearest first, without blocking anything', () => {
    const data = street();
    expect(findPossibleDuplicates(data.equipment, 'Telecom Pole', [12.9, 77.60002]).map((d) => d.equipment.id)).toEqual(['P1']);
    // An electricity pole is still a pole.
    expect(findPossibleDuplicates(data.equipment, 'Pole', [12.90003, 77.60093]).map((d) => d.equipment.id)).toEqual(['P3']);
    expect(findPossibleDuplicates(data.equipment, 'Manhole', [12.9, 77.60002])).toEqual([]);
    expect(findPossibleDuplicates(data.equipment, 'Telecom Pole', [12.9, 77.60002], { duplicateRadiusMeters: 1 })).toEqual([]);
  });
});

describe('permissions', () => {
  it('keeps what the office typed and refuses a missing pole or dates out of order', () => {
    const data = street();
    const saved = ok(
      savePermission(
        data,
        { authority: ' BESCOM ', permitNumber: 'BES/2026/14', structureIds: ['P3'], validFrom: '2026-01-01', validUntil: '2026-12-31', rentAmount: 300, rentTerms: 'per pole per year' },
        ctx,
      ),
    );
    expect(saved.value).toMatchObject({ authority: 'BESCOM', rentAmount: 300, rentTerms: 'per pole per year' });
    expect(savePermission(data, { authority: 'BESCOM', structureIds: ['NOPE'] }).ok).toBe(false);
    expect(savePermission(data, { authority: '', structureIds: ['P3'] }).ok).toBe(false);
    expect(savePermission(data, { authority: 'BBMP', structureIds: ['P3'], validFrom: '2026-05-01', validUntil: '2026-01-01' }).ok).toBe(false);
  });
});

describe('removing poles and cables', () => {
  it('takes spans and cable records with a pole, and says so before deleting', () => {
    let data = street();
    const span = ok(createSpan(data, { fromStructureId: 'P1', toStructureId: 'P2', status: 'built', basis: 'office_drawn' }, ctx));
    data = applyPatch(data, span.patch);
    data = applyPatch(data, ok(addAttachments(data, [{ cableId: 'C1', spanId: span.value.id, status: 'built', basis: 'office_confirmed' }], ctx)).patch);
    data = applyPatch(data, ok(savePermission(data, { authority: 'BESCOM', structureIds: ['P1', 'P2'] }, ctx)).patch);
    const removed = deleteEquipment(data, 'P1');
    expect(removed.ok && removed.confirm).toMatch(/1 span\(s\) and 1 record\(s\) of cables carried there will also be removed/);
    const after = applyPatch(data, removed.ok ? removed.patch : {});
    expect(after.spans).toEqual([]);
    expect(after.attachments).toEqual([]);
    expect(after.permissions?.[0].structureIds).toEqual(['P2']);
    expect(findBrokenLinks(after)).toEqual([]);
  });

  it('takes a cable out of attachments, ducts and slack loops when the cable goes', () => {
    let data = street();
    data = applyPatch(data, ok(addAttachments(data, [{ cableId: 'C1', structureId: 'P1', status: 'built', basis: 'office_confirmed' }], ctx)).patch);
    data = applyPatch(data, ok(createSlackLoop(data, { cableId: 'C1', structureId: 'P1', lengthMeters: 10 }, ctx)).patch);
    const removed = deleteCable(data, 'C1');
    expect(removed.ok).toBe(true);
    const after = applyPatch(data, removed.ok ? removed.patch : {});
    expect(after.attachments).toEqual([]);
    expect(after.slackLoops).toEqual([]);
    expect(findBrokenLinks(after)).toEqual([]);
  });
});

describe('server link checks', () => {
  const span: Span = { id: 'S1', name: 'P1 – P2', fromStructureId: 'P1', toStructureId: 'P2', status: 'built', basis: 'office_drawn', createdAt: '' };
  const attachment: Attachment = { id: 'A1', cableId: 'C1', spanId: 'S1', status: 'built', basis: 'office_confirmed', createdAt: '' };

  it('accepts records whose links exist, in the store or in the same change set', () => {
    const data = street();
    expect(checkChangeSetLinks(data, { upserts: { spans: [span], attachments: [attachment] } })).toEqual([]);
  });

  it('refuses a span to a missing pole and an attachment to a missing span, in plain words', () => {
    const data = street();
    const problems = checkChangeSetLinks(data, { upserts: { spans: [{ ...span, toStructureId: 'GONE' }] } });
    expect(problems).toEqual([expect.objectContaining({ collection: 'spans', id: 'S1', missingId: 'GONE' })]);
    expect(describeLinkProblems(problems)).toMatch(/does not exist\. Nothing was saved/);
    expect(checkChangeSetLinks(data, { upserts: { attachments: [attachment] } })).toHaveLength(1);
  });

  it('refuses deleting a pole that a remaining span still names', () => {
    const data = { ...street(), spans: [span] };
    expect(checkChangeSetLinks(data, { deletes: { equipment: ['P1'] } })).toHaveLength(1);
    expect(checkChangeSetLinks(data, { deletes: { equipment: ['P1'], spans: ['S1'] } })).toEqual([]);
    expect(checkChangeSetLinks(data, { deletes: { equipment: ['FAR'] } })).toEqual([]);
  });

  it('only looks when outside-plant links could change', () => {
    expect(changeSetTouchesLinks({ upserts: { equipment: [] } })).toBe(false);
    expect(changeSetTouchesLinks({ deletes: { cables: ['C1'] } })).toBe(true);
    expect(changeSetTouchesLinks({ upserts: { spans: [span] } })).toBe(true);
  });

  it('measures distance to a line', () => {
    const near = pointToLine([12.9001, 77.6005], [
      [12.9, 77.6],
      [12.9, 77.601],
    ]);
    expect(near?.distanceMeters).toBeGreaterThan(10.5);
    expect(near?.distanceMeters).toBeLessThan(11.6);
    expect(near?.alongMeters).toBeGreaterThan(50);
  });
});
