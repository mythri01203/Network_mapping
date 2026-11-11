/**
 * Vijayawada demo FTTH network: one DASAN V5808 GPON OLT (8 PON ports) and 500 sample customers.
 *
 * Everything is built with the same commands people use in the app (cables, ODF, closures, splices,
 * splitters, customer setup, ONT records, services, poles, spans, attachments), so every customer is
 * recorded fiber by fiber from the PON port to the ONT and passes the app's own fiber rules.
 *
 * It is SAMPLE DATA. Names, phone numbers, serials and positions are made up (positions are rough,
 * not surveyed). Equipment and customers carry `isSampleData`, and every power level is calculated
 * from the optical settings, never measured.
 *
 * Design per PON port: ODF → feeder (48F) → joint closure splice → branch (12F) → FDT with a 1:8 PLC
 * → 8 distribution cables (6F) → 8 FATs, each with a 1:8 PLC → drops → ONTs. 1:64 per PON.
 */
import { createCable } from '../domain/cables';
import { applyPatch, type CommandContext, type CommandResult, type NetworkData } from '../domain/command';
import { adoptCustomerOnt, saveOntDetails, saveService, setOntStatus } from '../domain/connectionCommands';
import {
  addOdfPanel,
  connectSplitterOutput,
  createClosure,
  patchOdfPort,
  recordSplice,
  saveSplitterDetails,
  setCableLayout,
  setOdfPortFeeder,
  updatePonPort,
} from '../domain/fiberCommands';
import { type CorePathResult, traceCustomerCores } from '../domain/fiberPath';
import { buildOltPonPorts } from '../domain/oltConfig';
import { addAttachments, createSlackLoop, createSpan } from '../domain/outsidePlant';
import { createSplitter, provisionCustomer } from '../domain/provisioning';
import { createRack, createSite, placeInRack } from '../domain/sitesRacks';
import { COLLECTION_NAMES, type NetworkSnapshot } from '../model/collections';
import type { Cable, Customer, Equipment } from '../model/types';
import { DASAN_V5808 } from './dasanV5808';

export const VIJAYAWADA_PREFIX = 'VJA-';
export const VIJAYAWADA_CUSTOMER_COUNT = 500;

/** Central office, MG Road near Labbipet. Approximate. */
const CO = { lat: 16.506, lng: 80.644 };

interface Zone {
  pon: number;
  area: string;
  pin: string;
  lat: number;
  lng: number;
  feeder: 'N' | 'S';
  streets: string[];
}

/** One service area per PON port. Locality names are real; centres are approximate. */
const ZONES: Zone[] = [
  {
    pon: 1,
    area: 'Suryaraopet',
    pin: '520002',
    lat: 16.515,
    lng: 80.633,
    feeder: 'N',
    streets: ['Eluru Road', 'Pushpa Hotel Road', 'Jammi Chettu Street', 'Bhavaniprasad Street'],
  },
  {
    pon: 2,
    area: 'Governorpet',
    pin: '520002',
    lat: 16.518,
    lng: 80.624,
    feeder: 'N',
    streets: ['Besant Road', 'Kaleswara Rao Road', 'Museum Road', 'Gandhi Nagar Main Road'],
  },
  {
    pon: 3,
    area: 'Gunadala',
    pin: '520004',
    lat: 16.525,
    lng: 80.656,
    feeder: 'N',
    streets: ['Gunadala Main Road', 'Mary Matha Road', 'Padavalarevu Road', 'Railway Colony Road'],
  },
  {
    pon: 4,
    area: 'Moghalrajpuram',
    pin: '520010',
    lat: 16.511,
    lng: 80.652,
    feeder: 'N',
    streets: ['Siddhartha College Road', 'Polyclinic Road', 'Kakatiya Street', 'Tikkle Road'],
  },
  {
    pon: 5,
    area: 'Labbipet',
    pin: '520010',
    lat: 16.499,
    lng: 80.639,
    feeder: 'S',
    streets: ['MG Road', 'Venkateswara Street', 'Bandar Lakulu Road', 'Kalanagar Road'],
  },
  {
    pon: 6,
    area: 'Benz Circle',
    pin: '520010',
    lat: 16.4995,
    lng: 80.6565,
    feeder: 'S',
    streets: ['NH 65 Service Road', 'Nirmala Convent Road', 'Srinivasa Nagar Bank Colony', 'Benz Circle Main Road'],
  },
  {
    pon: 7,
    area: 'Patamata',
    pin: '520010',
    lat: 16.493,
    lng: 80.667,
    feeder: 'S',
    streets: ['Auto Nagar Road', 'Patamata Lanka Road', 'Kamayyathopu Road', 'Patamata High School Road'],
  },
  {
    pon: 8,
    area: 'Gurunanak Colony',
    pin: '520008',
    lat: 16.488,
    lng: 80.659,
    feeder: 'S',
    streets: ['Gurunanak Colony Main Road', 'NTR Circle Road', 'Ramalingeswara Nagar Road', 'Bhavani Nagar Road'],
  },
];

const JUNCTIONS = {
  N: { id: `${VIJAYAWADA_PREFIX}JC-N01`, name: 'JC-N01 Eluru Road junction', lat: 16.5125, lng: 80.6425 },
  S: { id: `${VIJAYAWADA_PREFIX}JC-S01`, name: 'JC-S01 Bandar Road junction', lat: 16.5005, lng: 80.647 },
};

/** Customers per PON port: 4 × 63 + 4 × 62 = 500, leaving one or two splitter outputs free per PON. */
const CUSTOMERS_PER_PON = [63, 63, 63, 63, 62, 62, 62, 62];

const FIRST_NAMES = [
  'Venkata',
  'Srinivas',
  'Lakshmi',
  'Ramesh',
  'Suresh',
  'Padma',
  'Anil',
  'Sravani',
  'Prasad',
  'Kavya',
  'Naveen',
  'Sirisha',
  'Ravi Teja',
  'Bhavani',
  'Krishna',
  'Durga',
  'Satish',
  'Swathi',
  'Mahesh',
  'Sujatha',
  'Kiran',
  'Harika',
  'Rajesh',
  'Madhavi',
  'Sai Kumar',
  'Anusha',
  'Gopi',
  'Pavani',
  'Murali',
  'Keerthi',
  'Chaitanya',
  'Lavanya',
  'Ramana',
  'Sandhya',
  'Phani',
  'Mounika',
  'Vamsi',
  'Divya',
  'Nagaraju',
  'Revathi',
];
const SURNAMES = [
  'Rao',
  'Reddy',
  'Naidu',
  'Chowdary',
  'Varma',
  'Sastry',
  'Prasad',
  'Kumar',
  'Murthy',
  'Babu',
  'Raju',
  'Devi',
  'Sharma',
  'Goud',
  'Yadav',
  'Choudary',
  'Setty',
  'Achari',
  'Kishore',
  'Mohan',
];
const PLANS = ['FTTH 50 Mbps', 'FTTH 100 Mbps', 'FTTH 100 Mbps', 'FTTH 200 Mbps', 'FTTH 300 Mbps'];

/** Deterministic random numbers, so the demo is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METERS_PER_DEG_LAT = 111_320;
const offset = (p: { lat: number; lng: number }, northM: number, eastM: number) => ({
  lat: +(p.lat + northM / METERS_PER_DEG_LAT).toFixed(6),
  lng: +(p.lng + eastM / (METERS_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180))).toFixed(6),
});
const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dn = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  const de = (b.lng - a.lng) * METERS_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dn, de);
};
const pad = (n: number, w: number) => String(n).padStart(w, '0');

export interface VijayawadaBuild {
  /** Only the new records, ready to upsert. */
  records: Partial<NetworkSnapshot>;
  /** Questions a command asked ("Save anyway?"). The demo is built so this stays empty. */
  confirms: string[];
  counts: Record<string, number>;
}

/**
 * Builds the demo. Pass the current network to add it next to existing records: the rules then run
 * against both, and nothing that already exists is changed.
 */
export function createVijayawadaNetwork(
  base?: Partial<NetworkSnapshot>,
  options: { now?: Date; actor?: string } = {},
): VijayawadaBuild {
  const now = options.now ?? new Date('2026-11-01T10:00:00+05:30');
  const actor = options.actor ?? 'Vijayawada demo builder';
  const ctx: CommandContext = { now, actor };
  const empty = Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []])) as unknown as NetworkSnapshot;
  let data = { ...empty, ...(base ?? {}) } as NetworkData & NetworkSnapshot;
  const before = new Map(
    COLLECTION_NAMES.map((n) => [
      n,
      new Set(((data as unknown as Record<string, { id: string }[]>)[n] ?? []).map((r) => r.id)),
    ]),
  );
  const confirms: string[] = [];
  const random = rng(520010);

  const step = <T>(result: CommandResult<T>, what: string): T => {
    if (!result.ok) throw new Error(`Vijayawada demo: ${what}: ${result.error.title}: ${result.error.message}`);
    if (result.confirm) confirms.push(`${what}: ${result.confirm}`);
    data = applyPatch(data, result.patch) as typeof data;
    return result.value;
  };
  const addEquipment = (items: Equipment[]) => {
    const taken = new Set(data.equipment.map((e) => e.id));
    for (const e of items)
      if (taken.has(e.id)) throw new Error(`Vijayawada demo: ${e.id} already exists. Remove the earlier demo first.`);
    data = { ...data, equipment: [...data.equipment, ...items] };
  };
  const box = (
    id: string,
    type: Equipment['type'],
    name: string,
    p: { lat: number; lng: number },
    area: string,
    street: string,
    extra: Partial<Equipment> = {},
  ): Equipment => ({
    id,
    name,
    type,
    category: 'Fiber Distribution',
    lat: p.lat,
    lng: p.lng,
    locationMethod: 'typed',
    area,
    street,
    status: 'Active',
    images: [],
    installedDate: '2025-06-15',
    notes: 'Sample data: Vijayawada demo network. Position approximate, not surveyed.',
    ...extra,
  });

  // ---- Central office: site, rack, OLT, ODF ------------------------------------------------------
  const site = step(
    createSite(
      data,
      {
        name: 'Vijayawada CO (Labbipet)',
        kind: 'Exchange',
        address: 'MG Road, Labbipet, Vijayawada 520010',
        lat: CO.lat,
        lng: CO.lng,
        notes: 'Sample data.',
      },
      ctx,
    ),
    'site',
  );
  const rack = step(
    createRack(
      data,
      {
        siteId: site.id,
        name: 'Rack 1',
        heightUnits: 42,
        numbering: 'bottom_up',
        location: 'Row A, first from the door',
        notes: 'Sample data.',
      },
      ctx,
    ),
    'rack',
  );

  const oltId = `${VIJAYAWADA_PREFIX}OLT-01`;
  const odfId = `${VIJAYAWADA_PREFIX}ODF-01`;
  const olt: Equipment = box(
    oltId,
    'OLT',
    `OLT-VJA-01 ${DASAN_V5808.vendor} ${DASAN_V5808.model}`,
    CO,
    'Labbipet',
    'MG Road',
    {
      category: 'Central Office',
      technology: 'GPON',
      manufacturer: DASAN_V5808.vendor,
      model: DASAN_V5808.model,
      serialNumber: 'SAMPLE-V5808-0001',
      ipAddress: '10.20.0.11',
      totalPorts: DASAN_V5808.ponPorts,
      site: 'Vijayawada CO rack 1',
      notes: `Sample data. ${DASAN_V5808.summary} Management IP is a sample value: change it to your OLT's real address before polling.`,
    },
  );
  addEquipment([
    olt,
    box(odfId, 'ODF', 'ODF-VJA-01 (96 port)', offset(CO, 0, 2), 'Labbipet', 'MG Road', {
      category: 'Central Office',
      totalPorts: 96,
    }),
  ]);
  data = {
    ...data,
    equipment: data.equipment.map((e) => (e.id === oltId ? { ...e, ponPorts: buildOltPonPorts(e) } : e)),
  };
  step(
    placeInRack(data, oltId, { rackId: rack.id, rackUnit: 30, rackUnits: DASAN_V5808.rackUnits }, ctx),
    'OLT in rack',
  );
  step(placeInRack(data, odfId, { rackId: rack.id, rackUnit: 20, rackUnits: 4 }, ctx), 'ODF in rack');

  for (const z of ZONES) {
    const ponId = `PON-${pad(z.pon, 2)}`;
    // Launch power differs slightly port to port, inside the B+ range (+1.5 to +5 dBm).
    const tx = +(2.6 + ((z.pon * 37) % 17) / 10).toFixed(1);
    step(
      updatePonPort(
        data,
        oltId,
        ponId,
        {
          vendorAddress: DASAN_V5808.ponAddress(z.pon),
          opticsClass: 'GPON B+',
          opticsClassSource: 'Sample data: B+ assumed. Read the class on the real SFP module.',
          technology: 'GPON',
          adminStatus: 'enabled',
          txPowerDbm: tx,
        },
        ctx,
      ),
      `PON port ${ponId}`,
    );
  }

  // ---- Poles, spans and attachments along a route ------------------------------------------------
  let poleCount = 0;
  const poleRoute = (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    spacing: number,
    area: string,
    street: string,
  ) => {
    const length = metersBetween(from, to);
    const n = Math.max(1, Math.round(length / spacing)) - 1;
    const poles: Equipment[] = [];
    for (let i = 1; i <= n; i += 1) {
      const t = i / (n + 1);
      poleCount += 1;
      const id = `${VIJAYAWADA_PREFIX}P-${pad(poleCount, 4)}`;
      poles.push(
        box(
          id,
          'Electric Pole',
          `Pole VJA-${pad(poleCount, 4)}`,
          {
            lat: +(from.lat + (to.lat - from.lat) * t).toFixed(6),
            lng: +(from.lng + (to.lng - from.lng) * t).toFixed(6),
          },
          area,
          street,
          {
            category: 'Supporting Infrastructure',
            poleNumber: `VJA-${pad(poleCount, 4)}`,
            ownerType: 'electricity',
            material: 'concrete',
            notes: 'Sample data: electricity pole, owner and permission not recorded.',
          },
        ),
      );
    }
    addEquipment(poles);
    return poles;
  };
  const hang = (cable: Cable, poles: Equipment[]) => {
    const drafts: { cableId: string; structureId?: string; spanId?: string; status: 'built'; basis: 'office_drawn' }[] =
      poles.map((p) => ({ cableId: cable.id, structureId: p.id, status: 'built', basis: 'office_drawn' }));
    for (let i = 1; i < poles.length; i += 1) {
      const existing = (data.spans ?? []).find(
        (s) => s.fromStructureId === poles[i - 1].id && s.toStructureId === poles[i].id,
      );
      const span =
        existing ??
        step(
          createSpan(
            data,
            { fromStructureId: poles[i - 1].id, toStructureId: poles[i].id, status: 'built', basis: 'office_drawn' },
            ctx,
          ),
          `span on ${cable.id}`,
        );
      drafts.push({ cableId: cable.id, spanId: span.id, status: 'built', basis: 'office_drawn' });
    }
    if (drafts.length) step(addAttachments(data, drafts, ctx), `attachments of ${cable.id}`);
  };
  const fiberCable = (
    id: string,
    name: string,
    type: Cable['type'],
    fibers: number,
    perTube: number,
    from: Equipment,
    to: Equipment,
    poles: Equipment[],
    installationType: Cable['installationType'],
  ) => {
    const cable = step(
      createCable(
        data,
        {
          id,
          name,
          type,
          fiberCount: fibers,
          startEquipmentId: from.id,
          endEquipmentId: to.id,
          coordinates: [[from.lat, from.lng], ...poles.map((p): [number, number] => [p.lat, p.lng]), [to.lat, to.lng]],
          installationType,
          fiberStandard: 'G.652D',
          owner: 'Sample ISP',
          installationDate: '2025-06-15',
          remarks: 'Sample data: Vijayawada demo network.',
        },
        ctx,
      ),
      `cable ${id}`,
    );
    step(
      setCableLayout(data, id, { colorScheme: 'tia-598', tubeColorScheme: 'tia-598', fibersPerTube: perTube }, ctx),
      `layout of ${id}`,
    );
    hang(cable, poles);
    return cable;
  };

  // ---- Feeders, ODF, joint closures --------------------------------------------------------------
  const odf = () => data.equipment.find((e) => e.id === odfId)!;
  const panels = {
    N: step(
      addOdfPanel(
        data,
        odfId,
        { label: 'Panel A (feeder north)', portCount: 48, connectorType: 'SC/APC', rack: 'Rack 1' },
        ctx,
      ),
      'ODF panel A',
    ),
    S: step(
      addOdfPanel(
        data,
        odfId,
        { label: 'Panel B (feeder south)', portCount: 48, connectorType: 'SC/APC', rack: 'Rack 1' },
        ctx,
      ),
      'ODF panel B',
    ),
  };
  const closures: Record<'N' | 'S', { id: string; trayId: string }> = {} as never;
  for (const side of ['N', 'S'] as const) {
    const jc = JUNCTIONS[side];
    addEquipment([
      box(
        jc.id,
        'Fiber Joint Closure',
        jc.name,
        jc,
        side === 'N' ? 'Suryaraopet' : 'Labbipet',
        side === 'N' ? 'Eluru Road' : 'Bandar Road',
      ),
    ]);
    const poles = poleRoute(odf(), jc, 50, 'Labbipet', side === 'N' ? 'Eluru Road' : 'Bandar Road');
    const feeder = fiberCable(
      `${VIJAYAWADA_PREFIX}FDR-${side}01`,
      `Feeder ${side === 'N' ? 'North' : 'South'} 48F`,
      'Main Feeder Fiber',
      48,
      12,
      odf(),
      data.equipment.find((e) => e.id === jc.id)!,
      poles,
      'Aerial',
    );
    step(
      createSlackLoop(
        data,
        {
          cableId: feeder.id,
          structureId: jc.id,
          lengthMeters: 20,
          notes: 'Sample data: service loop at the closure.',
        },
        ctx,
      ),
      'slack loop',
    );
    const closure = step(
      createClosure(
        data,
        {
          equipmentId: jc.id,
          closureType: 'Dome Splice Closure',
          trayCount: 4,
          technician: 'Sample splicer',
          installationDate: '2025-06-18',
        },
        ctx,
      ),
      `closure ${jc.id}`,
    );
    closures[side] = { id: closure.id, trayId: closure.trays![0].id };
  }

  // ---- Per PON port: ODF patch, branch, FDT primary splitter, FATs, customers --------------------
  let customerNo = 0;
  let ontHex = 0x3a1f0000;
  for (const z of ZONES) {
    const ponId = `PON-${pad(z.pon, 2)}`;
    const side = z.feeder;
    const core = ((z.pon - 1) % 4) + 1;
    const feederId = `${VIJAYAWADA_PREFIX}FDR-${side}01`;
    const panel = panels[side];
    step(setOdfPortFeeder(data, odfId, panel.id, core, { cableId: feederId, core }, ctx), `ODF port ${core}`);
    step(
      patchOdfPort(
        data,
        odfId,
        panel.id,
        core,
        {
          oltId,
          ponPortId: ponId,
          cordLabel: `PC-${pad(z.pon, 2)}`,
          cordConnectorOdf: 'SC/APC',
          cordConnectorPon: 'SC/UPC',
          cordLengthMeters: 3,
        },
        ctx,
      ),
      `patch ${ponId}`,
    );

    const fdtId = `${VIJAYAWADA_PREFIX}FDT-${pad(z.pon, 2)}`;
    const fdt = box(fdtId, 'FDT', `FDT-${pad(z.pon, 2)} ${z.area}`, { lat: z.lat, lng: z.lng }, z.area, z.streets[0], {
      totalPorts: 8,
    });
    addEquipment([fdt]);
    const jc = data.equipment.find((e) => e.id === JUNCTIONS[side].id)!;
    const branchPoles = poleRoute(jc, fdt, 50, z.area, z.streets[0]);
    const branch = fiberCable(
      `${VIJAYAWADA_PREFIX}BR-${pad(z.pon, 2)}`,
      `Branch ${z.area} 12F`,
      'Distribution Fiber',
      12,
      12,
      jc,
      fdt,
      branchPoles,
      'Aerial',
    );
    step(
      recordSplice(
        data,
        closures[side].id,
        {
          trayId: closures[side].trayId,
          inputCableId: feederId,
          inputCore: core,
          outputCableId: branch.id,
          // Colour to colour: feeder fiber N continues on branch fiber N.
          outputCore: core,
          spliceType: 'fusion',
          spliceLossDb: +(0.03 + ((z.pon * 7) % 5) / 100).toFixed(2),
          lossSource: 'designed',
          technician: 'Sample splicer',
          date: '2025-06-18',
          notes: 'Sample data.',
        },
        ctx,
      ),
      `splice ${feederId}#${core}`,
    );
    const primary = step(
      createSplitter(
        data,
        {
          id: `${VIJAYAWADA_PREFIX}SPL-P${pad(z.pon, 2)}`,
          name: `SPL-P${pad(z.pon, 2)} 1:8 ${z.area}`,
          terminalBoxId: fdtId,
          ratio: '1:8',
          kind: 'PLC',
          input: { cableId: branch.id, core },
        },
        ctx,
      ),
      `primary splitter ${z.pon}`,
    );

    const wanted = CUSTOMERS_PER_PON[z.pon - 1];
    let left = wanted;
    for (let f = 1; f <= 8; f += 1) {
      const angle = ((f - 1) * 45 + z.pon * 11) * (Math.PI / 180);
      const radius = 180 + ((f * 53 + z.pon * 31) % 140);
      const fatPoint = offset(fdt, Math.cos(angle) * radius, Math.sin(angle) * radius);
      const street = z.streets[(f - 1) % z.streets.length];
      const fatId = `${VIJAYAWADA_PREFIX}FAT-${pad(z.pon, 2)}${pad(f, 2)}`;
      addEquipment([
        box(fatId, 'FAT', `FAT-${pad(z.pon, 2)}-${pad(f, 2)} ${street}`, fatPoint, z.area, street, { totalPorts: 8 }),
      ]);
      const fat = data.equipment.find((e) => e.id === fatId)!;
      const distPoles = poleRoute(fdt, fat, 50, z.area, street);
      const dist = fiberCable(
        `${VIJAYAWADA_PREFIX}DST-${pad(z.pon, 2)}${pad(f, 2)}`,
        `Distribution ${z.area} FAT-${pad(f, 2)} 6F`,
        'Distribution Fiber',
        6,
        6,
        fdt,
        fat,
        distPoles,
        'Aerial',
      );
      step(
        connectSplitterOutput(data, primary.id, f, { cableId: dist.id, core: 1, equipmentId: fatId }, ctx),
        `primary output ${f}`,
      );
      const secondary = step(
        createSplitter(
          data,
          {
            id: `${VIJAYAWADA_PREFIX}SPL-S${pad(z.pon, 2)}${pad(f, 2)}`,
            name: `SPL-S${pad(z.pon, 2)}-${pad(f, 2)} 1:8`,
            terminalBoxId: fatId,
            ratio: '1:8',
            kind: 'PLC',
            input: { cableId: dist.id, core: 1 },
          },
          ctx,
        ),
        `secondary splitter ${z.pon}/${f}`,
      );
      step(saveSplitterDetails(data, secondary.id, { kind: 'PLC' }, ctx), 'splitter details');

      // Fill outputs from 1; the last FATs keep a free output for repairs.
      const here = f > 8 - (64 - wanted) ? 7 : 8;
      for (let out = 1; out <= here; out += 1) {
        customerNo += 1;
        left -= 1;
        const r = random;
        const housePoint = offset(fat, (r() - 0.5) * 180, (r() - 0.5) * 180);
        const first = FIRST_NAMES[Math.floor(r() * FIRST_NAMES.length)];
        const last = SURNAMES[Math.floor(r() * SURNAMES.length)];
        const id = `${VIJAYAWADA_PREFIX}CUST-${pad(customerNo, 4)}`;
        ontHex += 1 + Math.floor(r() * 9);
        const serial = `${DASAN_V5808.ontSerialPrefix}${ontHex.toString(16).padStart(8, '0')}`;
        const plan = PLANS[Math.floor(r() * PLANS.length)];
        const installed = new Date(now.getTime() - Math.floor(r() * 480) * 86_400_000);
        const cctx: CommandContext = { ...ctx, now: installed };
        const made = step(
          provisionCustomer(
            data,
            {
              id,
              name: `${first} ${last}`,
              mobile: `+91 90000 ${pad(customerNo, 5)}`,
              address: `D.No. ${1 + Math.floor(r() * 40)}-${1 + Math.floor(r() * 30)}-${1 + Math.floor(r() * 90)}, ${street}, ${z.area}, Vijayawada ${z.pin}`,
              area: z.area,
              lat: housePoint.lat,
              lng: housePoint.lng,
              locationMethod: 'typed',
              terminalBoxId: fatId,
              splitterId: secondary.id,
              splitterOutputPort: out,
              serviceType: 'Fiber Broadband',
              plan,
              status: customerNo % 37 === 0 ? 'Suspended' : 'Active',
              ontSerialNumber: serial,
              routerModel: `${DASAN_V5808.vendor} ${DASAN_V5808.ontModel}`,
            },
            cctx,
          ),
          `customer ${id}`,
        );
        // Two-fiber drop, TIA-598 colours (fiber 1 blue carries the service, fiber 2 orange is spare).
        step(setCableLayout(data, made.dropCable.id, { colorScheme: 'tia-598', fibersPerTube: 2 }, cctx), `layout of drop ${id}`);
        const onuId = (f - 1) * 8 + out;
        const ont = step(adoptCustomerOnt(data, made.customer.id, cctx), `ONT of ${id}`);
        step(
          saveOntDetails(
            data,
            ont.id,
            {
              serialNumber: serial,
              vendor: DASAN_V5808.vendor,
              model: DASAN_V5808.ontModel,
              technology: 'GPON',
              arrangement: 'single',
              onuAddress: DASAN_V5808.onuAddress(z.pon, onuId),
              notes: 'Sample data: serial and ONU id are made up.',
            },
            cctx,
          ),
          `ONT details ${id}`,
        );
        if ((data.onts ?? []).find((o) => o.id === ont.id)?.status !== 'installed')
          step(setOntStatus(data, ont.id, 'installed', 'Sample data: installed at setup.', cctx), `ONT status ${id}`);
        const suspended = made.customer.status === 'Suspended';
        step(
          saveService(
            data,
            {
              customerId: id,
              kind: 'internet',
              status: suspended ? 'suspended' : 'active',
              planName: plan,
              ontId: ont.id,
              ontPort: 'LAN 1',
              startedAt: installed.toISOString(),
              notes: 'Sample data.',
            },
            cctx,
          ),
          `service ${id}`,
        );
        if (customerNo % 5 === 0)
          step(
            saveService(
              data,
              {
                customerId: id,
                kind: 'iptv',
                status: suspended ? 'suspended' : 'active',
                planName: 'IPTV Basic',
                ontId: ont.id,
                ontPort: 'LAN 2',
                startedAt: installed.toISOString(),
                notes: 'Sample data.',
              },
              cctx,
            ),
            `IPTV ${id}`,
          );
      }
    }
    if (left !== 0) throw new Error(`Vijayawada demo: ${left} customers left over on ${ponId}.`);
  }

  // Mark sample records and keep only what is new.
  const records: Partial<NetworkSnapshot> = {};
  const counts: Record<string, number> = {};
  for (const name of COLLECTION_NAMES) {
    const list = ((data as unknown as Record<string, { id: string }[]>)[name] ?? []).filter(
      (r) => !before.get(name)!.has(r.id),
    );
    if (!list.length) continue;
    const marked =
      name === 'equipment' || name === 'customers' ? list.map((r) => ({ ...r, isSampleData: true })) : list;
    (records as Record<string, unknown>)[name] = marked;
    counts[name] = marked.length;
  }
  return { records, confirms, counts };
}

// ---- Power plan --------------------------------------------------------------------------------

export interface SplitterPowerRow {
  splitterId: string;
  splitterName: string;
  stage: 'primary' | 'secondary';
  ponPortId: string;
  /** Calculated downstream level (1490 nm) arriving at the splitter input. */
  inputDbm: number;
  /** Calculated level leaving each output, including the output adapter. */
  outputDbm: number;
  customers: number;
}

export interface CustomerPowerRow {
  customerId: string;
  ponPortId: string;
  /** Calculated ONT receive level (downstream). */
  rxDbm: number;
  /** Calculated OLT receive level from this ONT (upstream), using the ONT launch given. */
  oltRxDbm?: number;
  downLossDb: number;
  upLossDb: number;
  verdict?: string;
}

/**
 * Walks every customer's recorded fiber path and reports the calculated level at each splitter and
 * each ONT, starting from the PON port's recorded launch power. Calculated, never measured.
 */
export function vijayawadaPowerPlan(
  data: NetworkData,
  ontLaunchDbm = 2,
): { splitters: SplitterPowerRow[]; customers: CustomerPowerRow[]; incomplete: string[] } {
  const splitters = new Map<string, SplitterPowerRow>();
  const customers: CustomerPowerRow[] = [];
  const incomplete: string[] = [];
  const round1 = (n: number) => Math.round(n * 10) / 10;
  for (const c of data.customers as Customer[]) {
    if (!c.id.startsWith(VIJAYAWADA_PREFIX)) continue;
    const path: CorePathResult = traceCustomerCores(c, data);
    if (!path.complete || path.pon?.txPowerDbm === undefined) {
      incomplete.push(c.id);
      continue;
    }
    let level = path.pon.txPowerDbm;
    let stage = 0;
    for (const s of path.steps) {
      const before = level;
      level -= s.lossDb ?? 0;
      if (s.kind === 'splitter') {
        stage += 1;
        const row = splitters.get(s.id) ?? {
          splitterId: s.id,
          splitterName: s.title,
          stage: stage === 1 ? ('primary' as const) : ('secondary' as const),
          ponPortId: path.pon.id,
          inputDbm: round1(before),
          outputDbm: round1(level),
          customers: 0,
        };
        row.customers += 1;
        splitters.set(s.id, row);
      }
    }
    const down = path.directions.find((d) => d.direction === 'downstream')!.budget.totalLossDb;
    const up = path.directions.find((d) => d.direction === 'upstream')!.budget.totalLossDb;
    customers.push({
      customerId: c.id,
      ponPortId: path.pon.id,
      rxDbm: round1(path.pon.txPowerDbm - down),
      oltRxDbm: round1(ontLaunchDbm - up),
      downLossDb: round1(down),
      upLossDb: round1(up),
      verdict: path.verdict,
    });
  }
  return { splitters: [...splitters.values()], customers, incomplete };
}

/**
 * The ids of every demo record in a network, by collection, so the demo can be taken out again:
 * records with the `VJA-` prefix, and those made by the commands that point at them (drops, ONTs,
 * services, closures, spans, attachments, slack loops, the CO site and rack).
 */
export function vijayawadaRecordIds(data: Partial<NetworkSnapshot>): Partial<Record<keyof NetworkSnapshot, string[]>> {
  const mine = (id: string | undefined) => !!id && id.startsWith(VIJAYAWADA_PREFIX);
  const equipment = (data.equipment ?? []).filter((e) => mine(e.id));
  const equipmentIds = new Set(equipment.map((e) => e.id));
  const customers = (data.customers ?? []).filter((c) => mine(c.id));
  const customerIds = new Set(customers.map((c) => c.id));
  const cables = (data.cables ?? []).filter(
    (c) =>
      mine(c.id) ||
      (c.type === 'Drop Fiber' &&
        equipmentIds.has(c.startEquipmentId ?? '') &&
        customerIds.has(c.cores.find((k) => k.customerId)?.customerId ?? '')),
  );
  const cableIds = new Set(cables.map((c) => c.id));
  const ontIds = new Set(customers.map((c) => c.ontId).filter((id): id is string => !!id));
  const spans = (data.spans ?? []).filter(
    (s) => equipmentIds.has(s.fromStructureId) && equipmentIds.has(s.toStructureId),
  );
  const spanIds = new Set(spans.map((s) => s.id));
  const rackIds = new Set(equipment.map((e) => e.rackId).filter((id): id is string => !!id));
  const siteIds = new Set(equipment.map((e) => e.siteId).filter((id): id is string => !!id));
  const ids = (list: { id: string }[] | undefined, keep: (r: never) => boolean) =>
    (list ?? []).filter((r) => keep(r as never)).map((r) => r.id);
  return {
    equipment: [...equipmentIds],
    customers: [...customerIds],
    cables: [...cableIds],
    splitters: ids(data.splitters, (s: { id: string }) => mine(s.id)),
    closures: ids(data.closures, (c: { equipmentId?: string }) => equipmentIds.has(c.equipmentId ?? '')),
    onts: ids(data.onts, (o: { id: string }) => ontIds.has(o.id)),
    services: ids(data.services, (s: { customerId: string }) => customerIds.has(s.customerId)),
    spans: [...spanIds],
    attachments: ids(
      data.attachments,
      (a: { cableId: string; spanId?: string }) => cableIds.has(a.cableId) || spanIds.has(a.spanId ?? ''),
    ),
    slackLoops: ids(data.slackLoops, (s: { cableId: string }) => cableIds.has(s.cableId)),
    racks: ids(data.racks, (r: { id: string }) => rackIds.has(r.id)),
    sites: ids(data.sites, (s: { id: string }) => siteIds.has(s.id)),
  };
}
