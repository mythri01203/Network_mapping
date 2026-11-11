import { describe, expect, it } from 'vitest';

import type { AuditEvent } from '../src/domain/recordHistory';
import { changeHistoryReport, recordReports, testRecordKeys } from '../src/domain/recordReports';
import { buildReportDocument, reportAboutRows, reportFiltersText } from '../src/domain/reportDocument';
import { buildReports } from '../src/domain/reports';
import type { Attachment, Duct, Ont, Span } from '../src/model/types';
import type { ValidationFinding } from '../src/model/validationFindingSchemas';
import { createSampleNetwork } from '../src/sample';
import { cable, closure, customer, equipment, smallNetwork, splice, splitter } from './fixtures';

/** Network mapping Phase 22: the missing M30 reports, built from records only. */

const byId = (tables: ReturnType<typeof recordReports>, id: string) => tables.find((t) => t.id === id)!;

const base = () => ({ ...smallNetwork(), spans: [] as Span[], attachments: [] as Attachment[], ducts: [] as Duct[], slackLoops: [], permissions: [], onts: [] as Ont[], validationFindings: [] as ValidationFinding[] });

describe('recordReports', () => {
  it('every report states its sources and its settings, and buildReports includes them', () => {
    const tables = buildReports(createSampleNetwork(), {}, '2026-11-11');
    for (const id of ['cable-inventory', 'disconnected-cables', 'orphans', 'osp-summary', 'pole-attachments', 'duct-occupancy', 'splicing', 'odf-ports', 'customer-paths', 'validation-findings']) {
      const t = tables.find((r) => r.id === id);
      expect(t, id).toBeDefined();
      expect(t!.sources!.length, id).toBeGreaterThan(0);
      expect(Array.isArray(t!.settingsUsed), id).toBe(true);
    }
    // Earlier reports get their sources too.
    expect(tables.every((t) => Array.isArray(t.sources))).toBe(true);
    expect(tables.find((t) => t.id === 'inventory')!.sources).toContain('Network items');
  });

  it('cable inventory says "Not recorded" for missing facts, never zero, and keeps lengths apart', () => {
    const data = base();
    data.cables = [cable({ id: 'C-1', owner: '', installationType: undefined, coordinates: [], startEquipmentId: 'GONE' })];
    const row = byId(recordReports(data), 'cable-inventory').rows[0];
    expect(row).toMatchObject({ owner: 'Not recorded', installation: 'Not recorded', drawn: 'No line drawn', sheath: 'Not recorded', optical: 'Not recorded', from: 'GONE (not on record)', to: 'Not recorded', scheme: 'Not known' });
  });

  it('lists a cable with a missing end or no fibre links, and not a fully linked one', () => {
    const data = base();
    data.cables.push(cable({ id: 'LOOSE', endEquipmentId: 'FAT-01' }));
    const table = byId(recordReports(data), 'disconnected-cables');
    const loose = table.rows.find((r) => r.id === 'LOOSE')!;
    expect(loose.problem).toMatch(/Start end not recorded/);
    expect(loose.problem).toMatch(/No fibre link recorded/);
    expect(loose.fed).toBe('0 of 12');
    // DIST-01 feeds SPL-01 on fibre 1: it has a fibre link, both ends, so it is not listed.
    expect(table.rows.find((r) => r.id === 'DIST-01')).toBeUndefined();
  });

  it('finds orphans by recorded links only, never by position, and names customers by id only', () => {
    const data = base();
    // Same position as FAT-01, but nothing links it.
    data.equipment.push(equipment({ id: 'FAT-NEAR', type: 'FAT', lat: 17.42, lng: 78.42 }));
    data.customers.push(customer({ id: 'CUST-LONE', name: 'Lakshmi Devi', fiberCore: 0 }));
    data.splitters.push(splitter({ id: 'SPL-X', terminalBoxId: 'BOX-GONE' }));
    const table = byId(recordReports(data), 'orphans');
    const ids = table.rows.map((r) => r.id);
    expect(ids).toContain('FAT-NEAR');
    expect(ids).toContain('CUST-LONE');
    expect(ids).toContain('SPL-X');
    expect(ids).not.toContain('FAT-01');
    expect(JSON.stringify(table)).not.toContain('Lakshmi');
  });

  it('pole room is not known without an allowance, and counts built and planned apart', () => {
    const data = base();
    data.equipment.push(equipment({ id: 'P-1', type: 'Telecom Pole', category: 'Supporting Infrastructure', attachmentCapacity: 1 }), equipment({ id: 'P-2', type: 'Telecom Pole', category: 'Supporting Infrastructure' }));
    data.attachments = [
      { id: 'AT-1', cableId: 'FEED-01', structureId: 'P-1', status: 'built', basis: 'inspected', createdAt: '2026-11-01' },
      { id: 'AT-2', cableId: 'DIST-01', structureId: 'P-1', status: 'planned', basis: 'office_drawn', createdAt: '2026-11-01' },
    ];
    const rows = byId(recordReports(data), 'pole-attachments').rows;
    expect(rows.find((r) => r.id === 'P-1')).toMatchObject({ built: 1, planned: 1, allowance: 1, room: 'Over by 1', permission: 'None recorded' });
    expect(rows.find((r) => r.id === 'P-2')).toMatchObject({ built: 0, allowance: 'Not recorded', room: 'Not known (allowance not recorded)' });
  });

  it('duct fill is worked out only from recorded diameters and the settings are stated', () => {
    const data = base();
    data.cables = data.cables.map((c) => (c.id === 'FEED-01' ? { ...c, outerDiameterMm: 10 } : c));
    data.ducts = [
      { id: 'D-1', name: 'Duct 1', coordinates: [[17.4, 78.4], [17.41, 78.41]], status: 'built', basis: 'inspected', innerDiameterMm: 40, cableIds: ['FEED-01'], subducts: [], createdAt: '2026-11-01' },
      { id: 'D-2', name: 'Duct 2', coordinates: [[17.4, 78.4], [17.41, 78.41]], status: 'built', basis: 'inspected', cableIds: ['DIST-01'], subducts: [], createdAt: '2026-11-01' },
    ];
    const table = byId(recordReports(data), 'duct-occupancy');
    expect(table.rows.find((r) => r.duct === 'D-1')!.fill).toBe('6.3%');
    expect(table.rows.find((r) => r.duct === 'D-2')!.fill).toMatch(/Inside diameter not recorded/);
    expect(table.rows.find((r) => r.duct === 'D-2')!.condition).toBe('Not checked');
    expect(table.settingsUsed![0]).toMatch(/Poles and routes settings/);
  });

  it('splicing counts measured losses only from a meter and keeps losses with no origin apart', () => {
    const data = base();
    data.closures = [
      closure({
        id: 'CL-1',
        splices: [
          splice({ id: 'S-1', spliceLossDb: 0.04, lossSource: 'field_measured' }),
          splice({ id: 'S-2', spliceLossDb: 0.1, lossSource: 'designed' }),
          splice({ id: 'S-3', spliceLossDb: 0.3 }),
          splice({ id: 'S-4', spliceLossDb: undefined }),
          splice({ id: 'S-5', retiredAt: '2026-11-01', retiredReason: 'Re-spliced' }),
          splice({ id: 'S-6', enteredInError: true, retiredAt: '2026-11-01' }),
        ],
      }),
    ];
    const row = byId(recordReports(data), 'splicing').rows[0];
    expect(row).toMatchObject({ active: 4, measured: 1, other: 1, noOrigin: 1, noLoss: 1, retired: 1, struck: 1, average: '0.04 dB (from 1)', trays: 'Not recorded' });
  });

  it('ODF ports show links as recorded and flag status words that disagree', () => {
    const data = base();
    data.equipment.push(
      equipment({
        id: 'ODF-1',
        type: 'ODF',
        category: 'Central Office',
        odfPanels: [
          {
            id: 'PN-1',
            label: 'Panel A',
            ports: [
              { id: 'OP-1', number: 1, status: 'in_use' },
              { id: 'OP-2', number: 2, status: 'available', feederCableId: 'FEED-01', feederCore: 2, patch: { oltId: 'OLT-01', ponPortId: 'PON-01', patchedAt: '2026-11-01' } },
            ],
          },
        ],
      }),
    );
    const rows = byId(recordReports(data), 'odf-ports').rows;
    expect(rows[0]).toMatchObject({ rear: 'Not recorded', patch: 'None', check: 'Marked in use, nothing linked' });
    expect(rows[1]).toMatchObject({ rear: 'FEED-01, fibre 2', patch: 'OLT-01 PON-01', cord: 'Not recorded', check: 'Patched but marked free' });
  });

  it('customer paths name the first missing link with the customer id, never the name', () => {
    const data = base();
    data.customers = [customer({ id: 'CUST-9', name: 'Ravi Kumar', dropCableId: '', fiberCore: 0 })];
    const table = byId(recordReports(data), 'customer-paths');
    expect(table.rows[0]).toMatchObject({ id: 'CUST-9', reaches: 'No' });
    expect(String(table.rows[0].gap)).toContain('Customer CUST-9');
    expect(JSON.stringify(table)).not.toContain('Ravi');
  });

  it('OSP summary never calls a map distance measured', () => {
    const data = base();
    data.equipment.push(equipment({ id: 'P-1', type: 'Telecom Pole', category: 'Supporting Infrastructure' }), equipment({ id: 'P-2', type: 'Telecom Pole', category: 'Supporting Infrastructure', lat: 17.401 }));
    data.spans = [{ id: 'SP-1', name: 'P-1 to P-2', fromStructureId: 'P-1', toStructureId: 'P-2', status: 'built', basis: 'inspected', createdAt: '2026-11-01' }];
    const span = byId(recordReports(data), 'osp-summary').rows.find((r) => r.kind === 'Span (pole to pole)')!;
    expect(span.details).toMatch(/measured length on 0 of 1/);
    expect(span.details).toMatch(/drawn, not measured/);
  });

  it('stored findings are listed with what people decided', () => {
    const data = base();
    data.validationFindings = [
      { id: 'VF-1', key: 'k', rule: 'cable-end-missing', severity: 'warning', source: 'map_check', targetCollection: 'cables', targetId: 'C-1', message: 'No end', fix: 'Link it', state: 'acknowledged', stateBy: 'Asha', stateAt: '2026-11-02T10:00:00Z', stateNote: 'Planned cable', presence: 'found', presenceAt: '2026-11-02', firstFoundAt: '2026-11-01T00:00:00Z', history: [], createdAt: '2026-11-01' },
    ];
    const row = byId(recordReports(data), 'validation-findings').rows[0];
    expect(row).toMatchObject({ level: 'Warning', about: 'cables C-1', state: 'Checked: fine as it is', decided: 'Asha, 2026-11-02: Planned cable' });
  });
});

describe('changeHistoryReport', () => {
  const event = (seq: number, extra: Partial<AuditEvent> = {}): AuditEvent => ({
    seq,
    at: '2026-11-05T10:00:00.000Z',
    actorId: 'u1',
    actorName: 'Asha',
    actorRole: 'engineer',
    source: 'changes',
    collection: 'cables',
    recordId: `C-${seq}`,
    op: 'update',
    actions: ['edit'],
    revision: seq,
    diff: [{ field: 'name', before: '"old"', after: '"new"' }],
    ...extra,
  });

  it('shows field names but never their values, newest first, and filters by date', () => {
    const report = changeHistoryReport([event(1), event(2, { at: '2026-10-01T10:00:00.000Z' }), event(3, { diff: [{ field: 'mobile', before: '"98450"', after: '"98451"' }] })], { filters: { from: '2026-11-01' } });
    expect(report.rows.map((r) => r.record)).toEqual(['C-3', 'C-1']);
    expect(report.rows[0].fields).toBe('mobile');
    expect(JSON.stringify(report)).not.toContain('98450');
  });

  it('leaves changes to TEST records out unless asked, and says how many', () => {
    const keys = testRecordKeys({ alarms: [{ id: 'AL-T', isTest: true }, { id: 'AL-R' }] });
    const events = [event(1, { collection: 'alarms', recordId: 'AL-T' }), event(2, { collection: 'alarms', recordId: 'AL-R' })];
    const without = changeHistoryReport(events, { testRecordKeys: keys });
    expect(without.rows.map((r) => r.record)).toEqual(['AL-R']);
    expect(without.notes.join(' ')).toMatch(/TEST records left out \(1\)/);
    expect(changeHistoryReport(events, { testRecordKeys: keys, filters: { includeTest: true } }).rows).toHaveLength(2);
  });

  it('says when only the newest changes were read', () => {
    expect(changeHistoryReport([event(1), event(2)], { limit: 2 }).notes.join(' ')).toMatch(/Only the newest 2 changes/);
  });
});

describe('buildReportDocument', () => {
  it('states sources, settings, filters and TEST choice, and adds nothing to the rows', () => {
    const table = byId(recordReports(base()), 'duct-occupancy');
    const doc = buildReportDocument(table, { filters: { area: 'North' }, generatedAt: new Date('2026-11-11T10:00:00Z') });
    const facts = Object.fromEntries(doc.facts);
    expect(facts['Made from']).toMatch(/Ducts/);
    expect(facts['Settings used']).toMatch(/fill warning levels/);
    expect(facts.Filters).toBe('area "North", TEST data left out');
    expect(doc.rows).toBe(table.rows);
    expect(doc.footer).toMatch(/2026-11-11 10:00 UTC/);
    expect(reportAboutRows(doc)[0]).toEqual({ what: 'Report', value: table.title });
  });

  it('says "none" when a report used no settings', () => {
    const doc = buildReportDocument(byId(recordReports(base()), 'orphans'), { filters: {}, generatedAt: new Date() });
    expect(Object.fromEntries(doc.facts)['Settings used']).toBe('None: counted from the records only');
    expect(reportFiltersText({ includeTest: true })).toBe('every area, TEST data included');
  });
});
