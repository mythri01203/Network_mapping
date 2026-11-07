import { describe, expect, it } from 'vitest';

import { applyPatch } from '../src/domain/command';
import { moveEquipment } from '../src/domain/equipment';
import {
  addCapturedEquipment,
  addCapturedFault,
  assetGroupOf,
  averageSamples,
  buildCapturedEquipment,
  buildHazardFault,
  type CaptureLocation,
  captureLocation,
  checkRxEntry,
  confirmFieldLocation,
  decideGps,
  DEFAULT_FIELD_SETTINGS,
  fieldFollowUps,
  findByTag,
  findNearbySameType,
  formatPadValue,
  type GpsSample,
  isCaptureId,
  newCaptureId,
  nextDisplayName,
  normalizeTag,
  padValueDbm,
  pressPadKey,
  randomCode,
  recordFieldRxReading,
  removeCapturedRecord,
  resolveFieldSettings,
  undoFieldRxReading,
} from '../src/domain/fieldCapture';
import { equipmentSchema, faultSchema } from '../src/model/schemas';
import { customer, emptyNetwork, equipment, NOW } from './fixtures';

const limits = DEFAULT_FIELD_SETTINGS.gps;
const sample = (accuracy: number, at = 0, lat = 12.9352, lng = 77.6245): GpsSample => ({ lat, lng, accuracy, at });
const goodLocation: CaptureLocation = {
  lat: 12.9352,
  lng: 77.6245,
  method: 'gps_averaged',
  accuracyMeters: 4,
  sampleCount: 5,
  capturedAt: NOW.toISOString(),
  officeMustPlace: false,
};

const pole = (id = newCaptureId('pole'), photoId = newCaptureId('photo')) =>
  buildCapturedEquipment({
    kind: 'pole',
    id,
    name: 'Pole-01',
    photoId,
    location: goodLocation,
    now: NOW,
    capturedBy: 'Field Technician',
    ownerType: 'electricity',
    material: 'concrete',
    runId: 'RUN-1',
    order: 0,
  });

describe('capture IDs', () => {
  it('makes 50 000 IDs with no repeats, all in the expected form', () => {
    const ids = new Set(Array.from({ length: 50_000 }, () => newCaptureId('pole')));
    expect(ids.size).toBe(50_000);
    for (const id of [...ids].slice(0, 200)) expect(isCaptureId(id)).toBe(true);
  });

  it('uses only unambiguous letters, each equally reachable', () => {
    const code = randomCode(32, (bytes) => bytes.map((_, i) => i));
    expect(code).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(randomCode(10)).not.toMatch(/[ILOU]/);
  });

  it('keeps display names separate from IDs and continues numbering', () => {
    expect(nextDisplayName('Pole', [{ name: 'Pole-07' }, { name: 'Pole-02' }, { name: 'Box-30' }])).toBe('Pole-08');
    expect(nextDisplayName('Box', [])).toBe('Box-01');
  });
});

describe('idempotent save', () => {
  it('saving the same capture twice changes nothing the second time', () => {
    const record = pole();
    const first = addCapturedEquipment(emptyNetwork(), record);
    expect(first.ok && first.value.created).toBe(true);
    const data = applyPatch(emptyNetwork(), first.ok ? first.patch : {});
    const second = addCapturedEquipment(data, record);
    expect(second.ok && second.value.created).toBe(false);
    expect(second.ok && second.patch).toEqual({});
  });

  it('refuses a different record that happens to share the ID', () => {
    const data = { ...emptyNetwork(), equipment: [equipment({ id: 'POLE-0000000000', type: 'Telecom Pole' })] };
    const result = addCapturedEquipment(data, pole('POLE-0000000000'));
    expect(result.ok).toBe(false);
  });

  it('builds records the schema accepts, with no invented facts', () => {
    const record = pole();
    expect(equipmentSchema.parse(record)).toEqual(record);
    expect(record.installedDate).toBe('');
    expect(record.manufacturer).toBeUndefined();
    expect(record.totalPorts).toBeUndefined();
    expect(record.type).toBe('Electric Pole');
    expect(record.images[0].url).toBe(`/api/v1/photos/${record.photoIds?.[0]}`);
    // Unknown owners get a plain type rather than a guess.
    const unknown = buildCapturedEquipment({ kind: 'pole', id: 'POLE-X', name: 'P', photoId: 'PH-123456', location: goodLocation, now: NOW, capturedBy: 'x', ownerType: 'unknown', material: 'unknown' });
    expect(unknown.type).toBe('Pole');
    const box = buildCapturedEquipment({ kind: 'box', id: 'BOX-X', name: 'B', photoId: 'PH-123456', location: goodLocation, now: NOW, capturedBy: 'x', boxKind: 'unknown' });
    expect(box.type).toBe('Box (kind not known)');
  });

  it('adds and removes a hazard idempotently', () => {
    const fault = buildHazardFault({ id: newCaptureId('danger'), photoId: 'PH-123456', location: goodLocation, now: NOW, capturedBy: 'x' });
    expect(faultSchema.parse(fault)).toEqual(fault);
    expect(fault).toMatchObject({ type: 'Safety Hazard', unsafe: true, severity: 'Critical' });
    const added = addCapturedFault(emptyNetwork(), fault);
    const data = applyPatch(emptyNetwork(), added.ok ? added.patch : {});
    expect(addCapturedFault(data, fault)).toMatchObject({ ok: true, value: { created: false } });
    const removed = removeCapturedRecord(data, 'faults', fault.id);
    expect(removed.ok && removed.patch.faults).toEqual([]);
    expect(removeCapturedRecord(emptyNetwork(), 'faults', fault.id)).toMatchObject({ ok: true, value: { removed: false } });
  });

  it('never removes a record that did not come from the phone', () => {
    const data = { ...emptyNetwork(), equipment: [equipment({ id: 'OLT-01', type: 'OLT' })] };
    expect(removeCapturedRecord(data, 'equipment', 'OLT-01').ok).toBe(false);
  });
});

describe('GPS averaging and limits', () => {
  it('shows the tick after enough good readings, averaging them', () => {
    const readings = [sample(4, 0, 12.93520), sample(3, 1000, 12.93522), sample(5, 2000, 12.93518), sample(4, 3000), sample(4, 4000)];
    const decision = decideGps(readings, 4000, limits);
    expect(decision.state).toBe('good');
    expect(decision.fix).toMatchObject({ sampleCount: 5, method: 'gps_averaged', accuracyMeters: 4 });
    expect(decision.fix?.lat).toBeCloseTo(12.9352, 4);
  });

  it('does not claim more precision from averaging', () => {
    const fix = averageSamples([sample(4), sample(4), sample(4), sample(4)]);
    expect(fix?.accuracyMeters).toBe(4);
  });

  it('keeps searching, then stops averaging after the time limit with one good reading', () => {
    expect(decideGps([sample(4)], 2000, limits).state).toBe('searching');
    const late = decideGps([sample(4)], limits.maxAverageSeconds * 1000, limits);
    expect(late).toMatchObject({ state: 'good', fix: { method: 'gps', sampleCount: 1 } });
  });

  it('is rough between the accept and warn limits after waiting, and no fix beyond', () => {
    const wait = limits.waitSeconds * 1000;
    expect(decideGps([sample(8)], wait - 1, limits).state).toBe('searching');
    expect(decideGps([sample(8)], wait, limits)).toMatchObject({ state: 'rough', fix: { accuracyMeters: 8 } });
    expect(decideGps([sample(25)], wait, limits)).toMatchObject({ state: 'no_fix', bestAccuracy: 25 });
    expect(decideGps([], wait, limits).state).toBe('no_fix');
  });

  it('does not trust an early good reading once the latest ones are poor', () => {
    const readings = [sample(4, 0), ...Array.from({ length: 10 }, (_, i) => sample(60, 1000 * (i + 1)))];
    expect(decideGps(readings, limits.maxAverageSeconds * 1000, limits).state).toBe('searching');
    expect(decideGps(readings, limits.waitSeconds * 1000, limits).state).toBe('no_fix');
    // Recovering under open sky earns the tick again.
    expect(decideGps([...readings, sample(4, 20_000)], limits.maxAverageSeconds * 1000, limits).state).toBe('good');
  });

  it('follows edited limits', () => {
    const strict = resolveFieldSettings([{ id: 'field.gps.acceptMeters', value: 3 }, { id: 'field.gps.minSamples', value: 1 }]).gps;
    expect(decideGps([sample(4)], 0, strict).state).toBe('searching');
    expect(decideGps([sample(2.5)], 0, strict).state).toBe('good');
  });

  it('ignores impossible overrides and keeps warn at or above accept', () => {
    const settings = resolveFieldSettings([
      { id: 'field.gps.acceptMeters', value: -2 },
      { id: 'field.gps.warnMeters', value: 'ten' },
      { id: 'field.supervisorPhone', value: 'call me' },
    ]);
    expect(settings.gps.acceptMeters).toBe(5);
    expect(settings.gps.warnMeters).toBe(10);
    expect(settings.supervisorPhone).toBe('');
    expect(resolveFieldSettings([{ id: 'field.gps.acceptMeters', value: 20 }]).gps.warnMeters).toBe(20);
  });

  it('stores no fix honestly: a poor reading keeps its accuracy, nothing at all is not_placed', () => {
    const none = decideGps([], 60_000, limits);
    expect(captureLocation(none, [sample(40, 5000)], undefined)).toMatchObject({ method: 'gps', accuracyMeters: 40, officeMustPlace: true });
    expect(captureLocation(none, [], [12.9, 77.6])).toEqual({ lat: 12.9, lng: 77.6, method: 'not_placed', officeMustPlace: true });
    expect(captureLocation(none, [], undefined)).toBeNull();
    const good = decideGps([sample(4), sample(4), sample(4), sample(4), sample(4)], 1000, limits);
    expect(captureLocation(good, [], undefined)).toMatchObject({ officeMustPlace: false, method: 'gps_averaged' });
  });
});

describe('same one nearby', () => {
  const here: [number, number] = [12.9352, 77.6245];
  const north = (m: number) => 12.9352 + m / 111_320;
  const data = [
    equipment({ id: 'P1', type: 'Telecom Pole', lat: north(8), lng: 77.6245 }),
    equipment({ id: 'P2', type: 'Electric Pole', lat: north(3), lng: 77.6245 }),
    equipment({ id: 'P3', type: 'Telecom Pole', lat: north(40), lng: 77.6245 }),
    equipment({ id: 'B1', type: 'FAT', lat: north(1), lng: 77.6245 }),
    equipment({ id: 'P4', type: 'Telecom Pole', lat: north(2), lng: 77.6245, officeMustPlace: true }),
  ];

  it('lists same-group assets within 1.5 × accuracy + margin, nearest first', () => {
    const near = findNearbySameType(data, 'pole', here, 4);
    expect(near.map((n) => n.equipment.id)).toEqual(['P2', 'P1']);
    expect(findNearbySameType(data, 'box', here, 4).map((n) => n.equipment.id)).toEqual(['B1']);
    expect(findNearbySameType(data, 'pole', here, 30).map((n) => n.equipment.id)).toEqual(['P2', 'P1', 'P3']);
  });

  it('groups types sensibly', () => {
    expect(assetGroupOf('Pole-Mounted Terminal Box')).toBe('box');
    expect(assetGroupOf('Electric Pole')).toBe('pole');
    expect(assetGroupOf('Pole')).toBe('pole');
    expect(assetGroupOf('Box (kind not known)')).toBe('box');
    expect(assetGroupOf('Building Entry Point')).toBe('drop');
    expect(assetGroupOf('OLT')).toBeNull();
  });

  it('opens the record for a known tag, ignoring case, spaces and URL prefixes', () => {
    const tagged = [equipment({ id: 'P9', type: 'Telecom Pole', tagCode: 'KRM-0142' })];
    expect(findByTag(tagged, ' krm-0142 ')?.id).toBe('P9');
    expect(findByTag(tagged, 'https://tags.example/t/KRM-0142?x=1')?.id).toBe('P9');
    expect(findByTag(tagged, 'OTHER')).toBeUndefined();
    expect(normalizeTag('   ')).toBe('');
  });
});

describe('dBm pad', () => {
  const type = (keys: string) => [...keys].reduce((d, k) => pressPadKey(d, k as never), '');

  it('supplies the minus sign and decimal point', () => {
    expect(padValueDbm(type('1852'), 2)).toBe(-18.52);
    expect(padValueDbm(type('852'), 2)).toBe(-8.52);
    expect(padValueDbm(type('185'), 1)).toBe(-18.5);
    expect(formatPadValue(type('1852'), 2)).toBe('−18.52');
    expect(formatPadValue('', 2)).toBe('−__.__');
    expect(padValueDbm('', 2)).toBeUndefined();
  });

  it('drops leading zeros, caps length, and handles back and clear', () => {
    expect(type('0018')).toBe('18');
    expect(type('123456')).toBe('1234');
    expect(pressPadKey('185', 'back')).toBe('18');
    expect(pressPadKey('185', 'clear')).toBe('');
    expect(padValueDbm('0', 2)).toBeUndefined();
  });

  it('range-checks without blocking', () => {
    expect(checkRxEntry(-18.52)).toBe('ok');
    expect(checkRxEntry(-25.1)).toBe('low_margin');
    expect(checkRxEntry(-29)).toBe('too_weak');
    expect(checkRxEntry(-6)).toBe('too_much_light');
    // A forgotten digit: "185" read as -1.85 with two decimals.
    expect(checkRxEntry(-1.85)).toBe('check_number');
    expect(checkRxEntry(-55)).toBe('check_number');
  });
});

describe('field light reading', () => {
  const base = () => ({ ...emptyNetwork(), customers: [customer({ id: 'C1', rxOpticalPowerDbm: -20.4, rxSource: 'calculated', rxLaunchDbm: 3 })] });

  it('stores field_measured with time and photo, once', () => {
    const reading = { customerId: 'C1', captureId: 'RX-1', valueDbm: -18.52, measuredAt: NOW.toISOString(), photoId: 'PH-123456' };
    const result = recordFieldRxReading(base(), reading);
    expect(result.ok).toBe(true);
    const data = applyPatch(base(), result.ok ? result.patch : {});
    const c = data.customers[0];
    expect(c).toMatchObject({ rxOpticalPowerDbm: -18.52, rxSource: 'field_measured', rxMeasuredAt: NOW.toISOString(), rxPhotoId: 'PH-123456' });
    expect('rxLaunchDbm' in c).toBe(false);
    expect(recordFieldRxReading(data, reading)).toMatchObject({ ok: true, value: { changed: false } });

    const undone = undoFieldRxReading(data, 'C1', 'RX-1', result.ok ? result.value.previous : {});
    const restored = applyPatch(data, undone.ok ? undone.patch : {}).customers[0];
    expect(restored).toMatchObject({ rxOpticalPowerDbm: -20.4, rxSource: 'calculated', rxLaunchDbm: 3 });
    expect(restored.rxCaptureId).toBeUndefined();
  });

  it('reports a missing customer', () => {
    expect(recordFieldRxReading(base(), { customerId: 'NOPE', captureId: 'RX', valueDbm: -18, measuredAt: '', photoId: 'PH' }).ok).toBe(false);
  });
});

describe('office follow-up', () => {
  it('lists unplaced and rough field captures until placed or confirmed', () => {
    const unplaced = { ...pole('POLE-A'), officeMustPlace: true, locationMethod: 'not_placed' as const, locationAccuracyMeters: undefined };
    const rough = { ...pole('POLE-B'), locationAccuracyMeters: 8 };
    const fine = pole('POLE-C');
    const office = equipment({ id: 'OLT-01', type: 'OLT', locationAccuracyMeters: 50 });
    let data = { ...emptyNetwork(), equipment: [rough, fine, unplaced, office] };
    expect(fieldFollowUps(data).map((i) => [i.id, i.reason])).toEqual([
      ['POLE-A', 'office_must_place'],
      ['POLE-B', 'rough_location'],
    ]);

    expect(confirmFieldLocation(data, 'equipment', 'POLE-A', 'Office').ok).toBe(false);
    const confirmed = confirmFieldLocation(data, 'equipment', 'POLE-B', 'Office', NOW);
    data = applyPatch(data, confirmed.ok ? confirmed.patch : {});
    const moved = moveEquipment(data, 'POLE-A', 12.9, 77.6);
    data = applyPatch(data, moved.ok ? moved.patch : {});
    expect(fieldFollowUps(data)).toEqual([]);
    expect(data.equipment.find((e) => e.id === 'POLE-A')).toMatchObject({ locationMethod: 'map_pick' });
    expect(data.equipment.find((e) => e.id === 'POLE-A')?.officeMustPlace).toBeUndefined();
  });
});
