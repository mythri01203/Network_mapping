import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  affectedByElement,
  buildImpactIndex,
  buildOltPonPorts,
  type Customer,
  CUSTOMER_HIDDEN_TEXT,
  type DeviceStatus,
  deviceStatusBoard,
  type Equipment,
  type MonitoringSource,
  NO_LIVE_CONNECTION,
  type Ont,
  type OnuStatus,
} from '@fibergis/shared';

import { ImpactList } from '../faults/SuspectedTab';
import { NocBoardView } from './NocPanel';

/** Network mapping Phase 20: the NOC screen and the fault impact list, at phone width rules. */

/** Server rendering reads a store's first state, so the board is worked out here and passed in. */
const render = (data: Parameters<typeof deviceStatusBoard>[0]) =>
  renderToStaticMarkup(<NocBoardView board={deviceStatusBoard(data)} statusStaleMinutes={15} customers={data.customers} equipment={data.equipment} />);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const olt = (): Equipment => {
  const base: Equipment = { id: 'OLT-A', name: 'Hub OLT', type: 'OLT', category: 'Central Office', lat: 17.4, lng: 78.4, area: '', street: '', status: 'Active', technology: 'GPON', totalPorts: 2, images: [], installedDate: '' };
  return { ...base, ponPorts: buildOltPonPorts(base).map((p) => ({ ...p, vendorAddress: `gpon 0/1/${p.portNumber - 1}` })) };
};
const customer = (id: string, name: string, ontId: string, extra: Partial<Customer> = {}): Customer => ({
  id,
  name,
  mobile: '',
  address: '',
  area: '',
  lat: 17.41,
  lng: 78.41,
  serviceType: 'Fiber Broadband',
  plan: '',
  status: 'Active',
  installationDate: '',
  oltId: 'OLT-A',
  ponPort: 'PON-01',
  feederCableId: '',
  distributionCableId: '',
  terminalBoxId: '',
  splitterId: '',
  splitterOutputPort: 0,
  dropCableId: '',
  fiberCore: 0,
  ontSerialNumber: '',
  routerModel: '',
  ipAddress: '',
  ontId,
  ...extra,
});
const ont = (id: string): Ont => ({ id, arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: minutesAgo(10_000), oltId: 'OLT-A', ponPortId: 'PON-01' });
const source: MonitoringSource = { id: 'MON-1', name: 'NMS push', kind: 'push', isTest: false, enabled: true, createdAt: minutesAgo(1000) };
const status = (id: string, ontId: string, state: OnuStatus['state'], m: number): OnuStatus => ({ id, ontId, matchedBy: 'onu_address', origin: 'device_reported', sourceId: source.id, isTest: false, deviceTime: minutesAgo(m), receivedAt: minutesAgo(m), state });
const portDown: DeviceStatus = {
  id: 'DV-1',
  target: 'pon_port',
  oltId: 'OLT-A',
  ponPortId: 'PON-01',
  matchedBy: 'olt_id',
  oltKey: 'OLT-A',
  portAddress: 'gpon 0/1/0',
  origin: 'device_reported',
  sourceId: source.id,
  isTest: false,
  deviceTime: minutesAgo(1),
  receivedAt: minutesAgo(1),
  state: 'down',
  losCount: 2,
};

describe('NOC screen', () => {
  it('says "No live connection" and counts nobody online when nothing was sent', () => {
    const html = render({ equipment: [olt()], customers: [customer('C-1', 'Asha', 'ONT-1')], onts: [ont('ONT-1')] });
    expect(html).toContain('data-testid="noc-no-live"');
    expect(html).toContain(NO_LIVE_CONNECTION);
    expect(html).toContain('Port status: not sent by the device');
    expect(html).not.toContain('data-testid="noc-live"');
  });

  it('lists the port with the device status, LOS count, alarms and customers hit; buttons are 48 px', () => {
    const html = render({
      equipment: [olt()],
      customers: [customer('C-1', 'Asha', 'ONT-1'), customer('C-2', CUSTOMER_HIDDEN_TEXT, 'ONT-2', { hiddenFields: ['name'] })],
      onts: [ont('ONT-1'), ont('ONT-2')],
      monitoringSources: [source],
      onuStatuses: [status('S-1', 'ONT-1', 'los', 2), status('S-2', 'ONT-2', 'los', 2)],
      deviceStatuses: [portDown],
    });
    expect(html).toContain('data-testid="noc-live"');
    expect(html).toContain('Hub OLT · gpon 0/1/0');
    expect(html).toContain('Device says: Down');
    expect(html).toContain('Device says 2 LOS');
    expect(html).toMatch(/data-testid="noc-port-los"><div[^>]*>2</);
    expect(html).toMatch(/<strong>2<\/strong> of 2 customer\(s\) on this port hit/);
    expect(html).toContain('Customers hit (2)');
    expect(html).toContain('Show on map');
    for (const button of html.match(/<button[^>]*>/g) ?? []) expect(button).toMatch(/min-h-\[48px\]/);
    // Names are not printed until asked for, and never in the summary line.
    expect(html).not.toContain('Asha');
  });
});

describe('fault impact list', () => {
  it('shows "Hidden for your role" for a hidden name and offers the list of what lies below', () => {
    const data = {
      equipment: [olt()],
      cables: [],
      splitters: [],
      closures: [],
      customers: [customer('C-2', CUSTOMER_HIDDEN_TEXT, 'ONT-2', { hiddenFields: ['name'] })],
    };
    const impact = affectedByElement(buildImpactIndex(data), { type: 'olt', id: 'OLT-A' }, { downstream: true });
    const html = renderToStaticMarkup(<ImpactList impact={{ ...impact, affected: [{ customerId: 'C-2', name: CUSTOMER_HIDDEN_TEXT, nameHidden: true, pathComplete: false, services: [] }] }} />);
    expect(html).toContain(CUSTOMER_HIDDEN_TEXT);
    expect(html).toContain('data-testid="downstream"');
    expect(html).toMatch(/Below it on recorded links: 0 item\(s\), 2 port\(s\), 0 fibre\(s\)/);
  });
});
