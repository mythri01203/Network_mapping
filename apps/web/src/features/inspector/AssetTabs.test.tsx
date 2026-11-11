import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { assetHistory, type AuditLog, type CatalogComponent, type Customer, effectiveSpecs, type Equipment, type Splitter } from '@fibergis/shared';

import { customersOnItem, SLACK_LOOP_SPEC_ROWS, SPLICE_JOINT_SPEC_ROWS } from './assetTabData';
import { HistoryList, MaintenanceSection } from './AssetTabs';
import { RecordedSpecRows } from './EquipmentInspector';

// Leaflet needs a browser window; nothing here draws the map.
vi.mock('leaflet', () => ({ default: {} }));

const box = (overrides: Partial<Equipment> = {}): Equipment => ({
  id: 'FAT-T1',
  name: 'FAT-01',
  type: 'FAT',
  category: 'Fiber Distribution',
  lat: 12.9,
  lng: 77.6,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
  ...overrides,
});

const log = (id: string, assetId: string, action: string, details: string): AuditLog => ({
  id,
  timestamp: '2026-11-10 09:00:00',
  user: 'Ravi',
  role: 'Network Engineer',
  action,
  details,
  assetId,
  assetType: 'Equipment',
});

describe('History tab', () => {
  it('shows only real audit entries for this item', () => {
    const lines = assetHistory(box(), [log('L1', 'FAT-T1', 'EQUIPMENT_UPDATED', 'Lid replaced'), log('L2', 'OTHER-9', 'EQUIPMENT_CREATED', 'Some other box')]);
    const html = renderToStaticMarkup(<HistoryList lines={lines} />);
    expect(html).toContain('Equipment updated');
    expect(html).toContain('Lid replaced');
    expect(html).toContain('Ravi');
    expect(html).not.toContain('Some other box');
    expect(html.match(/data-testid="item-history-line"/g)).toHaveLength(1);
  });

  it('says nothing is on record rather than making entries up', () => {
    const lines = assetHistory(box(), [log('L2', 'OTHER-9', 'EQUIPMENT_CREATED', 'Some other box')]);
    const html = renderToStaticMarkup(<HistoryList lines={lines} />);
    expect(html).toContain('data-testid="item-history-empty"');
    expect(html).not.toContain('item-history-line');
  });
});

describe('Maintenance tab', () => {
  it('shows "Not recorded" for a missing condition, warranty and next check', () => {
    const html = renderToStaticMarkup(<MaintenanceSection equipment={box()} />);
    expect(html.match(/Not recorded/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('No maintenance recorded.');
  });

  it('shows what was recorded', () => {
    const html = renderToStaticMarkup(
      <MaintenanceSection equipment={box({ condition: 'fair', warrantyUntil: '2030-01-31', maintenance: [{ date: '2026-11-01', by: 'Asha', what: 'Cleaned connectors' }] })} />,
    );
    expect(html).toContain('Fair: needs watching');
    expect(html).toContain('Cleaned connectors');
    expect(html).toContain('Asha');
  });
});

describe('Customers tab', () => {
  it('lists only customers whose record names this item, never ones nearby', () => {
    const base = { oltId: '', terminalBoxId: '', splitterId: '' } as Partial<Customer>;
    const customers = [
      { ...base, id: 'C1', name: 'On box', terminalBoxId: 'FAT-T1' },
      { ...base, id: 'C2', name: 'On splitter', splitterId: 'SPL-1' },
      { ...base, id: 'C3', name: 'Next door', lat: 12.9, lng: 77.6 },
    ] as Customer[];
    const splitters = [{ id: 'SPL-1', terminalBoxId: 'FAT-T1' }] as Splitter[];
    expect(customersOnItem(customers, splitters, 'FAT-T1').map((r) => [r.customer.id, r.how])).toEqual([
      ['C1', 'Box on their record'],
      ['C2', 'Splitter SPL-1 in this box'],
    ]);
  });
});

describe('slack loop and splice joint specs', () => {
  const slack = box({ id: 'SLK-1', type: 'Fiber Slack Loop', name: 'Slack 1' });

  it('show "Not recorded" with no catalogue model, never an example value', () => {
    const html = renderToStaticMarkup(<RecordedSpecRows specs={effectiveSpecs(undefined, slack)} rows={SLACK_LOOP_SPEC_ROWS} />);
    expect(html).not.toMatch(/30 mm|G\.652D|Snowshoe|20 meters/);
    expect(html.match(/Not recorded/g)).toHaveLength(3);
    const splice = renderToStaticMarkup(<RecordedSpecRows specs={[]} rows={SPLICE_JOINT_SPEC_ROWS} />);
    expect(splice).not.toMatch(/60 dB|60mm|stainless/);
    expect(splice.match(/Not recorded/g)).toHaveLength(2);
  });

  it("take values from the catalogue model and the item's own changes", () => {
    const model: CatalogComponent = {
      id: 'CAT-SLK',
      type: 'Fiber Slack Loop',
      category: 'Fiber Distribution',
      name: 'Coil bracket',
      description: '',
      iconBg: '',
      manufacturer: 'Acme',
      model: 'SB-1',
      specs: [{ key: 'Minimum bend radius', value: '40', unit: 'mm' }],
    };
    const item = { ...slack, catalogModelId: 'CAT-SLK', specOverrides: [{ key: 'Mounting', value: 'Pole bracket' }] };
    const html = renderToStaticMarkup(<RecordedSpecRows specs={effectiveSpecs(model, item)} rows={SLACK_LOOP_SPEC_ROWS} />);
    expect(html).toContain('40 mm');
    expect(html).toContain('From the catalogue model');
    expect(html).toContain('Pole bracket');
    expect(html.match(/Not recorded/g)).toHaveLength(1);
  });
});
