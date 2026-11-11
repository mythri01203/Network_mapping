import type { NetworkSnapshot } from '../model/collections';
import { STRUCTURE_STATUS_LABELS, WAY_CONDITION_LABELS } from '../model/enums';
import type { Customer } from '../model/types';
import { VALIDATION_FINDING_PRESENCE_LABELS, VALIDATION_FINDING_STATE_LABELS } from '../model/validationFindingSchemas';
import { ACCOUNT_ROLE_LABELS } from './access';
import { cablesOnPoles } from './capacityPlanning';
import { customerPathCache, customerPathFromLinks, findCustomerPathFindings, isPonCustomer } from './customerPath';
import { buildFiberIndex, coreKey, isSpliceActive } from './fiberIndex';
import { ductCapacity, ductPlaces, formatFill, placeFill } from './ospDucts';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { cableLengths, isPoleType, spanDrawnMeters } from './outsidePlant';
import { type AuditEvent, WRITE_SOURCE_LABELS } from './recordHistory';
// Types only: `reports.ts` imports this file, so no values come back from it.
import type { ReportCell, ReportColumn, ReportFilters, ReportTable } from './reports';
import { sortFindings } from './validationFindings';

/**
 * Network mapping Phase 22 (M30): the reports that were still missing, built only from the records.
 * Each one says which record lists it read (`sources`) and which settings it used (`settingsUsed`).
 * Nothing recorded is never counted as zero or as free: it says "Not recorded". Links are only the
 * ones a person recorded, never worked out from position. Customers are named by id only: no
 * names, addresses or house positions are written in any of these reports.
 */

export type RecordReportData = Pick<NetworkSnapshot, 'equipment' | 'cables' | 'splitters' | 'closures' | 'customers'> &
  Partial<Pick<NetworkSnapshot, 'spans' | 'attachments' | 'ducts' | 'slackLoops' | 'permissions' | 'onts' | 'validationFindings'>>;

export interface RecordReportOptions {
  filters?: ReportFilters;
  osp?: OspSettings;
  /** `YYYY-MM-DD`, for "permission ended". */
  today?: string;
}

const NOT_RECORDED = 'Not recorded';

const col = (key: string, label: string): ReportColumn => ({ key, label });

const lists = <T>(list: readonly T[] | undefined): readonly T[] => list ?? [];

const areaMatches = (area: string | undefined, filters: ReportFilters): boolean =>
  !filters.area?.trim() || (area ?? '').trim().toLowerCase() === filters.area.trim().toLowerCase();

const areaNote = (filters: ReportFilters, what: string): string[] => (filters.area?.trim() ? [`Only ${what} with area "${filters.area.trim()}".`] : []);

/** "Name (ID)", or the id alone when the name is the id, or "ID (not on record)". */
function nameOf(byId: ReadonlyMap<string, { name: string }>, id: string | undefined): string {
  if (!id) return NOT_RECORDED;
  const found = byId.get(id);
  if (!found) return `${id} (not on record)`;
  return found.name && found.name !== id ? `${found.name} (${id})` : id;
}

const isChamberType = (type: string): boolean => /Manhole|Handhole|Chamber/i.test(type);

const m = (meters: number) => Math.round(meters);

const ofN = (n: number, total: number) => `${n} of ${total}`;

/* ------------------------------------------------------------------ */
/* Cable inventory                                                     */
/* ------------------------------------------------------------------ */

function cableInventoryReport(data: RecordReportData): ReportTable {
  const equipment = new Map(lists(data.equipment).map((e) => [e.id, e]));
  const cables = [...lists(data.cables)].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  let noOwner = 0;
  let noInstall = 0;
  let noScheme = 0;
  let endMissing = 0;
  const rows = cables.map((c) => {
    const l = cableLengths(c, lists(data.slackLoops));
    if (!c.owner?.trim()) noOwner += 1;
    if (!c.installationType) noInstall += 1;
    if (!c.colorScheme && c.fiberCount > 0) noScheme += 1;
    if (!c.startEquipmentId || !c.endEquipmentId || !equipment.has(c.startEquipmentId) || !equipment.has(c.endEquipmentId)) endMissing += 1;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      route: c.routeStatus ?? NOT_RECORDED,
      fibres: c.fiberCount,
      installation: c.installationType ?? NOT_RECORDED,
      owner: c.owner?.trim() || NOT_RECORDED,
      make: [c.manufacturer, c.model].filter((s) => s?.trim()).join(' ') || NOT_RECORDED,
      from: nameOf(equipment, c.startEquipmentId),
      to: nameOf(equipment, c.endEquipmentId),
      drawn: l.drawnMeters !== undefined ? m(l.drawnMeters) : 'No line drawn',
      sheath: l.sheathMeters !== undefined ? m(l.sheathMeters) : NOT_RECORDED,
      optical: l.opticalMeters !== undefined ? m(l.opticalMeters) : NOT_RECORDED,
      slack: l.slackCount > 0 ? `${m(l.slackMeters)} m in ${l.slackCount} loop(s)` : 'None recorded',
      scheme: c.fiberCount > 0 ? (c.colorScheme ?? 'Not known') : '',
    };
  });
  return {
    id: 'cable-inventory',
    title: 'Cable inventory: every cable as recorded',
    definition:
      'One row per cable record, with its fields as typed. Drawn length is worked out from the line on the map; sheath length from the marks a person read at both ends; optical length from an OTDR. The three are never mixed or added together. Ends are the items a person linked the cable to.',
    sources: ['Cables', 'Network items (for the names at each end)', 'Slack loops'],
    settingsUsed: [],
    columns: [
      col('id', 'Cable id'),
      col('name', 'Name'),
      col('type', 'Type'),
      col('status', 'Status'),
      col('route', 'Route status'),
      col('fibres', 'Fibres'),
      col('installation', 'Installation'),
      col('owner', 'Owner'),
      col('make', 'Make and model'),
      col('from', 'From'),
      col('to', 'To'),
      col('drawn', 'Drawn (m)'),
      col('sheath', 'Sheath (m)'),
      col('optical', 'Optical (m)'),
      col('slack', 'Slack'),
      col('scheme', 'Colour scheme'),
    ],
    rows,
    notes:
      rows.length === 0
        ? ['No cable records yet.']
        : [
            ...(noOwner ? [`${noOwner} cable(s) have no owner recorded.`] : []),
            ...(noInstall ? [`${noInstall} cable(s) do not say how they were installed.`] : []),
            ...(noScheme ? [`${noScheme} cable(s) have no colour scheme recorded: their fibre colours are not known (never assumed TIA-598).`] : []),
            ...(endMissing ? [`${endMissing} cable(s) have an end that is not recorded or not on record. See "Cables not connected".`] : []),
          ],
  };
}

/* ------------------------------------------------------------------ */
/* Outside plant summary                                               */
/* ------------------------------------------------------------------ */

function ospSummaryReport(data: RecordReportData, filters: ReportFilters): ReportTable {
  const equipment = lists(data.equipment).filter((e) => areaMatches(e.area, filters));
  const spans = lists(data.spans);
  const ducts = lists(data.ducts);
  const attachments = lists(data.attachments);
  const loops = lists(data.slackLoops);
  const permissions = lists(data.permissions);
  const rows: Record<string, ReportCell>[] = [];
  const group = <T>(items: readonly T[], key: (t: T) => string) => {
    const map = new Map<string, T[]>();
    for (const item of items) (map.get(key(item)) ?? map.set(key(item), []).get(key(item))!).push(item);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  const onPole = new Set(attachments.filter((a) => a.structureId).map((a) => a.structureId!));
  const withPermission = new Set(permissions.flatMap((p) => p.structureIds));
  for (const [status, poles] of group(
    equipment.filter((e) => isPoleType(e.type)),
    (e) => e.status,
  )) {
    const n = poles.length;
    rows.push({
      kind: 'Pole',
      status,
      count: n,
      details: [
        `owner recorded on ${ofN(poles.filter((p) => p.ownerName?.trim() || p.ownerType).length, n)}`,
        `pole number on ${ofN(poles.filter((p) => p.poleNumber?.trim() || p.ownerPoleNumber?.trim()).length, n)}`,
        `cable allowance on ${ofN(poles.filter((p) => p.attachmentCapacity !== undefined).length, n)}`,
        `a cable recorded on the pole itself on ${ofN(poles.filter((p) => onPole.has(p.id)).length, n)}`,
        `a permission record on ${ofN(poles.filter((p) => withPermission.has(p.id)).length, n)}`,
        `condition on ${ofN(poles.filter((p) => p.condition).length, n)}`,
      ].join('; '),
    });
  }
  const ductEnds = new Set(ducts.flatMap((d) => [d.fromStructureId, d.toStructureId]).filter((id): id is string => !!id));
  for (const [key, chambers] of group(
    equipment.filter((e) => isChamberType(e.type)),
    (e) => `${e.type}\u0000${e.status}`,
  )) {
    const [type, status] = key.split('\u0000');
    const n = chambers.length;
    rows.push({
      kind: type,
      status,
      count: n,
      details: [`a duct recorded as ending at it on ${ofN(chambers.filter((c) => ductEnds.has(c.id)).length, n)}`, `condition on ${ofN(chambers.filter((c) => c.condition).length, n)}`].join('; '),
    });
  }
  const allEquipment = lists(data.equipment);
  const spanCables = new Set(attachments.filter((a) => a.spanId).map((a) => a.spanId!));
  for (const [status, list] of group(spans, (s) => s.status)) {
    const n = list.length;
    const measured = list.filter((s) => s.measuredLengthMeters !== undefined);
    const drawn = list.map((s) => spanDrawnMeters(s, allEquipment)).filter((v): v is number => v !== undefined);
    rows.push({
      kind: 'Span (pole to pole)',
      status: STRUCTURE_STATUS_LABELS[status as keyof typeof STRUCTURE_STATUS_LABELS] ?? status,
      count: n,
      details: [
        measured.length > 0
          ? `measured length on ${ofN(measured.length, n)} (${m(measured.reduce((t, s) => t + (s.measuredLengthMeters ?? 0), 0))} m measured)`
          : `measured length on 0 of ${n}`,
        drawn.length > 0 ? `map distance ${m(drawn.reduce((t, v) => t + v, 0))} m over ${ofN(drawn.length, n)} (drawn, not measured)` : 'map distance not known (poles not on record)',
        `a cable recorded on ${ofN(list.filter((s) => spanCables.has(s.id)).length, n)}`,
        `road crossing on ${list.filter((s) => s.roadCrossing).length}`,
      ].join('; '),
    });
  }
  for (const [status, list] of group(ducts, (d) => d.status)) {
    const n = list.length;
    const used = list.filter((d) => d.cableIds.length > 0 || d.subducts.some((s) => s.cableIds.length > 0 || (s.microducts ?? []).some((mi) => mi.cableIds.length > 0)));
    rows.push({
      kind: 'Duct',
      status: STRUCTURE_STATUS_LABELS[status as keyof typeof STRUCTURE_STATUS_LABELS] ?? status,
      count: n,
      details: [
        `number of ways on ${ofN(list.filter((d) => d.wayCount !== undefined).length, n)}`,
        `inside diameter on ${ofN(list.filter((d) => d.innerDiameterMm !== undefined).length, n)}`,
        `a cable recorded in it on ${ofN(used.length, n)}`,
        `both ends recorded on ${ofN(list.filter((d) => d.fromStructureId && d.toStructureId).length, n)}`,
      ].join('; '),
    });
  }
  for (const [status, list] of group(attachments, (a) => a.status)) {
    rows.push({
      kind: 'Cable on a pole or span (attachment)',
      status: STRUCTURE_STATUS_LABELS[status as keyof typeof STRUCTURE_STATUS_LABELS] ?? status,
      count: list.length,
      details: `on a pole ${list.filter((a) => a.structureId).length}; on a span ${list.filter((a) => a.spanId).length}`,
    });
  }
  if (loops.length > 0) {
    rows.push({
      kind: 'Slack loop',
      status: 'all',
      count: loops.length,
      details: `${m(loops.reduce((t, l) => t + l.lengthMeters, 0))} m recorded; from sheath marks ${loops.filter((l) => l.lengthSource === 'marks').length}, typed in ${loops.filter((l) => l.lengthSource === 'entered').length}`,
    });
  }
  return {
    id: 'osp-summary',
    title: 'Outside plant: poles, chambers, spans, ducts and slack',
    definition:
      'Poles, chambers, spans, ducts, cables on poles and slack loops counted by status as recorded, with how many have each fact recorded. A measured span length is one a person entered; the map distance between two poles is shown apart and is never called measured.',
    sources: ['Network items (poles and chambers)', 'Spans', 'Ducts', 'Cables on poles and spans (attachments)', 'Slack loops', 'Permissions'],
    settingsUsed: [],
    columns: [col('kind', 'What'), col('status', 'Status'), col('count', 'Count'), col('details', 'What is recorded')],
    rows,
    notes: [
      ...(rows.length === 0 ? ['No poles, chambers, spans, ducts or slack loops recorded yet.'] : []),
      ...areaNote(filters, 'poles and chambers'),
      ...(filters.area?.trim() ? ['Spans, ducts, attachments and slack loops have no area of their own and are not filtered.'] : []),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Pole attachments                                                    */
/* ------------------------------------------------------------------ */

function poleAttachmentReport(data: RecordReportData, filters: ReportFilters, today: string): ReportTable {
  const poles = lists(data.equipment)
    .filter((e) => isPoleType(e.type) && areaMatches(e.area, filters))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const onPoles = cablesOnPoles({ ...data, equipment: data.equipment ?? [], cables: data.cables ?? [], splitters: data.splitters ?? [], customers: data.customers ?? [] });
  const spans = lists(data.spans);
  const permissions = lists(data.permissions);
  let overAllowance = 0;
  let noAllowance = 0;
  const rows = poles.map((pole) => {
    const on = onPoles.get(pole.id) ?? { built: [], planned: [] };
    const allowance = pole.attachmentCapacity;
    if (allowance === undefined) noAllowance += 1;
    const room = allowance === undefined ? 'Not known (allowance not recorded)' : allowance - on.built.length - on.planned.length;
    if (typeof room === 'number' && room < 0) overAllowance += 1;
    const perms = permissions.filter((p) => p.structureIds.includes(pole.id));
    const permText =
      perms.length === 0
        ? 'None recorded'
        : perms
            .map((p) => {
              const end = p.validUntil?.slice(0, 10);
              return `${p.authority}: ${!end ? 'no end date recorded' : end < today ? `ended ${end}` : `in force to ${end}`}`;
            })
            .join('; ');
    return {
      id: pole.id,
      name: pole.name,
      number: pole.poleNumber?.trim() || pole.ownerPoleNumber?.trim() || NOT_RECORDED,
      owner: pole.ownerName?.trim() || pole.ownerType || NOT_RECORDED,
      status: pole.status,
      built: on.built.length,
      planned: on.planned.length,
      cables: [...on.built, ...on.planned.map((id) => `${id} (planned)`)].join(', '),
      spans: spans.filter((s) => s.fromStructureId === pole.id || s.toStructureId === pole.id).length,
      allowance: allowance ?? NOT_RECORDED,
      room: typeof room === 'number' && room < 0 ? `Over by ${-room}` : room,
      permission: permText,
    };
  });
  return {
    id: 'pole-attachments',
    title: 'Pole attachments: cables on each pole',
    definition:
      'For each pole, the cables recorded on it: on the pole itself or on a span that ends at it (attachment records only, never a cable that only passes near). Built and planned are counted apart. Room left = the allowance the owner gave, as recorded, minus built and planned cables. Permissions are the records that name the pole.',
    sources: ['Network items (poles)', 'Cables on poles and spans (attachments)', 'Spans', 'Cables', 'Permissions'],
    settingsUsed: [],
    columns: [
      col('id', 'Pole id'),
      col('name', 'Name'),
      col('number', 'Pole number'),
      col('owner', 'Owner'),
      col('status', 'Status'),
      col('built', 'Cables (built)'),
      col('planned', 'Cables (planned)'),
      col('cables', 'Cable ids'),
      col('spans', 'Spans at it'),
      col('allowance', 'Allowance'),
      col('room', 'Room left'),
      col('permission', 'Permission'),
    ],
    rows,
    notes: [
      ...(rows.length === 0 ? ['No pole records yet.'] : []),
      ...(noAllowance ? [`${noAllowance} pole(s) have no allowance recorded: their room left is not known, never assumed.`] : []),
      ...(overAllowance ? [`${overAllowance} pole(s) carry more cables than the recorded allowance. This is a warning only.`] : []),
      ...areaNote(filters, 'poles'),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Duct occupancy                                                      */
/* ------------------------------------------------------------------ */

function ductOccupancyReport(data: RecordReportData, osp: OspSettings): ReportTable {
  const cables = lists(data.cables);
  const cableIds = new Set(cables.map((c) => c.id));
  const equipment = new Map(lists(data.equipment).map((e) => [e.id, e]));
  const rows: Record<string, ReportCell>[] = [];
  let undescribed = 0;
  let over = 0;
  let unknownFill = 0;
  for (const duct of [...lists(data.ducts)].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const cap = ductCapacity(duct);
    if (cap.undescribed > 0) undescribed += 1;
    for (const place of ductPlaces(duct)) {
      const fill = placeFill(place, cables, osp);
      if (fill.over) over += 1;
      if (fill.ratio === undefined && fill.cableCount > 0 && place.innerWays === 0) unknownFill += 1;
      rows.push({
        duct: duct.id,
        name: duct.name,
        route: `${nameOf(equipment, duct.fromStructureId)} to ${nameOf(equipment, duct.toStructureId)}`,
        status: STRUCTURE_STATUS_LABELS[duct.status],
        place: place.label,
        ways: place.kind === 'duct' ? (duct.wayCount !== undefined ? `${duct.wayCount} (${cap.described} described)` : `${NOT_RECORDED} (${cap.described} described)`) : place.innerWays || '',
        cables: place.cableIds.length,
        cableIds: place.cableIds.map((id) => (cableIds.has(id) ? id : `${id} (not on record)`)).join(', '),
        inside: place.innerDiameterMm ?? NOT_RECORDED,
        fill: fill.ratio !== undefined ? formatFill(fill.ratio) : (fill.missing ?? 'Not worked out'),
        limit: formatFill(fill.limit),
        warning: fill.over ? 'Above the fill level' : '',
        condition: place.effectiveCondition ? `${WAY_CONDITION_LABELS[place.effectiveCondition]}${place.conditionFrom ? ` (from ${place.conditionFrom})` : ''}` : 'Not checked',
      });
    }
  }
  return {
    id: 'duct-occupancy',
    title: 'Duct occupancy: cables in each duct and way',
    definition:
      'One row for each duct and for each sub-duct and microduct recorded in it, with the cables a person recorded there. Fill = the cables’ cross-section over the inside area, worked out only from recorded diameters; with any diameter missing it is not worked out and says which is missing. A blocked or damaged duct passes its condition to every way inside it.',
    sources: ['Ducts (with sub-ducts and microducts)', 'Cables (outside diameters)', 'Network items (the chambers at each end)'],
    settingsUsed: [
      `Duct fill warning levels (Poles and routes settings): one cable ${formatFill(osp.ductFillOneCableRatio)}, two cables ${formatFill(osp.ductFillTwoCablesRatio)}, three or more ${formatFill(osp.ductFillManyCablesRatio)}`,
    ],
    columns: [
      col('duct', 'Duct id'),
      col('name', 'Name'),
      col('route', 'From and to'),
      col('status', 'Status'),
      col('place', 'Way'),
      col('ways', 'Ways inside'),
      col('cables', 'Cables'),
      col('cableIds', 'Cable ids'),
      col('inside', 'Inside diameter (mm)'),
      col('fill', 'Fill'),
      col('limit', 'Fill level'),
      col('warning', 'Warning'),
      col('condition', 'Condition'),
    ],
    rows,
    notes: [
      ...(rows.length === 0 ? ['No duct records yet.'] : []),
      ...(unknownFill ? [`${unknownFill} way(s) hold cables but their fill is not worked out, because a diameter is not recorded.`] : []),
      ...(over ? [`${over} way(s) are above the fill level. This is a warning only.`] : []),
      ...(undescribed ? [`${undescribed} duct(s) have more ways counted than described; the ways not described are not counted as free.`] : []),
      'A way whose condition nobody checked says "Not checked", not "Clear".',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Splicing                                                            */
/* ------------------------------------------------------------------ */

function splicingReport(data: RecordReportData, filters: ReportFilters): ReportTable {
  const equipment = new Map(lists(data.equipment).map((e) => [e.id, e]));
  const closures = lists(data.closures)
    .filter((c) => areaMatches(c.area, filters))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  let originMissing = 0;
  const rows = closures.map((c) => {
    const struck = c.splices.filter((s) => s.enteredInError);
    const real = c.splices.filter((s) => !s.enteredInError);
    const retired = real.filter((s) => s.retiredAt);
    const active = real.filter((s) => isSpliceActive(s));
    const withLoss = active.filter((s) => s.spliceLossDb !== undefined);
    const measured = withLoss.filter((s) => s.lossSource === 'field_measured' || s.lossSource === 'device_reported');
    const noOrigin = withLoss.filter((s) => !s.lossSource);
    originMissing += noOrigin.length;
    const otherOrigin = withLoss.length - measured.length - noOrigin.length;
    const average = measured.length > 0 ? Math.round((measured.reduce((t, s) => t + (s.spliceLossDb ?? 0), 0) / measured.length) * 100) / 100 : undefined;
    const terminations = (c.terminations ?? []).filter((t) => !t.retiredAt && !t.enteredInError).length;
    return {
      id: c.id,
      name: c.name,
      pin: c.equipmentId ? nameOf(equipment, c.equipmentId) : NOT_RECORDED,
      trays: c.trays?.length ?? NOT_RECORDED,
      active: active.length,
      planned: active.filter((s) => s.status === 'Pending').length,
      tested: active.filter((s) => s.status === 'Tested').length,
      problem: active.filter((s) => s.status === 'Failed' || s.status === 'Damaged').length,
      retired: retired.length,
      struck: struck.length,
      measured: measured.length,
      other: otherOrigin,
      noLoss: active.length - withLoss.length,
      noOrigin: noOrigin.length,
      average: average !== undefined ? `${average} dB (from ${measured.length})` : 'No measured loss',
      ends: terminations,
      entries: c.cableEntries ? c.cableEntries.length : NOT_RECORDED,
    };
  });
  return {
    id: 'splicing',
    title: 'Splicing: splices and fibre ends in each closure',
    definition:
      'One row per closure record. Active = splices that still join two fibres (planned ones included, as they already claim both fibres). Retired and "entered by mistake" splices stay on record and are counted apart. A loss is "measured" only when it came from a meter or an OTDR (field measured or device reported); designed and calculated losses are "other origin", and older losses with no origin are counted apart. The average uses measured losses only.',
    sources: ['Joint closure records (splices, trays, fibre ends, cable entries)', 'Network items (map pins)'],
    settingsUsed: [],
    columns: [
      col('id', 'Closure id'),
      col('name', 'Name'),
      col('pin', 'Map pin'),
      col('trays', 'Trays'),
      col('active', 'Active splices'),
      col('planned', 'Planned (pending)'),
      col('tested', 'Tested'),
      col('problem', 'Failed or damaged'),
      col('retired', 'Retired'),
      col('struck', 'Entered by mistake'),
      col('measured', 'Loss measured'),
      col('other', 'Loss of other origin'),
      col('noOrigin', 'Loss origin not recorded'),
      col('noLoss', 'No loss recorded'),
      col('average', 'Average measured loss'),
      col('ends', 'Fibre ends (pigtails)'),
      col('entries', 'Cables entering'),
    ],
    rows,
    notes: [
      ...(rows.length === 0 ? ['No closure records yet.'] : []),
      ...(originMissing ? [`${originMissing} splice loss(es) have no origin recorded: shown as "origin not recorded", never as measured.`] : []),
      ...areaNote(filters, 'closures'),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* ODF ports                                                           */
/* ------------------------------------------------------------------ */

const ODF_STATUS_WORDS: Record<string, string> = { available: 'Free', in_use: 'In use', reserved: 'Reserved', damaged: 'Damaged', unknown: 'Not known' };

function odfPortReport(data: RecordReportData, filters: ReportFilters): ReportTable {
  const equipment = new Map(lists(data.equipment).map((e) => [e.id, e]));
  const cables = new Map(lists(data.cables).map((c) => [c.id, c]));
  const rows: Record<string, ReportCell>[] = [];
  let markedOnly = 0;
  let patchedFree = 0;
  let unknown = 0;
  const odfs = lists(data.equipment)
    .filter((e) => (e.odfPanels ?? []).length > 0 && areaMatches(e.area, filters))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const odf of odfs) {
    for (const panel of odf.odfPanels ?? []) {
      for (const port of [...panel.ports].sort((a, b) => a.number - b.number)) {
        const rear = port.feederCableId
          ? `${nameOf(cables, port.feederCableId)}, fibre ${port.feederCore ?? NOT_RECORDED}`
          : NOT_RECORDED;
        let patch = 'None';
        if (port.patch) {
          const olt = equipment.get(port.patch.oltId);
          const pon = olt?.ponPorts?.find((p) => p.id === port.patch!.ponPortId);
          patch = `${nameOf(equipment, port.patch.oltId)} ${pon ? (pon.vendorAddress ?? pon.id) : `${port.patch.ponPortId} (port not on record)`}`;
        }
        const linked = !!port.feederCableId || !!port.patch;
        const checks: string[] = [];
        if (port.status === 'in_use' && !linked) {
          checks.push('Marked in use, nothing linked');
          markedOnly += 1;
        }
        if (port.status === 'available' && port.patch) {
          checks.push('Patched but marked free');
          patchedFree += 1;
        }
        if (port.status === 'unknown') unknown += 1;
        if (port.patch?.override) checks.push(`Patched although marked ${ODF_STATUS_WORDS[port.patch.override.status] ?? port.patch.override.status}: ${port.patch.override.reason}`);
        rows.push({
          odf: nameOf(equipment, odf.id),
          panel: panel.label,
          port: port.label ? `${port.number} (${port.label})` : port.number,
          status: ODF_STATUS_WORDS[port.status] ?? port.status,
          rear,
          pigtail: port.pigtail ? [port.pigtail.connectorType, port.pigtail.lengthMeters !== undefined ? `${port.pigtail.lengthMeters} m` : undefined, port.pigtail.label].filter(Boolean).join(', ') || NOT_RECORDED : NOT_RECORDED,
          patch,
          cord: port.patch ? port.patch.cordLabel?.trim() || NOT_RECORDED : '',
          check: checks.join('; '),
        });
      }
    }
  }
  return {
    id: 'odf-ports',
    title: 'ODF ports: each adapter, its fibre and its patch',
    definition:
      'One row per adapter on every ODF panel. Rear = the cable and fibre a person recorded behind it. Patch = the OLT PON port its front is patched to, as recorded. A patch is not a splice. "Check" lists where the port’s status word and its links disagree.',
    sources: ['Network items (ODF panels and ports; OLT PON ports)', 'Cables'],
    settingsUsed: [],
    columns: [col('odf', 'ODF'), col('panel', 'Panel'), col('port', 'Port'), col('status', 'Status'), col('rear', 'Rear: cable and fibre'), col('pigtail', 'Pigtail'), col('patch', 'Front: patched to'), col('cord', 'Patch cord'), col('check', 'Check')],
    rows,
    notes: [
      ...(rows.length === 0 ? ['No ODF panels recorded yet.'] : []),
      ...(markedOnly ? [`${markedOnly} port(s) are marked in use with nothing linked.`] : []),
      ...(patchedFree ? [`${patchedFree} port(s) are patched but marked free.`] : []),
      ...(unknown ? [`${unknown} port(s) have status "Not known": not counted as free.`] : []),
      ...areaNote(filters, 'ODFs'),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Orphans: records nothing links to                                   */
/* ------------------------------------------------------------------ */

function orphanReport(data: RecordReportData): ReportTable {
  const equipment = lists(data.equipment);
  const cables = lists(data.cables);
  const splitters = lists(data.splitters);
  const closures = lists(data.closures);
  const customers = lists(data.customers);
  const onts = lists(data.onts);
  const equipmentIds = new Set(equipment.map((e) => e.id));

  const usedEquipment = new Set<string>();
  const useEq = (id: string | undefined) => {
    if (id) usedEquipment.add(id);
  };
  const usedCables = new Set<string>();
  const useCable = (id: string | undefined) => {
    if (id) usedCables.add(id);
  };
  for (const c of cables) {
    useEq(c.startEquipmentId);
    useEq(c.endEquipmentId);
    for (const core of c.cores ?? []) {
      useEq(core.connectedToEquipmentId);
      for (const a of core.assignments ?? []) {
        if (!a.releasedAt) {
          useEq(a.equipmentId);
          useEq(a.oltId);
        }
      }
    }
  }
  for (const s of splitters) {
    useEq(s.terminalBoxId);
    useCable(s.inputPort.connectedCableId);
    for (const p of s.outputPorts) {
      useEq(p.connectedEquipmentId);
      useCable(p.connectedDropCableId);
    }
  }
  for (const c of closures) {
    useEq(c.equipmentId);
    useCable(c.cableAId);
    useCable(c.cableBId);
    for (const e of c.cableEntries ?? []) useCable(e.cableId);
    for (const s of c.splices) {
      useCable(s.inputCableId);
      useCable(s.outputCableId);
    }
    for (const t of c.terminations ?? []) useCable(t.cableId);
  }
  for (const s of lists(data.spans)) {
    useEq(s.fromStructureId);
    useEq(s.toStructureId);
  }
  for (const a of lists(data.attachments)) {
    useEq(a.structureId);
    useCable(a.cableId);
  }
  for (const d of lists(data.ducts)) {
    useEq(d.fromStructureId);
    useEq(d.toStructureId);
    for (const id of [...d.cableIds, ...d.subducts.flatMap((s) => [...s.cableIds, ...(s.microducts ?? []).flatMap((mi) => mi.cableIds)])]) useCable(id);
  }
  for (const l of lists(data.slackLoops)) {
    useEq(l.structureId);
    useCable(l.cableId);
  }
  for (const c of customers) {
    useEq(c.oltId);
    useEq(c.terminalBoxId);
    useCable(c.dropCableId);
    useCable(c.feederCableId);
    useCable(c.distributionCableId);
  }
  for (const o of onts) {
    useEq(o.oltId);
    useCable(o.dropCableId);
  }
  for (const e of equipment) {
    for (const panel of e.odfPanels ?? []) {
      for (const port of panel.ports) {
        useCable(port.feederCableId);
        if (port.patch) {
          useEq(port.patch.oltId);
          useEq(e.id);
        }
        if (port.feederCableId) useEq(e.id);
      }
    }
    for (const pon of e.ponPorts ?? []) {
      if (pon.connectedFeederCableId) {
        useCable(pon.connectedFeederCableId);
        useEq(e.id);
      }
    }
    if (e.customerId) useEq(e.id);
  }

  const rows: Record<string, ReportCell>[] = [];
  for (const e of [...equipment].sort((a, b) => a.name.localeCompare(b.name))) {
    if (usedEquipment.has(e.id)) continue;
    rows.push({
      kind: isPoleType(e.type) ? 'Pole' : `Network item (${e.type})`,
      id: e.id,
      name: e.name,
      status: e.status,
      why: isPoleType(e.type) ? 'No span, cable, duct or slack loop recorded at this pole' : 'Nothing recorded links to it: no cable end, splitter, closure, span, duct, patch or customer',
    });
  }
  for (const c of [...cables].sort((a, b) => a.name.localeCompare(b.name))) {
    if (c.startEquipmentId || c.endEquipmentId || usedCables.has(c.id)) continue;
    rows.push({ kind: 'Cable', id: c.id, name: c.name, status: c.status, why: 'No end, pole, duct, splice, splitter, ODF or customer recorded for this cable' });
  }
  for (const s of splitters) {
    if (equipmentIds.has(s.terminalBoxId)) continue;
    rows.push({ kind: 'Splitter', id: s.id, name: s.name, status: s.status, why: s.terminalBoxId ? `Its box ${s.terminalBoxId} is not on record` : 'No box recorded' });
  }
  for (const c of closures) {
    if (c.equipmentId || c.cableAId || c.cableBId || c.splices.length > 0 || (c.terminations ?? []).length > 0 || (c.cableEntries ?? []).length > 0) continue;
    rows.push({ kind: 'Closure record', id: c.id, name: c.name, status: '', why: 'No map pin, cable, splice or fibre end recorded in it' });
  }
  const ontOnCustomer = new Set(customers.map((c) => c.ontId).filter((id): id is string => !!id));
  for (const o of onts) {
    if (o.status !== 'installed' || ontOnCustomer.has(o.id) || o.oltId || o.splitterId || o.dropCableId) continue;
    rows.push({ kind: 'ONT record', id: o.id, name: o.serialNumber?.trim() || '', status: o.status, why: 'Installed, but no customer uses it and no OLT, splitter or drop fibre is recorded' });
  }
  const namedOnOutput = new Set(splitters.flatMap((s) => s.outputPorts.map((p) => p.connectedCustomerId)).filter((id): id is string => !!id));
  for (const c of customers) {
    if (c.status !== 'Active' && c.status !== 'Suspended') continue;
    if (c.oltId || c.splitterId || c.dropCableId || c.terminalBoxId || c.ontId || namedOnOutput.has(c.id)) continue;
    // Customers by id only: no name in reports.
    rows.push({ kind: 'Customer', id: c.id, name: '', status: c.status, why: 'Active or suspended, but no OLT, box, splitter, drop fibre or ONT is recorded' });
  }
  return {
    id: 'orphans',
    title: 'Records not linked to anything',
    definition:
      'Records that no other record links to and that link to nothing themselves, using recorded links only: cable ends, splitter boxes, closures and splices, spans, cables on poles, ducts, slack loops, ODF patches, ONTs and customer paths. Being near something on the map is never a link. Splitters whose box is not on record are listed too.',
    sources: ['Network items', 'Cables', 'Splitters', 'Joint closure records', 'Spans', 'Cables on poles and spans (attachments)', 'Ducts', 'Slack loops', 'Customers (ids only)', 'ONT records'],
    settingsUsed: [],
    columns: [col('kind', 'What'), col('id', 'Id'), col('name', 'Name'), col('status', 'Status'), col('why', 'Why it is listed')],
    rows,
    notes: [
      rows.length === 0 ? 'Every record is linked to at least one other record.' : 'Not linked is not always wrong: a new item may simply not be connected yet. Check each one before deleting anything.',
      'Customers waiting for installation or disconnected are not listed. Customers are shown by id only.',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Cables not connected                                                */
/* ------------------------------------------------------------------ */

function disconnectedCableReport(data: RecordReportData): ReportTable {
  const equipment = new Map(lists(data.equipment).map((e) => [e.id, e]));
  const index = buildFiberIndex({
    equipment: lists(data.equipment),
    cables: lists(data.cables),
    splitters: lists(data.splitters),
    closures: lists(data.closures),
    customers: lists(data.customers),
  });
  const rows: Record<string, ReportCell>[] = [];
  for (const c of [...lists(data.cables)].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id))) {
    const problems: string[] = [];
    const endText = (id: string | undefined, which: string) => {
      if (!id) {
        problems.push(`${which} end not recorded`);
        return NOT_RECORDED;
      }
      if (!equipment.has(id)) {
        problems.push(`${which} end points to ${id}, which is not on record`);
        return `${id} (not on record)`;
      }
      return nameOf(equipment, id);
    };
    const start = endText(c.startEquipmentId, 'Start');
    const end = endText(c.endEquipmentId, 'Far');
    const fibre = c.fiberCount > 0 && c.type !== 'Coaxial Cable';
    let fed = 0;
    let onward = 0;
    if (fibre) {
      for (let core = 1; core <= c.fiberCount; core += 1) {
        if ((index.sources.get(coreKey(c.id, core)) ?? []).length > 0) fed += 1;
        if ((index.sinks.get(coreKey(c.id, core)) ?? []).length > 0) onward += 1;
      }
      if (fed === 0 && onward === 0) problems.push('No fibre link recorded at either end');
    }
    if (problems.length === 0) continue;
    rows.push({
      id: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      from: start,
      to: end,
      fed: fibre ? ofN(fed, c.fiberCount) : '',
      onward: fibre ? ofN(onward, c.fiberCount) : '',
      problem: problems.join('; '),
    });
  }
  return {
    id: 'disconnected-cables',
    title: 'Cables not connected: missing ends or no fibre links',
    definition:
      'Cables with an end that is not recorded, an end that points to a record that is gone, or (for fibre cables) no fibre link recorded at either end. "Fed from" counts fibres with a recorded feed on the OLT side (PON port, ODF port, splice or splitter output); "Goes on to" counts fibres with a recorded splice, splitter input or customer on the far side. Fibres nobody linked are "not recorded", which does not prove they are unused.',
    sources: ['Cables', 'Network items', 'Splitters', 'Joint closure records (splices)', 'Customers (drop fibres, ids only)'],
    settingsUsed: [],
    columns: [col('id', 'Cable id'), col('name', 'Name'), col('type', 'Type'), col('status', 'Status'), col('from', 'From'), col('to', 'To'), col('fed', 'Fibres fed from'), col('onward', 'Fibres going on to'), col('problem', 'What is missing')],
    rows,
    notes: rows.length === 0 ? ['Every cable has both ends recorded and at least one fibre link.'] : ['Ends and fibre links come only from records a person made. A cable is never joined to a box because it is drawn near it.'],
  };
}

/* ------------------------------------------------------------------ */
/* Customer paths                                                      */
/* ------------------------------------------------------------------ */

function customerPathReport(data: RecordReportData, filters: ReportFilters): ReportTable {
  const fiber = { equipment: lists(data.equipment), cables: lists(data.cables), splitters: lists(data.splitters), closures: lists(data.closures), customers: lists(data.customers) };
  const cache = customerPathCache(fiber);
  const findings = findCustomerPathFindings(fiber, undefined, cache);
  const disagree = new Map<string, number>();
  const missing = new Map<string, number>();
  for (const f of findings) {
    const map = f.state === 'missing' ? missing : disagree;
    map.set(f.customerId, (map.get(f.customerId) ?? 0) + 1);
  }
  const equipment = new Map(fiber.equipment.map((e) => [e.id, e]));
  // Customers by id only: their name is taken out of every sentence.
  const scrub = (text: string, c: Customer) => (c.name ? text.split(c.name).join(`Customer ${c.id}`) : text);
  const customers = fiber.customers.filter((c) => isPonCustomer(c) && areaMatches(c.area, filters));
  let reach = 0;
  const rows = customers
    .map((c) => {
      const p = customerPathFromLinks(c, cache);
      if (p.reachesPon) reach += 1;
      return {
        id: c.id,
        status: c.status,
        reaches: p.reachesPon ? 'Yes' : 'No',
        olt: p.values.oltId ? `${nameOf(equipment, p.values.oltId)}${p.values.ponPort ? ` / ${p.values.ponPort}` : ''}` : NOT_RECORDED,
        output: p.output ? `${p.output.splitterId} output ${p.output.port}` : NOT_RECORDED,
        drop: p.values.dropCableId ? `${p.values.dropCableId} fibre ${p.values.fiberCore ?? NOT_RECORDED}` : NOT_RECORDED,
        disagree: disagree.get(c.id) ?? 0,
        missing: missing.get(c.id) ?? 0,
        gap: p.gaps.length > 0 ? scrub(p.gaps[0], c) : '',
      };
    })
    .sort((a, b) => (a.reaches === b.reaches ? a.id.localeCompare(b.id) : a.reaches === 'No' ? -1 : 1));
  return {
    id: 'customer-paths',
    title: 'Customer paths: does each customer reach a PON port?',
    definition:
      'For each fibre customer who is not disconnected, the path from their drop fibre back through recorded splices, splitter outputs, ODF ports and patches to an OLT PON port. Only recorded links are followed; where they stop, the first missing link is named. "Fields disagree" counts path fields on the customer record that say something else than the links; "Fields blank" counts fields the links could fill in. Nothing is filled in for you.',
    sources: ['Customers (ids only)', 'Cables (fibres)', 'Joint closure records (splices)', 'Splitters', 'Network items (ODF ports, OLT PON ports)'],
    settingsUsed: [],
    columns: [
      col('id', 'Customer id'),
      col('status', 'Status'),
      col('reaches', 'Reaches a PON port'),
      col('olt', 'OLT and PON port (from links)'),
      col('output', 'Splitter output (from links)'),
      col('drop', 'Drop fibre'),
      col('disagree', 'Fields disagree'),
      col('missing', 'Fields blank'),
      col('gap', 'First missing link'),
    ],
    rows,
    notes: [
      rows.length === 0 ? 'No fibre customers to check.' : `${reach} of ${rows.length} customer(s) reach a PON port through recorded links.`,
      'Cable TV (coax) customers and disconnected customers are not listed. Customers are shown by id only; no names, addresses or house positions.',
      ...areaNote(filters, 'customers'),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Stored map check findings                                           */
/* ------------------------------------------------------------------ */

const LEVEL_WORDS = { error: 'Error', warning: 'Warning', note: 'Note' } as const;

function validationFindingsReport(data: RecordReportData): ReportTable {
  const findings = sortFindings(lists(data.validationFindings));
  const rows = findings.map((f) => ({
    level: LEVEL_WORDS[f.severity],
    rule: f.rule,
    about: `${f.targetCollection ? `${f.targetCollection} ` : ''}${f.targetId}`,
    message: f.message,
    state: VALIDATION_FINDING_STATE_LABELS[f.state],
    presence: VALIDATION_FINDING_PRESENCE_LABELS[f.presence],
    first: f.firstFoundAt.slice(0, 10),
    decided: f.stateBy ? `${f.stateBy}${f.stateAt ? `, ${f.stateAt.slice(0, 10)}` : ''}${f.stateNote ? `: ${f.stateNote}` : ''}` : '',
    fix: f.fix,
  }));
  const open = findings.filter((f) => f.state === 'open' && f.presence === 'found').length;
  return {
    id: 'validation-findings',
    title: 'Map check findings: open, checked and fixed',
    definition:
      'Every finding the map check stored (Validation), with what people decided: open, checked and fine as it is, or fixed, with who, when and why. A finding the check no longer finds is kept and marked so; none is ever deleted. Findings name customers by id only.',
    sources: ['Map check findings (stored by "Run the map check")'],
    settingsUsed: [],
    columns: [col('level', 'Level'), col('rule', 'Rule'), col('about', 'Record'), col('message', 'Finding'), col('state', 'Decision'), col('presence', 'Last check'), col('first', 'First found'), col('decided', 'Decided by'), col('fix', 'What to do')],
    rows,
    notes: rows.length === 0 ? ['No findings stored yet. Run the map check from Validation to store them.'] : [`${open} finding(s) are open and still found by the last check.`, 'These are the findings as of the last stored run; run the map check again for today’s picture.'],
  };
}

/** Every Phase 22 report built from the records in the browser, in the order the Reports screen shows them. */
export function recordReports(data: RecordReportData, options: RecordReportOptions = {}): ReportTable[] {
  const filters = options.filters ?? {};
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const osp = options.osp ?? DEFAULT_OSP_SETTINGS;
  return [
    cableInventoryReport(data),
    disconnectedCableReport(data),
    orphanReport(data),
    ospSummaryReport(data, filters),
    poleAttachmentReport(data, filters, today),
    ductOccupancyReport(data, osp),
    splicingReport(data, filters),
    odfPortReport(data, filters),
    customerPathReport(data, filters),
    validationFindingsReport(data),
  ];
}

/* ------------------------------------------------------------------ */
/* Change history (the server's audit events)                          */
/* ------------------------------------------------------------------ */

const OP_WORDS: Record<AuditEvent['op'], string> = { create: 'Added', update: 'Changed', delete: 'Deleted', summary: 'Many records' };

export interface ChangeHistoryOptions {
  filters?: ReportFilters;
  /** `collection/id` of records that are TEST (TEST alarms, faults, jobs, monitoring rows and sources). */
  testRecordKeys?: ReadonlySet<string>;
  /** When the events were read from the server, ISO. */
  loadedAt?: string;
  /** How many events were asked for, so the report can say older ones may be missing. */
  limit?: number;
}

/** `collection/id` keys of the TEST records in these lists, for `changeHistoryReport`. */
export function testRecordKeys(data: Partial<Record<string, readonly unknown[]>>): Set<string> {
  const keys = new Set<string>();
  for (const [collection, list] of Object.entries(data)) {
    for (const record of list ?? []) {
      const r = record as { id?: unknown; isTest?: unknown };
      if (r && r.isTest === true && typeof r.id === 'string') keys.add(`${collection}/${r.id}`);
    }
  }
  return keys;
}

const eventDay = (at: string): string | undefined => {
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined;
};

/**
 * Who changed what and when, from the server's audit events (Phase 23), which the browser cannot
 * write. Only field names are shown, never their values (they can be personal data). Changes to
 * TEST records are left out unless the person ticks "Include TEST".
 */
export function changeHistoryReport(events: readonly AuditEvent[], options: ChangeHistoryOptions = {}): ReportTable {
  const filters = options.filters ?? {};
  const testKeys = options.testRecordKeys ?? new Set<string>();
  const inPeriod = events.filter((e) => {
    if (!filters.from && !filters.to) return true;
    const day = eventDay(e.at);
    if (!day) return false;
    return (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to);
  });
  const isTest = (e: AuditEvent) => !!e.recordId && testKeys.has(`${e.collection}/${e.recordId}`);
  const tests = inPeriod.filter(isTest).length;
  const shown = filters.includeTest ? inPeriod : inPeriod.filter((e) => !isTest(e));
  const rows = [...shown]
    .sort((a, b) => b.seq - a.seq)
    .map((e) => ({
      when: `${e.at.slice(0, 16).replace('T', ' ')} UTC`,
      who: e.actorName,
      role: e.actorRole ? ACCOUNT_ROLE_LABELS[e.actorRole] : 'Setup mode or the server',
      how: WRITE_SOURCE_LABELS[e.source] ?? e.source,
      what: e.collection,
      record: e.recordId || '(many records)',
      change: OP_WORDS[e.op] ?? e.op,
      fields: e.op === 'summary' ? (e.note ?? '') : e.diff.map((d) => d.field).join(', '),
      request: e.changeRequestId ?? '',
      revision: e.revision,
    }));
  const people = new Set(shown.map((e) => e.actorName)).size;
  return {
    id: 'change-history',
    title: 'Change history: who changed what and when',
    definition:
      'Every write the server recorded (its audit events, which the app cannot change), newest first: who, their role, how it reached the server, which record, and which fields changed. Field values are not in this report, because they can be personal data; open Record history to compare versions.',
    sources: ['The server’s audit events (read when you pressed "Load")'],
    settingsUsed: [],
    columns: [
      col('when', 'When'),
      col('who', 'Who'),
      col('role', 'Role'),
      col('how', 'How'),
      col('what', 'Record list'),
      col('record', 'Record id'),
      col('change', 'Change'),
      col('fields', 'Fields changed'),
      col('request', 'Change request'),
      col('revision', 'Network revision'),
    ],
    rows,
    notes: [
      `${rows.length} change(s) by ${people} person(s) or source(s).`,
      filters.includeTest ? `Changes to TEST records included (${tests}).` : `Changes to TEST records left out (${tests}). Tick "Include TEST" to see them.`,
      ...(options.loadedAt ? [`Read from the server ${options.loadedAt.slice(0, 16).replace('T', ' ')} UTC.`] : []),
      ...(options.limit && events.length >= options.limit ? [`Only the newest ${options.limit} changes were read; older ones are not in this report.`] : []),
      'A change to a TEST record is known only while that record is in the app; a TEST record that was removed counts as real here.',
    ],
  };
}
