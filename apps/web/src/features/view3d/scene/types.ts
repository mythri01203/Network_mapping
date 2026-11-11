/**
 * The normalised scene graph the 3D view draws. Built by `toScene3D` from the app's records only;
 * nothing in here is invented. Where a record does not say something (a pole's height, a house's
 * shape) the 3D view uses a drawing default, and the panels say so.
 *
 * Coordinates are local metres: x = east, z = south (so north is -z), y = up. 1 unit = 1 metre.
 */

/**
 * Text the scene produces (a warning, a note), as a locale key with its values, so the panels show
 * it in the person's language. The keys are in `../i18n.ts`.
 */
export interface SceneText {
  key: string;
  values: Record<string, string | number>;
}

export interface LocalPoint {
  x: number;
  z: number;
}

export type LedState = 'off' | 'steady' | 'blink' | 'amber' | 'red';

/** How a 3D object came to be drawn: from a record, or as drawing furniture with no record. */
export type Provenance = 'record' | 'not_recorded';

/* ------------------------------------------------------------------ */
/* Central office                                                      */
/* ------------------------------------------------------------------ */

export type PonPortState = 'free' | 'in_use' | 'fault' | 'reserved';

export interface ScenePonPort {
  id: string;
  /** "PON 1/1/1", the vendor address, or the record id when nothing else is written. */
  label: string;
  portNumber: number;
  state: PonPortState;
  /** From a real device status row with its freshness, when there is one. */
  live?: { state: 'up' | 'down' | 'degraded' | 'unknown'; note: string; stale: boolean; test: boolean };
  led: LedState;
  customers: number;
  feederCableId?: string;
}

export interface SceneOlt {
  equipmentId: string;
  name: string;
  technology: string;
  ports: ScenePonPort[];
  /** Line cards drawn on the chassis face. From the recorded chassis when present. */
  cards: number;
  portsPerCard: number;
  /** True when card layout came from the recorded chassis; false when it was laid out by count. */
  cardsRecorded: boolean;
  status: string;
}

export interface SceneSwitch {
  equipmentId: string;
  name: string;
  type: string;
  /** RJ45 ports on the face. From logical ports, then total ports, then 24 as a drawing default. */
  ports: { number: number; inUse: boolean; led: LedState }[];
  portsRecorded: boolean;
  sfpUplinks: number;
  /** OLT this switch is recorded as uplinked to (a logical port link). */
  uplinkTo?: string;
}

export interface SceneOdf {
  equipmentId: string;
  name: string;
  ports: { number: number; inUse: boolean }[];
}

export type RackItem =
  | { kind: 'olt'; heightU: number; olt: SceneOlt }
  | { kind: 'switch'; heightU: number; sw: SceneSwitch }
  | { kind: 'odf'; heightU: number; odf: SceneOdf }
  | { kind: 'generic'; heightU: number; equipmentId: string; name: string; type: string };

export interface SceneRack {
  id: string;
  label: string;
  /** Where the rack's site is (the first OLT's map position). */
  position: LocalPoint;
  items: RackItem[];
  /** Rack furniture drawn so the rack looks real but not on record (UPS, blank panels). */
  furniture: Provenance;
}

/* ------------------------------------------------------------------ */
/* Outside plant                                                       */
/* ------------------------------------------------------------------ */

export interface ScenePole {
  id: string;
  name: string;
  position: LocalPoint;
  kind: 'telecom' | 'electric';
  /** Metres. From the record when written, else a drawing default. */
  height: number;
  heightRecorded: boolean;
}

export interface SceneSpan {
  id: string;
  fromId: string;
  toId: string;
  points: LocalPoint[];
  /** Power conductors drawn when one of the poles is an electric pole. */
  power: boolean;
}

export type BoxModel =
  | 'closure'
  | 'fat'
  | 'cabinet'
  | 'manhole'
  | 'slack'
  | 'ont'
  | 'catv_node'
  | 'catv_amp'
  | 'catv_tap'
  | 'entry'
  | 'marker'
  | 'generic';

export type BoxMount = 'strand' | 'pole' | 'wall' | 'ground' | 'underground';

export interface SceneBoxPort {
  number: number;
  state: 'free' | 'used' | 'fault' | 'reserved';
  customerId?: string;
}

export interface SceneBox {
  id: string;
  name: string;
  type: string;
  model: BoxModel;
  mount: BoxMount;
  position: LocalPoint;
  /** Splitters in this box, with their cascade level (1 = first after the PON port). */
  splitters: { id: string; name: string; ratio: string; level?: number }[];
  ports: SceneBoxPort[];
  status: string;
}

export type CableRole = 'feeder' | 'branch' | 'drop' | 'uplink' | 'other';

export interface SceneCable {
  id: string;
  name: string;
  role: CableRole;
  /** For a branch: the splitter level whose outputs it carries (1 = first splitter). */
  level?: number;
  ponKeys: string[];
  aerial: boolean;
  /** The drawn line. Empty when the cable has no drawn route. */
  points: LocalPoint[];
  /** True when the route is a straight schematic between two recorded ends (no drawn line). */
  schematic: boolean;
  startId?: string;
  endId?: string;
  /** Map line colour or role colour; never a fiber colour claim. */
  colorHex: string;
  customerId?: string;
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export interface ColorChip {
  name: string;
  hex: string;
}

export type PathHop =
  | { kind: 'pon'; oltId: string; ponId: string; label: string }
  | {
      kind: 'splitter';
      splitterId: string;
      boxId?: string;
      boxName: string;
      ratio: string;
      level: number;
      outPort?: number;
    }
  | { kind: 'gap'; text: string };

export interface CustomerPath {
  customerId: string;
  name: string;
  /** 1-based number shown on the house tag. */
  number: number;
  ponKey?: string;
  hops: PathHop[];
  /** "fiber": walked fiber by fiber from the PON port. "record": from the links written on the customer. */
  source: 'fiber' | 'record';
  complete: boolean;
  fatBoxId?: string;
  fatPort?: number;
  dropCableId?: string;
  dropCore?: number;
  /** Colour code of the FAT port (TIA-598 order of port numbers), a display convention. */
  portColor?: ColorChip;
  /** The drop fiber's colour from the drop cable's recorded scheme. Absent: not known. */
  fiberColor?: ColorChip;
  fiberColorNote: string;
  /** Plain-words path, for example "PON 1/1/1 → FDT-1 out 2 → FAT-7 port 5 (Slate drop fiber)". */
  text: string;
  houseId: string;
  live?: { state: string; label: string; fault: boolean };
}

export interface SceneHouse {
  id: string;
  position: LocalPoint;
  /** Radians around y. The front faces the serving box when it is known. */
  yaw: number;
  customerIds: string[];
  /** Deterministic 0..1 from the first customer id; picks colours. */
  seed: number;
  /** Several customers at one point are drawn as a block of this many floors. */
  floors: number;
  fault: boolean;
  /** Smallest house number of the customers inside. */
  number: number;
}

/* ------------------------------------------------------------------ */
/* PON summary                                                         */
/* ------------------------------------------------------------------ */

export interface PonLevelSummary {
  level: number;
  ratios: string[];
  boxes: number;
  splitterIds: string[];
}

export interface PonSummary {
  key: string;
  oltId: string;
  ponId: string;
  label: string;
  levels: PonLevelSummary[];
  /** Product of the largest ratio at each level, such as 4 × 4 × 8 = 128. */
  designPorts: number;
  /** Outputs of the last-level splitters that are actually built. */
  builtPorts: number;
  used: number;
  spare: number;
  budget?: {
    totalLossDb: number;
    splitterLossDb: number;
    fiberLossDb: number;
    connectorLossDb: number;
    spliceLossDb: number;
    distanceMeters: number;
    connectors: number;
    splices: number;
    opticsClass: string;
    classMaxLossDb: number;
    fits: boolean;
    recommendation: SceneText;
  };
  warnings: SceneText[];
  source: 'fiber' | 'record' | 'mixed';
}

export interface Scene3D {
  origin: { lat: number; lng: number };
  /** Half-size of the area holding everything, in metres. */
  extent: number;
  center: LocalPoint;
  racks: SceneRack[];
  poles: ScenePole[];
  spans: SceneSpan[];
  boxes: SceneBox[];
  cables: SceneCable[];
  houses: SceneHouse[];
  customers: CustomerPath[];
  pons: PonSummary[];
  /** Plain-words notes about what is missing or drawn from defaults. */
  notes: SceneText[];
  isDemo: boolean;
}
