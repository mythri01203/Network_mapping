import type { NetworkData } from '../src/domain/command';
import { buildCores } from '../src/domain/defaults';
import type {
  Cable,
  Customer,
  Equipment,
  Fault,
  JointClosure,
  SpliceRecord,
  Splitter,
  WorkOrder,
} from '../src/model/types';

/** Fixed clock for deterministic IDs and dates (local time). */
export const NOW = new Date(2026, 10, 4, 9, 30);

export const equipment = (overrides: Partial<Equipment> & Pick<Equipment, 'id' | 'type'>): Equipment => ({
  name: overrides.id,
  category: 'Fiber Distribution',
  lat: 17.4,
  lng: 78.4,
  area: 'Test Area',
  street: 'Test Street',
  status: 'Active',
  images: [],
  installedDate: '2026-01-01',
  ...overrides,
});

export const cable = (overrides: Partial<Cable> & Pick<Cable, 'id'>): Cable => ({
  name: overrides.id,
  type: 'Distribution Fiber',
  fiberCount: 12,
  lengthMeters: 1000,
  installationType: 'Aerial',
  owner: 'Test',
  installationDate: '2026-01-01',
  status: 'Active',
  coordinates: [],
  cores: [],
  cableCategory: 'Fiber',
  ...overrides,
});

export const splitter = (overrides: Partial<Splitter> & Pick<Splitter, 'id' | 'terminalBoxId'>): Splitter => ({
  name: overrides.id,
  ratio: '1:8',
  insertionLossDb: 10.5,
  status: 'Active',
  inputPort: { id: `${overrides.id}-IN` },
  outputPorts: Array.from({ length: 8 }, (_, i) => ({
    portNumber: i + 1,
    label: `OUT-${i + 1}`,
    status: 'Available' as const,
  })),
  ...overrides,
});

export const customer = (overrides: Partial<Customer> & Pick<Customer, 'id'>): Customer => ({
  name: overrides.id,
  mobile: '',
  address: '',
  area: 'Test Area',
  lat: 17.4,
  lng: 78.4,
  serviceType: 'Fiber Broadband',
  plan: 'Test Plan',
  status: 'Active',
  installationDate: '2026-01-01',
  oltId: '',
  ponPort: '',
  feederCableId: '',
  distributionCableId: '',
  terminalBoxId: '',
  splitterId: '',
  splitterOutputPort: 1,
  dropCableId: '',
  fiberCore: 1,
  ontSerialNumber: `ONT-${overrides.id}`,
  routerModel: 'Test ONT',
  ipAddress: '',
  rxOpticalPowerDbm: -20,
  ...overrides,
});

export const splice = (overrides: Partial<SpliceRecord> & Pick<SpliceRecord, 'id'>): SpliceRecord => ({
  inputCableId: 'CBL-A',
  inputCableName: 'Cable A',
  inputCore: 1,
  outputCableId: 'CBL-B',
  outputCableName: 'Cable B',
  outputCore: 1,
  spliceLossDb: 0.05,
  status: 'Spliced',
  technician: 'Tech',
  date: '2026-01-01',
  ...overrides,
});

export const closure = (overrides: Partial<JointClosure> & Pick<JointClosure, 'id'>): JointClosure => ({
  name: overrides.id,
  closureType: 'Horizontal In-line',
  lat: 17.4,
  lng: 78.4,
  area: 'Test Area',
  entryPortsCount: 2,
  exitPortsCount: 2,
  installationDate: '2026-01-01',
  technician: 'Tech',
  splices: [],
  images: [],
  ...overrides,
});

export const fault = (overrides: Partial<Fault> & Pick<Fault, 'id'>): Fault => ({
  title: overrides.id,
  type: 'Fiber Cut',
  severity: 'High',
  status: 'Reported',
  affectedLocation: { lat: 17.4, lng: 78.4 },
  affectedCustomerIds: [],
  affectedCores: [],
  affectedSplitterPorts: [],
  description: '',
  reportedAt: '2026-11-01 08:00',
  images: [],
  ...overrides,
});

export const workOrder = (overrides: Partial<WorkOrder> & Pick<WorkOrder, 'id'>): WorkOrder => ({
  title: overrides.id,
  type: 'Repair',
  priority: 'Medium',
  status: 'Pending',
  technicianName: 'Unassigned',
  technicianPhone: '',
  scheduledDate: '2026-11-01',
  notes: '',
  photos: [],
  ...overrides,
});

export const emptyNetwork = (): NetworkData => ({
  equipment: [],
  cables: [],
  splitters: [],
  closures: [],
  customers: [],
  faults: [],
  workOrders: [],
  zones: [],
  documents: [],
});

/**
 * OLT-01 (PON-01) ?FEED-01? FDT-01 ?DIST-01? FAT-01 [SPL-01, 1:8]
 * plus one connected customer CUST-001 on SPL-01 port 1.
 */
export const smallNetwork = (): NetworkData => ({
  ...emptyNetwork(),
  equipment: [
    equipment({
      id: 'OLT-01',
      type: 'OLT',
      category: 'Central Office',
      lat: 17.4,
      lng: 78.4,
      ponPorts: [
        {
          id: 'PON-01',
          portNumber: 1,
          status: 'Active',
          connectedFeederCableId: 'FEED-01',
          connectedCustomersCount: 1,
        },
      ],
    }),
    equipment({ id: 'FDT-01', type: 'FDT', lat: 17.41, lng: 78.41 }),
    equipment({ id: 'FAT-01', type: 'FAT', lat: 17.42, lng: 78.42, totalPorts: 8 }),
  ],
  cables: [
    cable({
      id: 'FEED-01',
      type: 'Main Feeder Fiber',
      startEquipmentId: 'OLT-01',
      endEquipmentId: 'FDT-01',
      coordinates: [
        [17.4, 78.4],
        [17.41, 78.41],
      ],
      cores: buildCores(12),
    }),
    cable({
      id: 'DIST-01',
      startEquipmentId: 'FDT-01',
      endEquipmentId: 'FAT-01',
      coordinates: [
        [17.41, 78.41],
        [17.42, 78.42],
      ],
      cores: buildCores(12),
    }),
  ],
  splitters: [
    splitter({
      id: 'SPL-01',
      terminalBoxId: 'FAT-01',
      inputPort: { id: 'SPL-01-IN', connectedCableId: 'DIST-01', connectedCore: 1 },
      outputPorts: Array.from({ length: 8 }, (_, i) =>
        i === 0
          ? { portNumber: 1, label: 'OUT-1', status: 'Occupied' as const, connectedCustomerId: 'CUST-001' }
          : { portNumber: i + 1, label: `OUT-${i + 1}`, status: 'Available' as const },
      ),
    }),
  ],
  customers: [
    customer({
      id: 'CUST-001',
      oltId: 'OLT-01',
      ponPort: 'PON-01',
      feederCableId: 'FEED-01',
      distributionCableId: 'DIST-01',
      terminalBoxId: 'FAT-01',
      splitterId: 'SPL-01',
      splitterOutputPort: 1,
      ipAddress: '100.64.0.5',
    }),
  ],
});
