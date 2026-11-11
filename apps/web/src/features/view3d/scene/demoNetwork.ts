import {
  type Cable,
  type Customer,
  DEFAULT_OPTICAL_SETTINGS,
  type Equipment,
  type EquipmentPort,
  type LatLng,
  type MonitoringSource,
  type Ont,
  type OnuStatus,
  polylineLengthMeters,
  type PonPort,
  type Span,
  type Splitter,
  type SplitterPort,
  type SplitterRatio,
} from '@fibergis/shared';

import { makeProjection } from './geoLocal';

/**
 * The demo network behind "Load demo network": PON 1 of an 8-port GPON OLT feeding 100 houses
 * through a 1:4 → 1:4 → 1:8 cascade on electric poles (13 FATs, 128 design ports, 28 spare). It is
 * built as ordinary records and drawn through the same `toScene3D` as real data, but it is never
 * saved: it lives only in the 3D view and every record says `isSampleData`. One house has a TEST
 * "no light" status so the fault marker can be seen; it is labelled TEST everywhere.
 */

/** Layout of the reference prototype, in its units; 1 unit = 3 metres here. */
const UNIT = 3;
const CN = [24, 38, 52, 66];
const RZ = [-15, -5, 5, 15];
const NF = [4, 4, 4, 1];
const FEEDER_POLES: [number, number][] = [
  [8, 5.5],
  [13, -8],
  [18, -22],
];

export const DEMO_ORIGIN = { lat: 12.9716, lng: 77.5946 };
const DATE = '2026-01-15';

/** The demo records, with plain (mutable) arrays. Assignable to `Scene3DInput`. */
export interface DemoNetwork {
  equipment: Equipment[];
  cables: Cable[];
  splitters: Splitter[];
  closures: [];
  customers: Customer[];
  spans: Span[];
  onts: Ont[];
  onuStatuses: OnuStatus[];
  monitoringSources: MonitoringSource[];
}

export function createDemoNetwork(now = new Date()): DemoNetwork {
  const proj = makeProjection(DEMO_ORIGIN);
  const geo = (ux: number, uz: number): LatLng => {
    const g = proj.toGeo({ x: ux * UNIT, z: uz * UNIT });
    return [g.lat, g.lng];
  };
  const equipment: Equipment[] = [];
  const cables: Cable[] = [];
  const splitters: Splitter[] = [];
  const customers: Customer[] = [];
  const spans: Span[] = [];
  const onts: Ont[] = [];

  const eq = (
    id: string,
    name: string,
    type: string,
    category: Equipment['category'],
    at: LatLng,
    extra: Partial<Equipment> = {},
  ): Equipment => {
    const e: Equipment = {
      id,
      name,
      type: type as Equipment['type'],
      category,
      lat: at[0],
      lng: at[1],
      area: 'Demo area',
      street: 'Demo street',
      status: 'Active',
      images: [],
      installedDate: DATE,
      isSampleData: true,
      ...extra,
    };
    equipment.push(e);
    return e;
  };
  const cable = (
    id: string,
    name: string,
    type: Cable['type'],
    fiberCount: number,
    coords: LatLng[],
    start: string,
    end: string,
  ): Cable => {
    const c: Cable = {
      id,
      name,
      type,
      fiberCount,
      lengthMeters: Math.round(polylineLengthMeters(coords)),
      installationType: 'Aerial',
      owner: 'Demo operator',
      installationDate: DATE,
      status: 'Active',
      coordinates: coords,
      startEquipmentId: start,
      endEquipmentId: end,
      colorScheme: 'tia-598',
      fibersPerTube: fiberCount >= 12 ? 12 : fiberCount,
      tubeCount: fiberCount >= 12 ? fiberCount / 12 : 1,
      cores: [],
      cableCategory: 'Fiber',
    };
    cables.push(c);
    return c;
  };
  const splitter = (
    id: string,
    name: string,
    box: string,
    ratio: SplitterRatio,
    input: Splitter['inputPort'],
  ): Splitter => {
    const n = Number(ratio.split(':')[1]);
    const s: Splitter = {
      id,
      name,
      terminalBoxId: box,
      ratio,
      insertionLossDb: DEFAULT_OPTICAL_SETTINGS.splitterDb[ratio],
      lossSource: 'settings default (demo)',
      status: 'Active',
      inputPort: input,
      outputPorts: Array.from({ length: n }, (_, i): SplitterPort => ({
        portNumber: i + 1,
        label: `OUT-${String(i + 1).padStart(2, '0')}`,
        status: 'Available',
      })),
    };
    splitters.push(s);
    return s;
  };
  const pole = (id: string, at: [number, number]) =>
    eq(id, id, 'Electric Pole', 'Supporting Infrastructure', geo(at[0], at[1]), {
      poleNumber: id,
      ownerType: undefined,
    });
  const span = (a: string, b: string) =>
    spans.push({
      id: `DEMO-SPN-${a}-${b}`,
      name: `${a} – ${b}`,
      fromStructureId: a,
      toStructureId: b,
      status: 'built',
      basis: 'imported',
      createdAt: DATE,
    });

  // Central office: OLT, aggregation switch with an SFP+ uplink recorded to the OLT.
  const oltAt = geo(0, 0);
  const ponPorts: PonPort[] = Array.from({ length: 8 }, (_, i) => ({
    id: `PON-${i + 1}`,
    portNumber: i + 1,
    vendorAddress: `1/1/${i + 1}`,
    status: i === 0 ? 'Active' : 'Available',
    connectedCustomersCount: 0,
    ...(i === 0 ? { connectedFeederCableId: 'DEMO-FDR-1', feederCore: 1 } : {}),
  }));
  const olt = eq('DEMO-OLT-1', 'Demo OLT (8-port GPON)', 'OLT', 'Central Office', oltAt, {
    technology: 'GPON',
    manufacturer: 'Demo',
    model: '8-port GPON chassis',
    ponPorts,
    totalPorts: 8,
    usedPorts: 1,
    rackNumber: 'CO-1',
    site: 'Demo central office',
  });
  const swPorts: EquipmentPort[] = [
    ...Array.from({ length: 24 }, (_, i): EquipmentPort => ({
      id: `DEMO-SW-P${i + 1}`,
      portNumber: i + 1,
      portType: 'RJ45',
      technology: 'GE',
      status: [0, 1, 4].includes(i) ? 'Used' : 'Available',
    })),
    {
      id: 'DEMO-SW-U1',
      portNumber: 25,
      portType: 'SFP+',
      technology: '10GE',
      status: 'Used',
      connectedEquipmentId: olt.id,
    },
  ];
  eq('DEMO-SW-1', 'Demo aggregation switch 24p', 'Core Switch', 'Central Office', oltAt, {
    logicalPorts: swPorts,
    site: 'Demo central office',
    totalPorts: 28,
  });

  // Feeder poles and backbone.
  FEEDER_POLES.forEach((p, i) => pole(`P-F${i + 1}`, p));
  CN.forEach((cx, k) => pole(`P-B${k + 1}`, [cx, -22]));
  span('P-F1', 'P-F2');
  span('P-F2', 'P-F3');
  span('P-F3', 'P-B1');
  for (let k = 1; k < CN.length; k += 1) span(`P-B${k}`, `P-B${k + 1}`);

  // FDT-1 (1:4) on the strand at the third feeder pole.
  const fdt1 = eq('DEMO-FDT-1', 'FDT-1', 'FDT', 'Fiber Distribution', geo(18.6, -22));
  cable(
    'DEMO-FDR-1',
    'Feeder PON 1',
    'Main Feeder Fiber',
    12,
    [oltAt, ...FEEDER_POLES.map(([x, z]) => geo(x, z)), geo(18.6, -22)],
    olt.id,
    fdt1.id,
  );
  const l1 = splitter('DEMO-SPL-L1', 'FDT-1 1:4', fdt1.id, '1:4', {
    id: 'IN',
    connectedCableId: 'DEMO-FDR-1',
    connectedCore: 1,
  });

  let houseNo = 0;
  CN.forEach((cx, k) => {
    const fdt2 = eq(`DEMO-FDT-2.${k + 1}`, `FDT-2.${k + 1}`, 'FDT', 'Fiber Distribution', geo(cx + 0.6, -22));
    const l1Cable = cable(
      `DEMO-L1-${k + 1}`,
      `L1 fiber to FDT-2.${k + 1}`,
      'Distribution Fiber',
      4,
      [geo(18.6, -22), ...CN.slice(0, k + 1).map((x) => geo(x, -22)), geo(cx + 0.6, -22)],
      fdt1.id,
      fdt2.id,
    );
    Object.assign(l1.outputPorts[k], {
      status: 'Occupied',
      connectedDropCableId: l1Cable.id,
      connectedCore: 1,
      connectedEquipmentId: fdt2.id,
    });
    const l2 = splitter(`DEMO-SPL-L2.${k + 1}`, `FDT-2.${k + 1} 1:4`, fdt2.id, '1:4', {
      id: 'IN',
      connectedCableId: l1Cable.id,
      connectedCore: 1,
    });

    for (let j = 0; j < NF[k]; j += 1) {
      const cz = RZ[j];
      const pz = cz + 1.5;
      const fatNo = k * 4 + j + 1;
      const poleId = `P-C${k + 1}.${j + 1}`;
      pole(poleId, [cx, pz]);
      span(j === 0 ? `P-B${k + 1}` : `P-C${k + 1}.${j}`, poleId);
      const fat = eq(`DEMO-FAT-${fatNo}`, `FAT-${fatNo}`, 'FAT', 'Fiber Distribution', geo(cx + 0.7, pz), {
        poleNumber: poleId,
      });
      const l2Cable = cable(
        `DEMO-L2-${fatNo}`,
        `L2 fiber to FAT-${fatNo}`,
        'Distribution Fiber',
        2,
        [geo(cx + 0.6, -22), geo(cx, -22), ...RZ.slice(0, j + 1).map((z) => geo(cx, z + 1.5)), geo(cx + 0.7, pz)],
        fdt2.id,
        fat.id,
      );
      Object.assign(l2.outputPorts[j], {
        status: 'Occupied',
        connectedDropCableId: l2Cable.id,
        connectedCore: 1,
        connectedEquipmentId: fat.id,
      });
      const fatSp = splitter(`DEMO-SPL-FAT-${fatNo}`, `FAT-${fatNo} 1:8`, fat.id, '1:8', {
        id: 'IN',
        connectedCableId: l2Cable.id,
        connectedCore: 1,
      });

      const n = NF[k] === 1 ? 4 : 8;
      for (let i = 0; i < n; i += 1) {
        houseNo += 1;
        const side = i < 4 ? -1 : 1;
        const hx = cx - 4.8 + 3.2 * (i % 4);
        const hz = cz + side * 2.85;
        const id = `DEMO-CUST-${String(houseNo).padStart(3, '0')}`;
        const dropId = `DEMO-DROP-${String(houseNo).padStart(3, '0')}`;
        const house = geo(hx, hz);
        cable(dropId, `Drop to house ${houseNo}`, 'Drop Fiber', 1, [geo(cx + 0.7, pz), house], fat.id, id);
        Object.assign(fatSp.outputPorts[i], {
          status: 'Occupied',
          connectedCustomerId: id,
          connectedCustomerName: `House ${houseNo}`,
          connectedDropCableId: dropId,
          connectedCore: 1,
        });
        const ontId = `DEMO-ONT-${String(houseNo).padStart(3, '0')}`;
        onts.push({
          id: ontId,
          serialNumber: `DEMO${String(houseNo).padStart(8, '0')}`,
          technology: 'GPON',
          arrangement: 'single',
          status: 'installed',
          statusSource: 'person',
          oltId: olt.id,
          ponPortId: 'PON-1',
          splitterId: fatSp.id,
          splitterOutputPort: i + 1,
          dropCableId: dropId,
          dropCore: 1,
          createdAt: DATE,
        });
        customers.push({
          id,
          name: `House ${houseNo}`,
          mobile: '',
          address: `Demo house ${houseNo}`,
          area: 'Demo area',
          lat: house[0],
          lng: house[1],
          serviceType: 'Fiber Broadband',
          plan: '',
          status: 'Active',
          installationDate: DATE,
          oltId: olt.id,
          ponPort: 'PON-1',
          feederCableId: 'DEMO-FDR-1',
          distributionCableId: l2Cable.id,
          terminalBoxId: fat.id,
          splitterId: fatSp.id,
          splitterOutputPort: i + 1,
          dropCableId: dropId,
          fiberCore: 1,
          ontSerialNumber: `DEMO${String(houseNo).padStart(8, '0')}`,
          routerModel: '',
          ipAddress: '',
          ontId,
          isSampleData: true,
        });
      }
    }
  });
  ponPorts[0].connectedCustomersCount = customers.length;

  const source: MonitoringSource = {
    id: 'DEMO-TEST-SRC',
    name: 'Demo TEST feed',
    kind: 'test_simulator',
    isTest: true,
    enabled: true,
    createdAt: DATE,
  };
  const at = now.toISOString();
  const onuStatuses: OnuStatus[] = [
    {
      id: 'DEMO-ST-1',
      ontId: 'DEMO-ONT-037',
      matchedBy: 'serial',
      origin: 'device_reported',
      sourceId: source.id,
      isTest: true,
      deviceTime: at,
      receivedAt: at,
      state: 'los',
    },
  ];
  return {
    equipment,
    cables,
    splitters,
    closures: [],
    customers,
    spans,
    onts,
    onuStatuses,
    monitoringSources: [source],
  };
}

/**
 * Benchmark network for `/3d?bench=N`: N copies of the demo network side by side (100 houses each,
 * so `bench=10` is 1000 houses on 10 OLTs). Each copy has its own ids, so it goes through the same
 * adapter as real data. Demo only, never saved.
 */
export function createBenchNetwork(copies: number, now = new Date()): DemoNetwork {
  const n = Math.max(1, Math.min(20, Math.floor(copies)));
  const base = JSON.stringify(createDemoNetwork(now));
  const out: DemoNetwork = {
    equipment: [],
    cables: [],
    splitters: [],
    closures: [],
    customers: [],
    spans: [],
    onts: [],
    onuStatuses: [],
    monitoringSources: [],
  };
  const metresPerDegLat = 111_320;
  const metresPerDegLng = metresPerDegLat * Math.cos((DEMO_ORIGIN.lat * Math.PI) / 180);
  for (let k = 0; k < n; k += 1) {
    const copy = JSON.parse(
      k === 0 ? base : base.replaceAll('"DEMO-', `"DEMO${k}-`).replaceAll('"P-', `"P${k}-`),
    ) as DemoNetwork;
    const dLat = -(Math.floor(k / 4) * 220) / metresPerDegLat;
    const dLng = ((k % 4) * 260) / metresPerDegLng;
    for (const e of copy.equipment) {
      e.lat += dLat;
      e.lng += dLng;
    }
    for (const c of copy.customers) {
      c.lat += dLat;
      c.lng += dLng;
    }
    for (const c of copy.cables) c.coordinates = c.coordinates.map(([a, b]) => [a + dLat, b + dLng]);
    out.equipment.push(...copy.equipment);
    out.cables.push(...copy.cables);
    out.splitters.push(...copy.splitters);
    out.customers.push(...copy.customers);
    out.spans.push(...copy.spans);
    out.onts.push(...copy.onts);
    out.onuStatuses.push(...copy.onuStatuses);
    out.monitoringSources.push(...copy.monitoringSources);
  }
  return out;
}
