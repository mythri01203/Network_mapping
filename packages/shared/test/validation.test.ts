import { describe, expect, it } from 'vitest';

import { applyPatch, type NetworkData } from '../src/domain/command';
import { closePoints, findGeometryProblems, pointInRing, selfIntersection } from '../src/domain/geometryRules';
import { buildTraceGraph, traceNetwork } from '../src/domain/networkTrace';
import { checkRestoredNetwork } from '../src/domain/restoreCheck';
import { buildTraceReport, traceReportCsv } from '../src/domain/traceReport';
import {
  acknowledgeFinding,
  checkChangeSetValidationFindings,
  collectValidationProblems,
  problemsFromMapCheck,
  reconcileFindings,
  reopenFinding,
  resolveFinding,
  scrubCustomerNames,
} from '../src/domain/validationFindings';
import { checkLimitsFrom, resolveValidationSettings } from '../src/domain/validationSettings';
import type { LatLng } from '../src/model/types';
import type { ValidationFinding } from '../src/model/validationFindingSchemas';
import { createSampleNetwork } from '../src/sample';
import { cable, customer, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Priya (engineer)' };

const base = (): NetworkData => ({
  ...emptyNetwork(),
  equipment: [equipment({ id: 'A', name: 'Box A', type: 'FAT', lat: 17.4, lng: 78.4 }), equipment({ id: 'B', name: 'Box B', type: 'FAT', lat: 17.41, lng: 78.4 })],
});

const line = (id: string, coordinates: LatLng[], extra: Record<string, unknown> = {}) =>
  cable({ id, name: id, startEquipmentId: 'A', endEquipmentId: 'B', coordinates, fiberCount: 12, cores: [], ...extra });

describe('geometry rules', () => {
  it('finds a line that crosses itself, but not a straight one or one with a shared end', () => {
    const bowtie: LatLng[] = [[17.4, 78.4], [17.41, 78.41], [17.41, 78.4], [17.4, 78.41]];
    expect(selfIntersection(bowtie)).not.toBeNull();
    expect(selfIntersection([[17.4, 78.4], [17.405, 78.4], [17.41, 78.4], [17.415, 78.4]])).toBeNull();
    const data = { ...base(), cables: [line('C-X', bowtie)] };
    const found = findGeometryProblems(data).filter((p) => p.rule === 'route-self-intersects');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'warning', targetId: 'C-X', targetCollection: 'cables' });
    expect(found[0].lat).toBeGreaterThan(17.4);
  });

  it('finds points closer than the setting, and uses the operator\'s setting', () => {
    const pts: LatLng[] = [[17.4, 78.4], [17.400003, 78.4], [17.41, 78.4]];
    expect(closePoints(pts, 1)).toEqual([1]);
    const data = { ...base(), cables: [line('C-D', pts)] };
    expect(findGeometryProblems(data).some((p) => p.rule === 'route-extra-point')).toBe(true);
    const strict = checkLimitsFrom([{ id: 'validation.geometry.minVertexSpacingMeters', value: 0.1 }]);
    expect(findGeometryProblems(data, strict).some((p) => p.rule === 'route-extra-point')).toBe(false);
  });

  it('finds a cable end far from its box beyond the setting, never for a near one', () => {
    const data = { ...base(), cables: [line('C-G', [[17.4, 78.4], [17.42, 78.4]])] };
    const gaps = findGeometryProblems(data).filter((p) => p.rule === 'cable-end-gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].key).toBe('geometry:cable-end-gap:C-G:end');
    const loose = checkLimitsFrom([{ id: 'validation.geometry.cableEndGapMeters', value: 5000 }]);
    expect(findGeometryProblems(data, loose).filter((p) => p.rule === 'cable-end-gap')).toHaveLength(0);
  });

  it('never stores a customer position or name for a cable ending at a customer', () => {
    const data = {
      ...base(),
      customers: [customer({ id: 'CU-1', name: 'Asha Rao', lat: 17.5, lng: 78.5 })],
      cables: [line('DROP', [[17.4, 78.4], [17.45, 78.45]], { endEquipmentId: 'CU-1' })],
    };
    const gap = findGeometryProblems(data).find((p) => p.rule === 'cable-end-gap' && p.relatedIds?.includes('CU-1'))!;
    expect(gap.message).toContain('customer CU-1');
    expect(gap.message).not.toContain('Asha');
    expect(gap.lat).not.toBe(17.5);
  });

  it('finds items outside every drawn zone, only when zones have boundaries', () => {
    const square: LatLng[] = [[17.39, 78.39], [17.39, 78.405], [17.405, 78.405], [17.405, 78.39]];
    expect(pointInRing([17.4, 78.4], square)).toBe(true);
    expect(pointInRing([17.41, 78.4], square)).toBe(false);
    const noBoundary = { ...base(), zones: [{ id: 'Z', name: 'Z', areaCode: 'Z', coverageSqKm: 0, homePassed: 0, connectedCustomers: 0, feederCableCount: 0, fatCount: 0, penetrationRatePct: 0, status: 'Operational' as const, boundaryCoords: [] as LatLng[] }] };
    expect(findGeometryProblems(noBoundary).some((p) => p.rule === 'asset-outside-zones')).toBe(false);
    const withBoundary = { ...noBoundary, zones: [{ ...noBoundary.zones[0], boundaryCoords: square }] };
    const outside = findGeometryProblems(withBoundary).filter((p) => p.rule === 'asset-outside-zones');
    expect(outside.map((p) => p.targetId)).toEqual(['B']);
  });

  it('finds two cables with the same ends along the same line, once per pair, with the routes settings', () => {
    const pts: LatLng[] = [[17.4, 78.4], [17.41, 78.4]];
    const data = { ...base(), cables: [line('C-1', pts), line('C-2', [[17.4, 78.40001], [17.41, 78.40001]])] };
    const dups = findGeometryProblems(data).filter((p) => p.rule === 'route-duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ targetId: 'C-1', relatedIds: ['C-2'] });
    const strict = checkLimitsFrom([{ id: 'osp.duplicateRoute.corridorMeters', value: 0.1 }]);
    expect(findGeometryProblems(data, strict).filter((p) => p.rule === 'route-duplicate')).toHaveLength(0);
  });

  it('takes ONT levels from the optical settings and ignores impossible values', () => {
    const limits = checkLimitsFrom([{ id: 'optical.rx.sensitivity', value: -30 }, { id: 'validation.mapCheck.lengthDifferencePercent', value: 250 }]);
    expect(limits.mapCheck.rxLowDbm).toBe(-30);
    expect(limits.mapCheck.lengthDifferenceRatio).toBe(0.1);
    expect(resolveValidationSettings().cableEndGapMeters).toBe(50);
  });
});

describe('stored findings', () => {
  const problems = () => collectValidationProblems({ ...base(), cables: [line('C-G', [[17.4, 78.4], [17.42, 78.4]])] });

  it('opens a finding once, keeps it when found again, and marks it no longer found, never deleting it', () => {
    const first = reconcileFindings([], problems(), ctx);
    expect(first.summary.opened).toBe(1);
    const stored = first.upserts;
    expect(stored[0]).toMatchObject({ state: 'open', presence: 'found', rule: 'cable-end-gap' });
    const again = reconcileFindings(stored, problems(), ctx);
    expect(again.upserts).toHaveLength(0);
    const gone = reconcileFindings(stored, [], { now: new Date(2026, 10, 5) });
    expect(gone.upserts).toHaveLength(1);
    expect(gone.upserts[0]).toMatchObject({ id: stored[0].id, presence: 'no_longer_found', state: 'open' });
    expect(gone.upserts[0].history.map((h) => h.event)).toEqual(['found', 'not_found']);
    const back = reconcileFindings(gone.upserts, problems(), ctx);
    expect(back.upserts[0].presence).toBe('found');
    expect(back.upserts[0].history.at(-1)!.event).toBe('found_again');
  });

  it('records who, when and a note; a fixed finding found again opens again; fine-as-it-is stays', () => {
    const stored = reconcileFindings([], problems(), ctx).upserts;
    let data: NetworkData = { ...base(), validationFindings: stored };
    expect(acknowledgeFinding(data, stored[0].id, '  ', ctx).ok).toBe(false);
    const fixed = resolveFinding(data, stored[0].id, 'Moved the line end to the box.', ctx);
    if (!fixed.ok) throw new Error(fixed.error.message);
    expect(fixed.value).toMatchObject({ state: 'resolved', stateBy: 'Priya (engineer)', stateNote: 'Moved the line end to the box.' });
    expect(fixed.audit[0].assetType).toBe('ValidationFinding');
    data = applyPatch(data, fixed.patch);
    const rerun = reconcileFindings(data.validationFindings!, problems(), ctx);
    expect(rerun.summary.reopened).toBe(1);
    expect(rerun.upserts[0].state).toBe('open');
    const fine = acknowledgeFinding({ ...data, validationFindings: rerun.upserts }, stored[0].id, 'A real loop at the pole.', ctx);
    if (!fine.ok) throw new Error(fine.error.message);
    expect(fine.audit[0].action).toBe('WARNING_ACCEPTED');
    const after = reconcileFindings([fine.value], problems(), ctx);
    expect(after.upserts).toHaveLength(0);
    expect(reopenFinding({ ...data, validationFindings: [fine.value] }, stored[0].id, 'Pole was moved.', ctx).ok).toBe(true);
  });

  it('refuses a deleted finding, a decision with no note, and history rewritten', () => {
    const stored = reconcileFindings([], problems(), ctx).upserts[0];
    const lookup = (id: string) => (id === stored.id ? stored : undefined);
    expect(checkChangeSetValidationFindings({ deletes: { validationFindings: [stored.id] } }, lookup)[0].message).toMatch(/never deleted/);
    const noNote: ValidationFinding = { ...stored, state: 'resolved', stateBy: 'x', stateAt: NOW.toISOString() };
    expect(checkChangeSetValidationFindings({ upserts: { validationFindings: [noNote] } }, lookup)[0].message).toMatch(/who, when and a note/);
    const rewritten: ValidationFinding = { ...stored, history: [{ ...stored.history[0], note: 'changed' }] };
    expect(checkChangeSetValidationFindings({ upserts: { validationFindings: [rewritten] } }, lookup)[0].message).toMatch(/history can only grow/);
    const retargeted: ValidationFinding = { ...stored, targetId: 'OTHER' };
    expect(checkChangeSetValidationFindings({ upserts: { validationFindings: [retargeted] } }, lookup)[0].message).toMatch(/cannot be changed/);
    const grown: ValidationFinding = { ...stored, history: [...stored.history, { at: NOW.toISOString(), event: 'not_found', by: 'Map check' }], presence: 'no_longer_found' };
    expect(checkChangeSetValidationFindings({ upserts: { validationFindings: [grown] } }, lookup)).toEqual([]);
  });

  it('a restore with a decision that has no who is listed as a problem', () => {
    const data = createSampleNetwork();
    const stored = reconcileFindings([], problems(), ctx).upserts[0];
    data.validationFindings = [{ ...stored, state: 'acknowledged' }];
    expect(checkRestoredNetwork(data).counts.findings).toBe(1);
  });

  it('stores the map check sentence with customers by id, and no customer position', () => {
    const data = { ...base(), customers: [customer({ id: 'CU-9', name: 'Ravi Kumar', lat: 17.5, lng: 78.5 })] };
    expect(scrubCustomerNames('Customer "Ravi Kumar" shows 0 dBm.', new Map([['Ravi Kumar', 'CU-9']]))).toBe('Customer customer CU-9 shows 0 dBm.');
    const [p] = problemsFromMapCheck([{ severity: 'warning', rule: 'rx-looks-fake', id: 'CU-9', message: 'Customer "Ravi Kumar" shows 0 dBm.' }], data);
    expect(p.message).not.toContain('Ravi');
    expect(p.lat).toBeUndefined();
    expect(p.targetCollection).toBe('customers');
    expect(p.fix).toMatch(/real light reading/);
    // The geometry rule replaces the script's own cable-end-far, so one problem is listed once.
    expect(problemsFromMapCheck([{ severity: 'warning', rule: 'cable-end-far', id: 'C', message: 'x' }], data)).toEqual([]);
  });
});

describe('trace report', () => {
  it('writes every step with its state, through the safe CSV writer, and never a customer position', () => {
    const data = {
      ...emptyNetwork(),
      equipment: [equipment({ id: 'OLT-1', type: 'OLT', lat: 17.4, lng: 78.4 })],
      customers: [customer({ id: 'CU-1', name: '=HYPERLINK("x")', lat: 17.5, lng: 78.5, dropCableId: 'D-1', fiberCore: 1 })],
      cables: [cable({ id: 'D-1', name: 'D-1', fiberCount: 2, coordinates: [[17.4, 78.4], [17.5, 78.5]], cores: [] })],
    };
    const result = traceNetwork(data, { type: 'customer_to_olt', from: { type: 'customer', id: 'CU-1' } });
    const report = buildTraceReport(result, NOW);
    expect(report.rows.length).toBe(result.counts.steps + result.paths[0].steps.filter((s) => s.kind === 'note').length);
    expect(report.rows.find((r) => r.kind === 'Customer')!.position).toBe('Not shown');
    const csv = traceReportCsv(report);
    expect(csv).toContain(`"'=HYPERLINK(""x"") (CU-1)"`);
    expect(csv.split('\r\n')[0]).toContain('State');
    expect(buildTraceGraph(data).index.connections.length).toBeGreaterThan(0);
  });
});
