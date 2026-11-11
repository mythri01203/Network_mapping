import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Cable,
  combinedView,
  type Customer,
  CUSTOMER_HIDDEN_TEXT,
  type Equipment,
  type NetworkSnapshot,
  type Ont,
  resolveLogicalSettings,
  type Service,
  serviceTopology,
  type Splitter,
} from '@fibergis/shared';

import { useConfirmStore } from '../../stores/confirmStore';
import { saveBinding } from '../../stores/logicalActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { CombinedViewContent } from './CombinedViewPanel';
import { TopologyTree } from './ServiceTopologyPanel';
import { countsText, withoutLogical } from './topologyUi';

/** Network mapping Phase 14: the topology tree from the links and the physical-and-logical view. */

vi.mock('leaflet', () => ({ default: {} }));

const pristine = useNetworkStore.getState();

const eq = (id: string, type: Equipment['type'], extra: Partial<Equipment> = {}): Equipment => ({ id, name: id, type, category: 'Fiber Distribution', lat: 12.9, lng: 77.6, area: '', street: '', status: 'Active', images: [], installedDate: '', ...extra });
const cable = (id: string): Cable => ({ id, name: id, type: 'Distribution Fiber', fiberCount: 12, lengthMeters: 0, owner: '', installationDate: '', status: 'Active', coordinates: [], cores: [], cableCategory: 'Fiber' });
const person = (id: string, name: string, core: number, ontId: string): Customer => ({
  id,
  name,
  mobile: '',
  address: '',
  area: '',
  lat: 12.9,
  lng: 77.6,
  serviceType: 'Fiber Broadband',
  plan: '',
  status: 'Active',
  installationDate: '',
  oltId: 'OLT-1',
  ponPort: 'PON-01',
  feederCableId: '',
  distributionCableId: 'FDR',
  terminalBoxId: 'FAT-1',
  splitterId: 'SPL-1',
  splitterOutputPort: core,
  dropCableId: 'DROP',
  fiberCore: core,
  ontSerialNumber: '',
  routerModel: '',
  ipAddress: '',
  rxOpticalPowerDbm: 0,
  ontId,
});
const ont = (id: string, serial: string, pon: string, core: number): Ont => ({ id, serialNumber: serial, arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: '2026-11-01T00:00:00Z', oltId: 'OLT-1', ponPortId: pon, dropCableId: 'DROP', dropCore: core });
const service = (id: string, customerId: string, extra: Partial<Service> = {}): Service => ({ id, customerId, kind: 'internet', status: 'active', createdAt: '2026-11-01T00:00:00Z', ...extra });
const splitter: Splitter = {
  id: 'SPL-1',
  name: 'SPL-1',
  terminalBoxId: 'FAT-1',
  ratio: '1:8',
  insertionLossDb: 10.5,
  status: 'Active',
  inputPort: { id: 'SPL-1-IN', connectedCableId: 'FDR', connectedCore: 1 },
  outputPorts: Array.from({ length: 8 }, (_, i) => ({
    portNumber: i + 1,
    label: `OUT-${i + 1}`,
    status: (i < 2 ? 'Occupied' : 'Available') as 'Occupied' | 'Available',
    ...(i < 2 ? { connectedDropCableId: 'DROP', connectedCore: i + 1 } : {}),
  })),
};

/** OLT-1 PON-01 straight onto FDR fibre 1 → SPL-1 in FAT-1 → Asha (fibre 1, ONT registered on PON-02) and Ravi (fibre 2). */
function network(): Pick<NetworkSnapshot, 'equipment' | 'cables' | 'splitters' | 'closures' | 'customers' | 'onts' | 'services'> {
  return {
    equipment: [
      eq('OLT-1', 'OLT', {
        category: 'Central Office',
        ponPorts: [
          { id: 'PON-01', portNumber: 1, status: 'Active', connectedCustomersCount: 0, connectedFeederCableId: 'FDR', feederCore: 1 },
          { id: 'PON-02', portNumber: 2, status: 'Available', connectedCustomersCount: 0 },
        ],
      }),
      eq('FAT-1', 'FAT'),
    ],
    cables: [cable('FDR'), cable('DROP')],
    splitters: [splitter],
    closures: [],
    customers: [person('C-1', 'Asha', 1, 'ONT-1'), person('C-2', 'Ravi', 2, 'ONT-2')],
    onts: [ont('ONT-1', 'ZTEG0001', 'PON-02', 1), ont('ONT-2', 'ZTEG0002', 'PON-01', 2)],
    services: [service('SVC-1', 'C-1', { vlan: 100, profileName: 'FTTH-100' }), service('SVC-2', 'C-2')],
  };
}

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useNetworkStore.getState().replaceCollections({ ...network(), settings: [] });
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ pending: null });
});

const tree = (logical: boolean) => renderToStaticMarkup(<TopologyTree topo={serviceTopology(network())} logical={logical} onLogical={() => {}} onShow={() => {}} onCompare={() => {}} />);

describe('topology tree from the links', () => {
  it('shows counts under each step and the box a splitter sits in, with services only on the logical layer', () => {
    const off = tree(false);
    expect(off).toContain('2 customers · 2 ONTs · 1 splitter');
    expect(off).toContain('in box FAT-1');
    expect(off).not.toContain('data-testid="topo-service"');
    expect(off).not.toContain('Does not match');
    const on = tree(true);
    expect(on).toContain('data-testid="topo-service"');
    expect(on).toContain('VLAN 100');
    expect(on).toContain('✕ Does not match: The ONT record says OLT-1 PON-02, but the fibre links reach it from OLT-1 PON-01.');
    expect(on).toContain('1 ONT records that do not match the links');
  });

  it('drops only the logical nodes when the layer is off', () => {
    const topo = serviceTopology(network());
    const kinds = (nodes: typeof topo.roots): string[] => nodes.flatMap((n) => [n.kind, ...kinds(n.children)]);
    expect(kinds(topo.roots)).toContain('service');
    expect(kinds(withoutLogical(topo.roots))).not.toContain('service');
    expect(kinds(withoutLogical(topo.roots))).toContain('customer');
    expect(countsText({ customers: 0, onts: 0, splitters: 0, gaps: 1, mismatches: 2 }, false)).toBe('0 customers · 1 missing link');
  });

  it('names a customer whose name is hidden for the role by id, never "Hidden for your role" as a name', () => {
    const data = network();
    data.customers = data.customers.map((c) => (c.id === 'C-1' ? { ...c, name: CUSTOMER_HIDDEN_TEXT, hiddenFields: ['name'] } : c));
    const html = renderToStaticMarkup(<TopologyTree topo={serviceTopology(data)} logical onLogical={() => {}} onShow={() => {}} />);
    expect(html).toContain('Customer C-1 (name hidden for your role)');
    expect(html).not.toContain(`>${CUSTOMER_HIDDEN_TEXT}<`);
  });
});

describe('physical and logical side by side', () => {
  it('marks where the ONT record and the fibre links disagree, and says "Not recorded" for the rest', () => {
    const view = combinedView(network(), { kind: 'pon', oltId: 'OLT-1', ponPortId: 'PON-01' });
    const html = renderToStaticMarkup(<CombinedViewContent view={view} canEdit olts={network().equipment.filter((e) => e.type === 'OLT')} />);
    expect(html).toContain('2 customers: 1 match, 1 do not match');
    expect(html).toContain('PON port: the ONT record says OLT-1 PON-02; the fibre links reach OLT-1 PON-01.');
    expect(html).toContain('data-status="mismatch"');
    expect(html).toContain('From the fibre links');
    expect(html).toContain('Service settings as recorded');
    expect(html).toContain('Not recorded');
    expect(html).toContain('data-testid="binding-edit-SVC-2"');
    const readOnly = renderToStaticMarkup(<CombinedViewContent view={view} canEdit={false} olts={[]} />);
    expect(readOnly).not.toContain('Change service settings');
  });
});

describe('recording service settings', () => {
  it('asks first when a VLAN would be used twice on one port and the rule is on, and saves only after yes', async () => {
    useNetworkStore.getState().saveSetting({ id: 'logical.vlanUniquePerPon', value: true });
    expect(resolveLogicalSettings(useNetworkStore.getState().settings).vlanUniquePerPon).toBe(true);
    // Ravi's ONT and Asha's ONT: Asha is registered on PON-02, so use Ravi's port for both.
    useNetworkStore.setState({ onts: useNetworkStore.getState().onts.map((o) => (o.id === 'ONT-1' ? { ...o, ponPortId: 'PON-01' } : o)) });
    const pending = saveBinding('SVC-2', { vlan: 100 });
    await vi.waitFor(() => expect(useConfirmStore.getState().pending?.message).toMatch(/VLAN 100 is used by 2 services on OLT-1 PON-01/));
    useConfirmStore.getState().respond(true);
    const saved = await pending;
    expect(saved).toMatchObject({ id: 'SVC-2', vlan: 100 });
    const actions = useNetworkStore.getState().auditLogs.map((a) => a.action);
    expect(actions).toContain('SERVICE_BINDING_RECORDED');
    expect(actions).toContain('WARNING_ACCEPTED');
  });
});
