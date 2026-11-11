import {
  BUILDING_KINDS,
  type Cable,
  CABLE_INSTALLATION_TYPES,
  CABLE_STATUSES,
  CABLE_TYPES,
  type CellValue,
  CLOSURE_CONDITIONS,
  type Customer,
  CUSTOMER_STATUSES,
  type Duct,
  type Equipment,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_STATUSES,
  type Fault,
  type JointClosure,
  type NetworkSnapshot,
  type NetworkZone,
  type Ont,
  OSP_CONDITIONS,
  ROUTE_STATUSES,
  SEAL_STATUSES,
  type SlackLoop,
  type Span,
  type SpliceRecord,
  type Splitter,
  SPLITTER_KINDS,
  SPLITTER_STATUSES,
  STRUCTURE_STATUSES,
  WAY_CONDITIONS,
  ZONE_STATUSES,
} from '@fibergis/shared';

import { equipmentLayerOf } from '../map/layerFilters';
import type { SelectableCollection } from '../selection/selectionModel';

/**
 * Phase 16: the attribute table's layers and columns. Each column reads one recorded value; a
 * value nobody recorded is `undefined` and shows "Not recorded". Columns that can be changed for
 * many records at once name the record field they write (`edit`), and only fields listed in
 * `BULK_EDITABLE_FIELDS` (shared) are accepted there.
 */

export type ColumnType = 'text' | 'number' | 'date' | 'enum' | 'boolean';

export interface TableContext {
  equipmentById: ReadonlyMap<string, Equipment>;
  cableById: ReadonlyMap<string, Cable>;
}

export interface TableColumn<R = unknown> {
  key: string;
  label: string;
  type: ColumnType;
  get: (row: R, ctx: TableContext) => CellValue;
  /** Width in pixels. */
  width: number;
  /** Choices for enum columns (filter and bulk edit). */
  options?: readonly string[];
  /** The record field bulk edit writes for this column. `required`: it cannot be cleared. */
  edit?: { field: string; required?: boolean };
  /** Hidden until a person shows it. */
  hidden?: boolean;
  mono?: boolean;
}

export interface TableLayer<R = unknown> {
  id: string;
  label: string;
  /** The records rows stand for, in the selection and in bulk edit. */
  collection: SelectableCollection;
  rows: (data: NetworkSnapshot) => readonly R[];
  /** Unique per row. */
  rowId: (row: R) => string;
  /** The record the row stands for (a splice row stands for its closure). */
  recordId: (row: R) => string;
  columns: TableColumn<R>[];
  /** Bulk edit is offered. */
  editable: boolean;
  /** A line under the table, such as why it cannot be changed here. */
  note?: string;
}

const text = (v: unknown): CellValue => (typeof v === 'string' ? (v.trim() ? v : undefined) : typeof v === 'number' || typeof v === 'boolean' ? v : undefined);
const num = (v: unknown): CellValue => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const nameOf = (map: ReadonlyMap<string, { name: string }>, id: string | undefined): CellValue => (id ? (map.get(id)?.name ?? `${id} (not on record)`) : undefined);

function col<R>(key: string, label: string, get: (r: R, ctx: TableContext) => CellValue, extra: Partial<TableColumn<R>> = {}): TableColumn<R> {
  return { key, label, type: 'text', get, width: 150, ...extra };
}

const idCol = <R extends { id: string }>(): TableColumn<R> => col<R>('id', 'ID', (r) => r.id, { width: 130, mono: true });

/* ------------------------------------------------------------------ */
/* Equipment                                                           */
/* ------------------------------------------------------------------ */

const equipmentColumns: TableColumn<Equipment>[] = [
  idCol<Equipment>(),
  col('name', 'Name', (e) => text(e.name), { width: 180 }),
  col('type', 'Kind', (e) => text(e.type), { width: 150 }),
  col('status', 'Status', (e) => text(e.status), { type: 'enum', options: EQUIPMENT_STATUSES, edit: { field: 'status', required: true }, width: 110 }),
  col('area', 'Area', (e) => text(e.area), { edit: { field: 'area', required: true } }),
  col('street', 'Street', (e) => text(e.street), { edit: { field: 'street', required: true }, width: 170 }),
  col('manufacturer', 'Make', (e) => text(e.manufacturer), { edit: { field: 'manufacturer' } }),
  col('model', 'Model', (e) => text(e.model), { edit: { field: 'model' } }),
  col('serialNumber', 'Serial number', (e) => text(e.serialNumber), { mono: true }),
  col('tagCode', 'Tag (QR)', (e) => text(e.tagCode), { mono: true, width: 120 }),
  col('poleNumber', 'Pole number', (e) => text(e.poleNumber), { width: 120 }),
  col('ownerPoleNumber', "Owner's pole number", (e) => text(e.ownerPoleNumber), { width: 150, hidden: true }),
  col('ownerName', 'Owner', (e) => text(e.ownerName), { edit: { field: 'ownerName' }, width: 120 }),
  col('condition', 'Condition', (e) => text(e.condition), { type: 'enum', options: EQUIPMENT_CONDITIONS, edit: { field: 'condition' }, width: 110 }),
  col('totalPorts', 'Ports', (e) => num(e.totalPorts), { type: 'number', width: 80 }),
  col('usedPorts', 'Ports used', (e) => num(e.usedPorts), { type: 'number', width: 100 }),
  col('installedDate', 'Installed', (e) => text(e.installedDate), { type: 'date', edit: { field: 'installedDate', required: true }, width: 110 }),
  col('warrantyUntil', 'Warranty until', (e) => text(e.warrantyUntil), { type: 'date', edit: { field: 'warrantyUntil' }, width: 120, hidden: true }),
  col('ipAddress', 'IP address', (e) => text(e.ipAddress), { mono: true, hidden: true }),
  col('lat', 'Latitude', (e) => num(e.lat), { type: 'number', width: 110, hidden: true }),
  col('lng', 'Longitude', (e) => num(e.lng), { type: 'number', width: 110, hidden: true }),
  col('notes', 'Notes', (e) => text(e.notes), { edit: { field: 'notes' }, width: 200, hidden: true }),
];

const equipmentLayer = (id: string, label: string, kinds: readonly string[] | null): TableLayer<Equipment> => ({
  id,
  label,
  collection: 'equipment',
  rows: (d) => (kinds ? d.equipment.filter((e) => kinds.includes(equipmentLayerOf(e))) : d.equipment),
  rowId: (e) => e.id,
  recordId: (e) => e.id,
  columns: equipmentColumns,
  editable: true,
});

/* ------------------------------------------------------------------ */
/* Other layers                                                        */
/* ------------------------------------------------------------------ */

const cableLayer: TableLayer<Cable> = {
  id: 'cables',
  label: 'Cables',
  collection: 'cables',
  rows: (d) => d.cables,
  rowId: (c) => c.id,
  recordId: (c) => c.id,
  editable: true,
  columns: [
    idCol<Cable>(),
    col('name', 'Name', (c) => text(c.name), { width: 180 }),
    col('type', 'Kind', (c) => text(c.type), { type: 'enum', options: CABLE_TYPES, width: 150 }),
    col('status', 'Status', (c) => text(c.status), { type: 'enum', options: CABLE_STATUSES, edit: { field: 'status', required: true }, width: 110 }),
    col('routeStatus', 'Route status', (c) => text(c.routeStatus), { type: 'enum', options: ROUTE_STATUSES, edit: { field: 'routeStatus' }, width: 130 }),
    col('fiberCount', 'Fibres', (c) => (c.fiberCount > 0 ? c.fiberCount : undefined), { type: 'number', width: 80 }),
    col('fibresInUse', 'Fibres with a record', (c) => (c.cores.length > 0 ? c.cores.length : undefined), { type: 'number', width: 150, hidden: true }),
    col('lengthMeters', 'Drawn length (m)', (c) => (c.lengthMeters > 0 ? Math.round(c.lengthMeters) : undefined), { type: 'number', width: 140 }),
    col('opticalLengthMeters', 'OTDR length (m)', (c) => num(c.opticalLengthMeters), { type: 'number', width: 130, hidden: true }),
    col('installationType', 'Installed as', (c) => text(c.installationType), { type: 'enum', options: CABLE_INSTALLATION_TYPES, edit: { field: 'installationType' }, width: 120 }),
    col('owner', 'Owner', (c) => text(c.owner), { edit: { field: 'owner', required: true }, width: 120 }),
    col('manufacturer', 'Make', (c) => text(c.manufacturer), { edit: { field: 'manufacturer' } }),
    col('model', 'Model', (c) => text(c.model), { edit: { field: 'model' } }),
    col('start', 'From', (c, ctx) => nameOf(ctx.equipmentById, c.startEquipmentId), { width: 160 }),
    col('end', 'To', (c, ctx) => nameOf(ctx.equipmentById, c.endEquipmentId), { width: 160 }),
    col('installationDate', 'Installed', (c) => text(c.installationDate), { type: 'date', width: 110 }),
    col('remarks', 'Remarks', (c) => text(c.remarks), { edit: { field: 'remarks' }, width: 200, hidden: true }),
  ],
};

const customerLayer: TableLayer<Customer> = {
  id: 'customers',
  label: 'Customers',
  collection: 'customers',
  rows: (d) => d.customers,
  rowId: (c) => c.id,
  recordId: (c) => c.id,
  editable: true,
  note: 'Connections, ONTs and status changes (disconnect, move) are made on each customer, so their history is kept.',
  columns: [
    idCol<Customer>(),
    col('name', 'Name', (c) => text(c.name), { width: 180 }),
    col('status', 'Status', (c) => text(c.status), { type: 'enum', options: CUSTOMER_STATUSES, width: 140 }),
    col('area', 'Area', (c) => text(c.area), { edit: { field: 'area', required: true } }),
    col('building', 'Building', (c) => text(c.building), { edit: { field: 'building' } }),
    col('address', 'Address', (c) => text(c.address), { width: 220 }),
    col('plan', 'Plan (as written)', (c) => text(c.plan), { edit: { field: 'plan', required: true }, width: 140 }),
    col('serviceType', 'Service', (c) => text(c.serviceType), { width: 130 }),
    col('ontSerialNumber', 'ONT serial', (c) => text(c.ontSerialNumber), { mono: true }),
    col('box', 'Box', (c, ctx) => nameOf(ctx.equipmentById, c.terminalBoxId || undefined), { width: 150 }),
    col('ponPort', 'PON port', (c) => text(c.ponPort), { width: 110 }),
    col('mobile', 'Phone', (c) => text(c.mobile), { width: 130, hidden: true }),
    col('installationDate', 'Installed', (c) => text(c.installationDate), { type: 'date', width: 110, hidden: true }),
  ],
};

const closureLayer: TableLayer<JointClosure> = {
  id: 'closures',
  label: 'Closures',
  collection: 'closures',
  rows: (d) => d.closures,
  rowId: (c) => c.id,
  recordId: (c) => c.id,
  editable: true,
  columns: [
    idCol<JointClosure>(),
    col('name', 'Name', (c) => text(c.name), { width: 180 }),
    col('closureType', 'Kind', (c) => text(c.closureType), { width: 160 }),
    col('area', 'Area', (c) => text(c.area), { edit: { field: 'area', required: true } }),
    col('splices', 'Splices on record', (c) => c.splices.filter((s) => !s.retiredAt).length, { type: 'number', width: 140 }),
    col('condition', 'Condition', (c) => text(c.condition), { type: 'enum', options: CLOSURE_CONDITIONS, edit: { field: 'condition' }, width: 130 }),
    col('sealStatus', 'Seal', (c) => text(c.sealStatus), { type: 'enum', options: SEAL_STATUSES, edit: { field: 'sealStatus' }, width: 100 }),
    col('technician', 'Technician', (c) => text(c.technician), { edit: { field: 'technician', required: true } }),
    col('installationDate', 'Installed', (c) => text(c.installationDate), { type: 'date', width: 110 }),
    col('remarks', 'Remarks', (c) => text(c.remarks), { edit: { field: 'remarks' }, width: 200, hidden: true }),
  ],
};

const splitterLayer: TableLayer<Splitter> = {
  id: 'splitters',
  label: 'Splitters',
  collection: 'splitters',
  rows: (d) => d.splitters,
  rowId: (s) => s.id,
  recordId: (s) => s.id,
  editable: true,
  note: 'Inputs and outputs are linked on the box itself, never here.',
  columns: [
    idCol<Splitter>(),
    col('name', 'Name', (s) => text(s.name), { width: 170 }),
    col('ratio', 'Ratio', (s) => text(s.ratio), { width: 80 }),
    col('status', 'Status', (s) => text(s.status), { type: 'enum', options: SPLITTER_STATUSES, edit: { field: 'status', required: true }, width: 120 }),
    col('box', 'Box', (s, ctx) => nameOf(ctx.equipmentById, s.terminalBoxId), { width: 160 }),
    col('outputsUsed', 'Outputs with a customer', (s) => s.outputPorts.filter((p) => !!p.connectedCustomerId).length, { type: 'number', width: 170 }),
    col('kind', 'Build', (s) => text(s.kind), { type: 'enum', options: SPLITTER_KINDS, edit: { field: 'kind' }, width: 90 }),
    col('manufacturer', 'Make', (s) => text(s.manufacturer), { edit: { field: 'manufacturer' } }),
    col('model', 'Model', (s) => text(s.model), { edit: { field: 'model' } }),
    col('insertionLossDb', 'Loss (dB)', (s) => num(s.insertionLossDb), { type: 'number', width: 100 }),
    col('lossSource', 'Loss from', (s) => text(s.lossSource), { width: 160, hidden: true }),
  ],
};

const ductLayer: TableLayer<Duct> = {
  id: 'ducts',
  label: 'Ducts',
  collection: 'ducts',
  rows: (d) => d.ducts,
  rowId: (x) => x.id,
  recordId: (x) => x.id,
  editable: true,
  columns: [
    idCol<Duct>(),
    col('name', 'Name', (x) => text(x.name), { width: 170 }),
    col('status', 'Status', (x) => text(x.status), { type: 'enum', options: STRUCTURE_STATUSES, edit: { field: 'status', required: true }, width: 110 }),
    col('from', 'From', (x, ctx) => nameOf(ctx.equipmentById, x.fromStructureId), { width: 150 }),
    col('to', 'To', (x, ctx) => nameOf(ctx.equipmentById, x.toStructureId), { width: 150 }),
    col('cables', 'Cables in it', (x) => x.cableIds.length + x.subducts.reduce((n, s) => n + s.cableIds.length, 0), { type: 'number', width: 110 }),
    col('wayCount', 'Ways', (x) => num(x.wayCount), { type: 'number', width: 80 }),
    col('material', 'Material', (x) => text(x.material), { edit: { field: 'material' }, width: 110 }),
    col('ownerName', 'Owner', (x) => text(x.ownerName), { edit: { field: 'ownerName' }, width: 120 }),
    col('condition', 'Condition', (x) => text(x.condition), { type: 'enum', options: WAY_CONDITIONS, edit: { field: 'condition' }, width: 110 }),
    col('conditionNote', 'Condition note', (x) => text(x.conditionNote), { edit: { field: 'conditionNote' }, width: 180, hidden: true }),
  ],
};

const spanLayer: TableLayer<Span> = {
  id: 'spans',
  label: 'Spans',
  collection: 'spans',
  rows: (d) => d.spans,
  rowId: (x) => x.id,
  recordId: (x) => x.id,
  editable: true,
  note: 'Setting a status records who confirmed it and when, as on one span.',
  columns: [
    idCol<Span>(),
    col('name', 'Name', (x) => text(x.name), { width: 170 }),
    col('status', 'Status', (x) => text(x.status), { type: 'enum', options: STRUCTURE_STATUSES.filter((s) => s !== 'proposed'), edit: { field: 'status', required: true }, width: 110 }),
    col('from', 'From pole', (x, ctx) => nameOf(ctx.equipmentById, x.fromStructureId), { width: 150 }),
    col('to', 'To pole', (x, ctx) => nameOf(ctx.equipmentById, x.toStructureId), { width: 150 }),
    col('measuredLengthMeters', 'Measured length (m)', (x) => num(x.measuredLengthMeters), { type: 'number', width: 150 }),
    col('basis', 'Recorded from', (x) => text(x.basis), { width: 150 }),
    col('condition', 'Condition', (x) => text(x.condition), { type: 'enum', options: OSP_CONDITIONS, edit: { field: 'condition' }, width: 110 }),
    col('confirmedBy', 'Confirmed by', (x) => text(x.confirmedBy), { width: 130, hidden: true }),
  ],
};

const slackLayer: TableLayer<SlackLoop> = {
  id: 'slackLoops',
  label: 'Slack loops',
  collection: 'slackLoops',
  rows: (d) => d.slackLoops,
  rowId: (x) => x.id,
  recordId: (x) => x.id,
  editable: true,
  columns: [
    idCol<SlackLoop>(),
    col('name', 'Name', (x) => text(x.name), { width: 170 }),
    col('cable', 'Cable', (x, ctx) => nameOf(ctx.cableById, x.cableId), { width: 170 }),
    col('lengthMeters', 'Length (m)', (x) => num(x.lengthMeters), { type: 'number', width: 100 }),
    col('lengthSource', 'Length from', (x) => text(x.lengthSource), { width: 110 }),
    col('notes', 'Notes', (x) => text(x.notes), { edit: { field: 'notes' }, width: 200 }),
  ],
};

const faultLayer: TableLayer<Fault> = {
  id: 'faults',
  label: 'Faults',
  collection: 'faults',
  rows: (d) => d.faults,
  rowId: (x) => x.id,
  recordId: (x) => x.id,
  editable: false,
  note: 'Faults move through their steps in Faults and field work, where each needs its check. They are not changed here.',
  columns: [
    idCol<Fault>(),
    col('title', 'Title', (x) => text(x.title), { width: 220 }),
    col('status', 'Status', (x) => text(x.status), { width: 120 }),
    col('severity', 'Severity', (x) => text(x.severity), { width: 100 }),
    col('type', 'Kind', (x) => text(x.type), { width: 140 }),
    col('reportedAt', 'Reported', (x) => text(x.reportedAt), { type: 'date', width: 170 }),
    col('assignedTechnician', 'Technician', (x) => text(x.assignedTechnician), { width: 140 }),
    col('isTest', 'TEST', (x) => (x.isTest ? true : undefined), { type: 'boolean', width: 70 }),
  ],
};

const zoneLayer: TableLayer<NetworkZone> = {
  id: 'zones',
  label: 'Zones',
  collection: 'zones',
  rows: (d) => d.zones,
  rowId: (x) => x.id,
  recordId: (x) => x.id,
  editable: true,
  columns: [
    idCol<NetworkZone>(),
    col('name', 'Name', (x) => text(x.name), { width: 170 }),
    col('areaCode', 'Area code', (x) => text(x.areaCode), { width: 110 }),
    col('status', 'Status', (x) => text(x.status), { type: 'enum', options: ZONE_STATUSES, edit: { field: 'status', required: true }, width: 120 }),
    col('corners', 'Boundary corners', (x) => (x.boundaryCoords.length > 0 ? x.boundaryCoords.length : undefined), { type: 'number', width: 140 }),
  ],
};

const ontLayer: TableLayer<Ont> = {
  id: 'onts',
  label: 'ONTs',
  collection: 'onts',
  rows: (d) => d.onts,
  rowId: (x) => x.id,
  recordId: (x) => x.id,
  editable: true,
  note: 'Serials are kept exactly as entered and are not changed here.',
  columns: [
    idCol<Ont>(),
    col('serialNumber', 'Serial number', (x) => text(x.serialNumber), { mono: true, width: 160 }),
    col('status', 'Status', (x) => text(x.status), { width: 110 }),
    col('vendor', 'Make', (x) => text(x.vendor), { edit: { field: 'vendor' } }),
    col('model', 'Model', (x) => text(x.model), { edit: { field: 'model' } }),
    col('firmware', 'Firmware', (x) => text(x.firmware), { edit: { field: 'firmware' }, width: 120 }),
    col('onuAddress', 'Address on the OLT', (x) => text(x.onuAddress), { width: 160 }),
  ],
};

const buildingLayer: TableLayer<NetworkSnapshot['buildings'][number]> = {
  id: 'buildings',
  label: 'Buildings',
  collection: 'buildings',
  rows: (d) => d.buildings,
  rowId: (x) => x.id,
  recordId: (x) => x.id,
  editable: true,
  columns: [
    idCol(),
    col('name', 'Name', (x) => text(x.name), { width: 180 }),
    col('kind', 'Kind', (x) => text(x.kind), { type: 'enum', options: BUILDING_KINDS, edit: { field: 'kind', required: true }, width: 120 }),
    col('address', 'Address', (x) => text(x.address), { width: 220 }),
    col('units', 'Units', (x) => (x.units.length > 0 ? x.units.length : undefined), { type: 'number', width: 80 }),
    col('notes', 'Notes', (x) => text(x.notes), { edit: { field: 'notes' }, width: 200, hidden: true }),
  ],
};

interface SpliceRow extends SpliceRecord {
  closureId: string;
  closureName: string;
}

const spliceLayer: TableLayer<SpliceRow> = {
  id: 'splices',
  label: 'Splices',
  collection: 'closures',
  rows: (d) => d.closures.flatMap((c) => c.splices.map((s) => ({ ...s, closureId: c.id, closureName: c.name }))),
  rowId: (s) => `${s.closureId}#${s.id}`,
  recordId: (s) => s.closureId,
  editable: false,
  note: 'A splice row stands for its closure on the map. Splices are made and taken out in the closure, so their history is kept.',
  columns: [
    col('id', 'Splice', (s) => s.id, { mono: true, width: 130 }),
    col('closure', 'Closure', (s) => text(s.closureName), { width: 160 }),
    col('input', 'From', (s) => `${s.inputCableName || s.inputCableId} fibre ${s.inputCore}`, { width: 190 }),
    col('output', 'To', (s) => `${s.outputCableName || s.outputCableId} fibre ${s.outputCore}`, { width: 190 }),
    col('status', 'Status', (s) => (s.retiredAt ? (s.enteredInError ? 'Entered by mistake' : 'Taken out') : text(s.status)), { width: 140 }),
    col('spliceLossDb', 'Loss (dB)', (s) => num(s.spliceLossDb), { type: 'number', width: 100 }),
    // An older loss with no origin says so; it is never shown as measured.
    col('lossSource', 'Loss origin', (s) => (s.spliceLossDb === undefined ? undefined : (text(s.lossSource) ?? 'origin not recorded')), { width: 140 }),
    col('technician', 'Technician', (s) => text(s.technician), { width: 130 }),
    col('date', 'Date', (s) => text(s.date), { type: 'date', width: 110 }),
  ],
};

export const TABLE_LAYERS: TableLayer[] = [
  equipmentLayer('equipment', 'All equipment', null),
  equipmentLayer('olts', 'OLTs', ['olt']),
  equipmentLayer('odfs', 'ODFs', ['odf']),
  equipmentLayer('boxes', 'Boxes (FAT, FDT, FDMS)', ['fat', 'fdt', 'fdms']),
  equipmentLayer('poles', 'Poles', ['poles']),
  equipmentLayer('chambers', 'Manholes and chambers', ['manholes']),
  equipmentLayer('splitterPins', 'Splitter pins', ['splitters']),
  equipmentLayer('cableTv', 'Cable TV equipment', ['cableTv']),
  equipmentLayer('otherEquipment', 'Other equipment', ['otherEquipment']),
  cableLayer,
  customerLayer,
  closureLayer,
  spliceLayer,
  splitterLayer,
  ductLayer,
  spanLayer,
  slackLayer,
  faultLayer,
  zoneLayer,
  ontLayer,
  buildingLayer,
] as unknown as TableLayer[];

export const layerById = (id: string | undefined): TableLayer => TABLE_LAYERS.find((l) => l.id === id) ?? TABLE_LAYERS[0];

/** The first layer showing records of this collection (for "open table" from the map). */
export const layerForCollection = (collection: SelectableCollection): TableLayer =>
  TABLE_LAYERS.find((l) => l.collection === collection && l.id !== 'splices') ?? TABLE_LAYERS[0];

/** Lookups the columns need, built once per network version. */
export function tableContext(data: Pick<NetworkSnapshot, 'equipment' | 'cables'>): TableContext {
  return { equipmentById: new Map(data.equipment.map((e) => [e.id, e])), cableById: new Map(data.cables.map((c) => [c.id, c])) };
}
