import {
  buildPonOverview,
  type Cable,
  type Customer,
  DEFAULT_OPTICAL_SETTINGS,
  type Equipment,
  type JointClosure,
  type OpticalSettings,
  type Splitter,
} from '@fibergis/shared';

/**
 * Shapes the network records into what the 3D digital twin draws. Pure: same records, same
 * result. Used by the Digital Twin page (from the network store, so it follows the 2D map) and by
 * `digital-twin/build-twin.mts` (from the database, for the standalone file).
 *
 * PON ports, splitter stages, free outputs and power levels come from `buildPonOverview`, the
 * same source as the 2D map's "Network by PON". Levels are calculated from the recorded launch
 * power and the optical settings; they are not measurements. No phone numbers or addresses are
 * copied.
 */

export interface TwinInput {
  equipment: readonly Equipment[];
  cables: readonly Cable[];
  customers: readonly Customer[];
  splitters: readonly Splitter[];
  closures: readonly JointClosure[];
}

export interface TwinOptions {
  optical?: OpticalSettings;
  /** The standalone file opens with one demonstration cut. The app does not. */
  demoCut?: boolean;
  /** Fixed "today" for tests. */
  now?: Date;
}

const NODE_TYPE: Record<string, 'OLT' | 'closure' | 'FDT' | 'FAT'> = {
  OLT: 'OLT',
  'Fiber Joint Closure': 'closure',
  FDT: 'FDT',
  FAT: 'FAT',
};
const year = (date?: string) => (date ? Number(String(date).slice(0, 4)) : null);
const r1 = (v: number) => Math.round(v * 10) / 10;

export type TwinData = NonNullable<ReturnType<typeof buildTwinData>>;

/** `null` when there is no OLT with a position: the twin has nothing to start from. */
export function buildTwinData(input: TwinInput, options: TwinOptions = {}) {
  const { equipment, cables, customers, splitters, closures } = input;
  const olt = equipment.find((e) => e.type === 'OLT' && Number.isFinite(e.lat) && Number.isFinite(e.lng));
  if (!olt) return null;
  const now = options.now ?? new Date();
  const M_LAT = 111320;
  const M_LNG = 111320 * Math.cos((olt.lat * Math.PI) / 180);
  const xy = (lat: number, lng: number): [number, number] => [r1((lng - olt.lng) * M_LNG), r1((lat - olt.lat) * M_LAT)];
  /** Further than this from the OLT is not part of this network (a stray record). */
  const near = (lat: number, lng: number) => {
    const [x, n] = xy(lat, lng);
    return Math.hypot(x, n) < 20_000;
  };

  const overview = buildPonOverview(
    {
      equipment: [...equipment],
      cables: [...cables],
      splitters: [...splitters],
      closures: [...closures],
      customers: [...customers],
    },
    options.optical ?? DEFAULT_OPTICAL_SETTINGS,
  );
  const ponIndex = new Map(overview.pons.map((p, i) => [p.key, i]));
  const pons = overview.pons.map((p) => ({
    key: p.key,
    id: p.ponPortId,
    num: p.portNumber,
    area: p.areas[0]?.name ?? '',
    streets: p.streets,
    act: p.customers.active,
    ina: p.customers.total - p.customers.active,
    used: p.accessOutputs.used,
    free: p.accessOutputs.free,
    tot: p.accessOutputs.total,
    tx: p.txPowerDbm ?? null,
    rx: p.rxRange ? [p.rxRange.minDbm, p.rxRange.maxDbm] : null,
  }));

  const typeOf = new Map(equipment.map((e) => [e.id, e.type]));
  const nameOf = new Map(equipment.map((e) => [e.id, e.name]));
  const shown = customers.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && near(c.lat, c.lng));
  const customerIndex = new Map(shown.map((c, i) => [c.id, i]));
  const customerByDrop = new Map(shown.filter((c) => c.dropCableId).map((c) => [c.dropCableId!, c]));
  const cableById = new Map(cables.map((c) => [c.id, c]));

  /** What a splitter output feeds: a customer (by its drop) or the next box (by a cable). */
  const outputTarget = (cableId?: string): ['customer', number] | ['box', string] | null => {
    if (!cableId) return null;
    const cust = customerByDrop.get(cableId);
    if (cust) return ['customer', customerIndex.get(cust.id)!];
    const end = cableById.get(cableId)?.endEquipmentId;
    return end ? ['box', nameOf.get(end) ?? end] : null;
  };

  const nodes = equipment
    .filter((e) => NODE_TYPE[e.type] && Number.isFinite(e.lat) && Number.isFinite(e.lng) && near(e.lat, e.lng))
    // One OLT heads the twin; a second one would need its own room and is left for a later step.
    .filter((e) => e.type !== 'OLT' || e.id === olt.id)
    .map((e) => {
      const [x, n] = xy(e.lat, e.lng);
      const sp = splitters
        .filter((s) => s.terminalBoxId === e.id)
        .map((s) => {
          const sum = overview.splitters.get(s.id);
          return {
            id: s.id,
            name: s.name,
            ratio: s.ratio,
            stage: sum?.stage ?? null,
            pon: sum?.ponKey !== undefined ? (ponIndex.get(sum.ponKey) ?? -1) : -1,
            in: sum?.inputDbm ?? null,
            out: sum?.outputDbm ?? null,
            // [port number, state (1 used, 0 free, 2 other), target kind, target]
            outs: (s.outputPorts ?? []).map((o) => {
              const t = outputTarget(o.connectedDropCableId);
              const st = o.status === 'Occupied' ? 1 : o.status === 'Available' ? 0 : 2;
              return [o.portNumber, st, t?.[0] ?? '', t?.[1] ?? ''] as [number, number, string, number | string];
            }),
          };
        })
        .sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99));
      return {
        id: e.id,
        name: e.name,
        type: NODE_TYPE[e.type],
        x,
        n,
        area: e.area ?? '',
        street: e.street ?? '',
        pons: (overview.equipment.get(e.id) ?? []).map((k) => ponIndex.get(k) ?? -1).filter((i) => i >= 0),
        sp,
      };
    });
  const nodeIds = new Set(nodes.map((n) => n.id));

  const twinCables = [];
  const skipped: string[] = [];
  for (const c of cables) {
    if (c.type === 'Drop Fiber') continue;
    // An ODF stands in the OLT's office: a feeder that starts there starts at the OLT.
    const from = typeOf.get(c.startEquipmentId ?? '') === 'ODF' ? olt.id : c.startEquipmentId;
    const to = c.endEquipmentId;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to) || (c.coordinates ?? []).length < 2) {
      skipped.push(`${c.id} (${c.name})`);
      continue;
    }
    const use = overview.cables.get(c.id);
    twinCables.push({
      id: c.id,
      name: c.name,
      kind: c.type.startsWith('Main Feeder') ? 'feeder' : typeOf.get(to) === 'FAT' ? 'dist' : 'branch',
      cores: c.fiberCount,
      std: c.fiberStandard ?? '',
      year: year(c.installationDate) ?? now.getFullYear(),
      mount: c.installationType === 'Underground' ? 'underground' : (c.installationType ?? 'aerial').toLowerCase(),
      // Condition is not a field on the cable records, so the twin says so instead of guessing.
      cond: 'not recorded',
      from,
      to,
      pons: (use?.ponKeys ?? []).map((k) => ponIndex.get(k) ?? -1).filter((i) => i >= 0),
      // [fiber number, colour name, colour hex, in use (1/0), what it carries]
      cr: (c.cores ?? []).map((k) => {
        const a = k.assignments?.[k.assignments.length - 1];
        const used = k.status === 'In Use';
        return [
          k.coreNumber,
          k.colorName ?? '',
          k.colorHex ?? '',
          used ? 1 : 0,
          used ? [a?.use, a?.destination].filter(Boolean).join(' → ') : '',
        ];
      }),
      pts: c.coordinates.map(([lat, lng]) => xy(lat, lng)),
    });
  }

  const dropOf = new Map(cables.filter((c) => c.type === 'Drop Fiber').map((c) => [c.id, c]));
  const splitterById = new Map(splitters.map((s) => [s.id, s]));
  const twinCustomers = shown.map((c) => {
    const [x, n] = xy(c.lat, c.lng);
    const on = overview.customers.get(c.id);
    const drop = c.dropCableId ? dropOf.get(c.dropCableId) : undefined;
    const core = drop?.cores?.find((k) => k.coreNumber === (c.fiberCore ?? 1));
    // The stage above the customer's own splitter: its box and the output that feeds this branch.
    const fdt = (on?.splitterIds ?? []).map((id) => splitterById.get(id)).find((s) => s && s.id !== c.splitterId);
    const fdtOut = fdt?.outputPorts?.find((o) => o.connectedDropCableId === c.distributionCableId)?.portNumber;
    return {
      id: c.id,
      name: c.name,
      area: c.area ?? '',
      st: c.status === 'Active' ? 1 : 0,
      stn: c.status ?? '',
      plan: c.plan ?? '',
      onu: c.ontSerialNumber ?? '',
      // The level the app calculates for this path; else the value written on the record.
      rx: on?.rxDbm ?? (typeof c.rxOpticalPowerDbm === 'number' ? c.rxOpticalPowerDbm : null),
      pi: on ? (ponIndex.get(on.ponKey) ?? -1) : -1,
      x,
      n,
      fat: c.terminalBoxId ?? '',
      op: c.splitterOutputPort ?? null,
      fdt: fdt ? (nameOf.get(fdt.terminalBoxId ?? '') ?? '') : '',
      fo: fdtOut ?? null,
      dc: core ? [core.coreNumber, core.colorName ?? '', core.colorHex ?? ''] : null,
      df: drop?.fiberCount ?? null,
      dy: year(drop?.installationDate),
    };
  });

  const demo =
    twinCables.find((c) => /Benz/i.test(c.name) && c.kind === 'branch') ??
    twinCables.find((c) => c.kind === 'branch') ??
    twinCables[0];
  return {
    anchor: { lat: olt.lat, lng: olt.lng, name: olt.name },
    olt: {
      id: olt.id,
      make: [olt.manufacturer, olt.model].filter(Boolean).join(' ') || olt.name,
      ports: (olt.ponPorts ?? []).map((p) => ({
        id: p.id,
        num: p.portNumber,
        st: p.status,
        pi: ponIndex.get(`${olt.id}/${p.id}`) ?? -1,
      })),
    },
    yearNow: now.getFullYear(),
    exported: now.toISOString().slice(0, 10),
    pons,
    nodes,
    cables: twinCables,
    customers: twinCustomers,
    poles: equipment
      .filter((e) => /Pole$/.test(e.type) && Number.isFinite(e.lat) && near(e.lat, e.lng))
      .map((e) => xy(e.lat, e.lng)),
    demoCut: options.demoCut && demo ? { id: demo.id, at: 400 } : null,
    skipped,
  };
}
