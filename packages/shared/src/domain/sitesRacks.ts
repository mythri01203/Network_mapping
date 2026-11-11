import type { ChangeSet } from '../model/api';
import type { RackNumbering } from '../model/enums';
import type { Equipment, Rack, Site } from '../model/types';
import { type AuditEntry, type CommandContext, type CommandResult, fail, type NetworkData, type NetworkPatch, type Notice, notice, succeed } from './command';
import { newRecordId } from './ids';

/**
 * Phase 9: sites and racks as records. A site holds racks; equipment may name the site and rack it
 * sits in and the units it fills. Nothing here is guessed: a rack's height, an item's unit and how
 * many units it is tall are only what a person wrote, and without them nothing is called free.
 * The older free-text `site` and `rackNumber` on equipment stay and are shown when no record is
 * linked.
 */

export interface SiteRackCheckData {
  sites: readonly Site[];
  racks: readonly Rack[];
  equipment: readonly Equipment[];
}

export interface SiteRackProblem {
  severity: 'error' | 'warning';
  code:
    | 'rack_site_missing'
    | 'equipment_site_missing'
    | 'equipment_rack_missing'
    | 'equipment_rack_other_site'
    | 'rack_unit_beyond'
    | 'rack_units_overlap';
  /** Stable across runs, so a change is judged only by the problems it adds. */
  key: string;
  message: string;
  refs: string[];
}

export const sitesOf = (data: Partial<Pick<NetworkData, 'sites'>>): Site[] => data.sites ?? [];
export const racksOf = (data: Partial<Pick<NetworkData, 'racks'>>): Rack[] => data.racks ?? [];

export const RACK_NUMBERING_LABELS: Record<RackNumbering, string> = {
  bottom_up: 'Unit 1 at the bottom',
  top_down: 'Unit 1 at the top',
};

/** The units an item fills, as recorded. With no height recorded only its first unit is known. */
export function unitsFilled(item: Pick<Equipment, 'rackUnit' | 'rackUnits'>): { from: number; to: number; heightKnown: boolean } | undefined {
  if (!item.rackUnit) return undefined;
  const tall = item.rackUnits ?? 1;
  return { from: item.rackUnit, to: item.rackUnit + tall - 1, heightKnown: item.rackUnits !== undefined };
}

const unitText = (u: { from: number; to: number }) => (u.from === u.to ? `unit ${u.from}` : `units ${u.from} to ${u.to}`);

/**
 * Broken links and impossible placements. Errors: a rack at a site that is not on record, an item
 * naming a site or rack that is not on record, an item in a rack at another site than it names, an
 * item reaching past the top of a rack whose height is recorded. Warning: two items recorded in the
 * same unit (half-width items can share one, so it is not refused).
 */
export function findSiteRackProblems(data: SiteRackCheckData): SiteRackProblem[] {
  const problems: SiteRackProblem[] = [];
  const sites = new Map(data.sites.map((s) => [s.id, s]));
  const racks = new Map(data.racks.map((r) => [r.id, r]));
  const add = (severity: SiteRackProblem['severity'], code: SiteRackProblem['code'], key: string, message: string, refs: string[]) =>
    problems.push({ severity, code, key: `${code}:${key}`, message, refs });

  for (const rack of data.racks) {
    if (!sites.has(rack.siteId)) {
      add('error', 'rack_site_missing', rack.id, `Rack ${rack.name} is at site ${rack.siteId}, which is not on record. Choose an existing site.`, [rack.id]);
    }
  }
  const inRack = new Map<string, Equipment[]>();
  for (const e of data.equipment) {
    if (e.siteId && !sites.has(e.siteId)) {
      add('error', 'equipment_site_missing', e.id, `${e.name} names site ${e.siteId}, which is not on record. Choose an existing site, or clear it.`, [e.id]);
    }
    if (!e.rackId) continue;
    const rack = racks.get(e.rackId);
    if (!rack) {
      add('error', 'equipment_rack_missing', e.id, `${e.name} names rack ${e.rackId}, which is not on record. Choose an existing rack, or clear it.`, [e.id]);
      continue;
    }
    if (e.siteId && e.siteId !== rack.siteId) {
      add(
        'error',
        'equipment_rack_other_site',
        e.id,
        `${e.name} is in rack ${rack.name}, which is at ${sites.get(rack.siteId)?.name ?? rack.siteId}, but it names site ${sites.get(e.siteId)?.name ?? e.siteId}. One item is in one place.`,
        [e.id, rack.id],
      );
    }
    const units = unitsFilled(e);
    if (units && rack.heightUnits !== undefined && units.to > rack.heightUnits) {
      add(
        'error',
        'rack_unit_beyond',
        e.id,
        `${e.name} is recorded at ${unitText(units)}, but rack ${rack.name} has ${rack.heightUnits} units. Check the unit number, its height or the rack height.`,
        [e.id, rack.id],
      );
    }
    if (units) inRack.set(rack.id, [...(inRack.get(rack.id) ?? []), e]);
  }
  for (const [rackId, items] of inRack) {
    const rack = racks.get(rackId)!;
    const sorted = [...items].sort((a, b) => a.rackUnit! - b.rackUnit! || a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = unitsFilled(sorted[i])!;
        const b = unitsFilled(sorted[j])!;
        if (b.from > a.to) break;
        add(
          'warning',
          'rack_units_overlap',
          `${rackId}/${sorted[i].id}/${sorted[j].id}`,
          `${sorted[i].name} and ${sorted[j].name} are both recorded in rack ${rack.name} at ${unitText({ from: b.from, to: Math.min(a.to, b.to) })}. Check the unit numbers, unless both are half-width.`,
          [sorted[i].id, sorted[j].id, rackId],
        );
      }
    }
  }
  return problems;
}

const TOUCHED = ['sites', 'racks', 'equipment'] as const;

export function changeSetTouchesSitesRacks(changes: ChangeSet): boolean {
  return TOUCHED.some((name) => (changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0);
}

/**
 * Errors a change set adds. Deleting a site or rack that something still names is refused this way:
 * the result would point at nothing. Problems already stored are not blamed on the change.
 */
export function checkChangeSetSitesRacks(current: SiteRackCheckData, changes: ChangeSet): SiteRackProblem[] {
  const after = <K extends (typeof TOUCHED)[number]>(name: K) => {
    const byId = new Map((current[name] as readonly { id: string }[]).map((r) => [r.id, r]));
    for (const id of changes.deletes?.[name] ?? []) byId.delete(id);
    for (const r of (changes.upserts?.[name] ?? []) as { id: string }[]) byId.set(r.id, r);
    return [...byId.values()] as unknown as SiteRackCheckData[K];
  };
  const old = new Set(findSiteRackProblems(current).map((p) => p.key));
  return findSiteRackProblems({ sites: after('sites'), racks: after('racks'), equipment: after('equipment') }).filter(
    (p) => p.severity === 'error' && !old.has(p.key),
  );
}

const checkData = (data: NetworkData): SiteRackCheckData => ({ sites: sitesOf(data), racks: racksOf(data), equipment: data.equipment });

/** Runs the checks on a proposed patch: an added error refuses it, an added warning asks first. */
function checkedChange<T>(data: NetworkData, patch: NetworkPatch, value: T, extras: { notice: Notice; audit: AuditEntry[] }): CommandResult<T> {
  const before = new Set(findSiteRackProblems(checkData(data)).map((p) => p.key));
  const added = findSiteRackProblems(checkData({ ...data, ...patch })).filter((p) => !before.has(p.key));
  const errors = added.filter((p) => p.severity === 'error');
  if (errors.length) return fail('Not saved', `${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''} Nothing was saved.`);
  const warnings = added.filter((p) => p.severity === 'warning');
  if (!warnings.length) return succeed(value, patch, extras);
  const first = extras.audit[0];
  return succeed(value, patch, {
    notice: extras.notice,
    audit: [
      ...extras.audit,
      { action: 'WARNING_ACCEPTED', details: `Saved after the warning: ${warnings.map((w) => w.message).join(' ')}`, assetId: first?.assetId ?? 'rack', assetType: first?.assetType ?? 'Rack' },
    ],
    confirm: `Please check: ${warnings.map((w) => w.message).join(' ')} Save anyway?`,
  });
}

const clean = (value: string | undefined, max: number) => {
  const v = value?.trim();
  return v ? v.slice(0, max) : undefined;
};

/** Copies only the fields that have a value, so a cleared one is removed, not stored empty. */
function withFields<T extends object>(base: T, fields: Record<string, unknown>): T {
  const next = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as unknown as T;
}

const stamp = (ctx: CommandContext, kind: 'created' | 'updated') => {
  const at = (ctx.now ?? new Date()).toISOString();
  return kind === 'created' ? { createdAt: at, ...(ctx.actor ? { createdBy: ctx.actor } : {}) } : { updatedAt: at, ...(ctx.actor ? { updatedBy: ctx.actor } : {}) };
};

/* ------------------------------------------------------------------ */
/* Sites                                                               */
/* ------------------------------------------------------------------ */

export interface SiteDraft {
  name: string;
  kind?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

function siteFields(draft: SiteDraft): { fields?: Record<string, unknown>; problem?: string } {
  const name = clean(draft.name, 120);
  if (!name) return { problem: 'Write the site name, as people call it, such as "Main exchange".' };
  const hasLat = draft.lat !== undefined && Number.isFinite(draft.lat);
  const hasLng = draft.lng !== undefined && Number.isFinite(draft.lng);
  if (hasLat !== hasLng) return { problem: 'Give both latitude and longitude, or neither.' };
  if (hasLat && (Math.abs(draft.lat!) > 90 || Math.abs(draft.lng!) > 180)) return { problem: 'That map position is not on the earth. Check the numbers.' };
  return {
    fields: {
      name,
      kind: clean(draft.kind, 60),
      address: clean(draft.address, 300),
      lat: hasLat ? draft.lat : undefined,
      lng: hasLng ? draft.lng : undefined,
      notes: clean(draft.notes, 1000),
    },
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function createSite(data: NetworkData, draft: SiteDraft, ctx: CommandContext = {}): CommandResult<Site> {
  const { fields, problem } = siteFields(draft);
  if (!fields) return fail('Site not saved', problem!, 'warning');
  if (sitesOf(data).some((s) => sameName(s.name, fields.name as string))) return fail('Name in use', `There is already a site called ${fields.name as string}. Use that one, or give this one another name.`, 'warning');
  const site = withFields({ id: newRecordId('SITE'), ...stamp(ctx, 'created') } as Site, fields);
  return succeed(site, { sites: [...sitesOf(data), site] }, {
    notice: notice('success', 'Site added', `${site.name} is on record. Add its racks next.`),
    audit: [{ action: 'SITE_CREATED', details: `${site.id}: ${site.name}`, assetId: site.id, assetType: 'Site' }],
  });
}

export function updateSite(data: NetworkData, id: string, draft: SiteDraft, ctx: CommandContext = {}): CommandResult<Site> {
  const site = sitesOf(data).find((s) => s.id === id);
  if (!site) return fail('Site missing', `Site ${id} is not on record.`);
  const { fields, problem } = siteFields(draft);
  if (!fields) return fail('Site not saved', problem!, 'warning');
  if (sitesOf(data).some((s) => s.id !== id && sameName(s.name, fields.name as string))) return fail('Name in use', `There is already a site called ${fields.name as string}.`, 'warning');
  const updated = withFields({ ...site, ...stamp(ctx, 'updated') }, fields);
  return succeed(updated, { sites: sitesOf(data).map((s) => (s.id === id ? updated : s)) }, {
    notice: notice('success', 'Site saved', `${updated.name} saved.`),
    audit: [{ action: 'SITE_UPDATED', details: `${id}: ${updated.name}`, assetId: id, assetType: 'Site' }],
  });
}

/** Removes a site that nothing names. One with racks or equipment is refused, saying what to move first. */
export function deleteSite(data: NetworkData, id: string): CommandResult<Site> {
  const site = sitesOf(data).find((s) => s.id === id);
  if (!site) return fail('Site missing', `Site ${id} is not on record.`);
  const racks = racksOf(data).filter((r) => r.siteId === id);
  const items = data.equipment.filter((e) => e.siteId === id);
  if (racks.length || items.length) {
    return fail(
      'Site in use',
      `${site.name} still has ${[racks.length ? `${racks.length} rack(s)` : '', items.length ? `${items.length} item(s) placed there` : ''].filter(Boolean).join(' and ')}. Move or remove them first. Nothing was deleted.`,
    );
  }
  return succeed(site, { sites: sitesOf(data).filter((s) => s.id !== id) }, {
    confirm: `Delete site ${site.name}? You can undo this.`,
    notice: notice('info', 'Site deleted', `${site.name} removed.`),
    audit: [{ action: 'SITE_DELETED', details: `${id}: ${site.name}`, assetId: id, assetType: 'Site' }],
  });
}

/* ------------------------------------------------------------------ */
/* Racks                                                               */
/* ------------------------------------------------------------------ */

export interface RackDraft {
  siteId: string;
  name: string;
  heightUnits?: number;
  numbering?: RackNumbering;
  location?: string;
  notes?: string;
}

function rackFields(data: NetworkData, draft: RackDraft): { fields?: Record<string, unknown>; problem?: string } {
  if (!sitesOf(data).some((s) => s.id === draft.siteId)) return { problem: 'Choose the site this rack stands in.' };
  const name = clean(draft.name, 60);
  if (!name) return { problem: 'Write the rack name as it is labelled, such as "Rack 3".' };
  if (draft.heightUnits !== undefined && (!Number.isInteger(draft.heightUnits) || draft.heightUnits < 1 || draft.heightUnits > 60)) {
    return { problem: 'Rack height is a whole number of units, 1 to 60 (count them, or read the label: "42U").' };
  }
  return {
    fields: {
      siteId: draft.siteId,
      name,
      heightUnits: draft.heightUnits,
      numbering: draft.numbering,
      location: clean(draft.location, 120),
      notes: clean(draft.notes, 1000),
    },
  };
}

export function createRack(data: NetworkData, draft: RackDraft, ctx: CommandContext = {}): CommandResult<Rack> {
  const { fields, problem } = rackFields(data, draft);
  if (!fields) return fail('Rack not saved', problem!, 'warning');
  if (racksOf(data).some((r) => r.siteId === draft.siteId && sameName(r.name, fields.name as string))) {
    return fail('Name in use', `This site already has a rack called ${fields.name as string}.`, 'warning');
  }
  const rack = withFields({ id: newRecordId('RACK'), ...stamp(ctx, 'created') } as Rack, fields);
  const site = sitesOf(data).find((s) => s.id === rack.siteId)!;
  return succeed(rack, { racks: [...racksOf(data), rack] }, {
    notice: notice('success', 'Rack added', `${rack.name} at ${site.name}${rack.heightUnits ? `, ${rack.heightUnits} units` : ', height not recorded'}.`),
    audit: [{ action: 'RACK_CREATED', details: `${rack.id}: ${rack.name} at ${site.id}${rack.heightUnits ? `, ${rack.heightUnits}U` : ''}`, assetId: rack.id, assetType: 'Rack' }],
  });
}

/**
 * Saves a rack. Moving it to another site takes the items recorded in it along (they stand in it);
 * the confirmation says how many. A height lower than an item in it is refused.
 */
export function updateRack(data: NetworkData, id: string, draft: RackDraft, ctx: CommandContext = {}): CommandResult<Rack> {
  const rack = racksOf(data).find((r) => r.id === id);
  if (!rack) return fail('Rack missing', `Rack ${id} is not on record.`);
  const { fields, problem } = rackFields(data, draft);
  if (!fields) return fail('Rack not saved', problem!, 'warning');
  if (racksOf(data).some((r) => r.id !== id && r.siteId === draft.siteId && sameName(r.name, fields.name as string))) {
    return fail('Name in use', `That site already has a rack called ${fields.name as string}.`, 'warning');
  }
  const updated = withFields({ ...rack, ...stamp(ctx, 'updated') }, fields);
  const moved = rack.siteId !== updated.siteId ? data.equipment.filter((e) => e.rackId === id) : [];
  const patch: NetworkPatch = { racks: racksOf(data).map((r) => (r.id === id ? updated : r)) };
  if (moved.length) patch.equipment = data.equipment.map((e) => (e.rackId === id ? { ...e, siteId: updated.siteId } : e));
  const result = checkedChange(data, patch, updated, {
    notice: notice('success', 'Rack saved', `${updated.name} saved.`),
    audit: [{ action: 'RACK_UPDATED', details: `${id}: ${updated.name}${moved.length ? `, moved to site ${updated.siteId} with ${moved.length} item(s)` : ''}`, assetId: id, assetType: 'Rack' }],
  });
  if (!result.ok || !moved.length) return result;
  const site = sitesOf(data).find((s) => s.id === updated.siteId)!;
  return { ...result, confirm: `${result.confirm ? `${result.confirm} ` : ''}Move rack ${rack.name} to ${site.name}? The ${moved.length} item(s) recorded in it move with it.` };
}

/** Removes a rack that no item names. One with items is refused, saying what to move first. */
export function deleteRack(data: NetworkData, id: string): CommandResult<Rack> {
  const rack = racksOf(data).find((r) => r.id === id);
  if (!rack) return fail('Rack missing', `Rack ${id} is not on record.`);
  const items = data.equipment.filter((e) => e.rackId === id);
  if (items.length) {
    return fail('Rack in use', `${rack.name} still holds ${items.length} item(s) (${items.slice(0, 3).map((e) => e.name).join(', ')}${items.length > 3 ? ', …' : ''}). Take them out of the rack first. Nothing was deleted.`);
  }
  return succeed(rack, { racks: racksOf(data).filter((r) => r.id !== id) }, {
    confirm: `Delete rack ${rack.name}? You can undo this.`,
    notice: notice('info', 'Rack deleted', `${rack.name} removed.`),
    audit: [{ action: 'RACK_DELETED', details: `${id}: ${rack.name}`, assetId: id, assetType: 'Rack' }],
  });
}

/* ------------------------------------------------------------------ */
/* Placing equipment                                                   */
/* ------------------------------------------------------------------ */

export interface RackPlace {
  siteId?: string;
  rackId?: string;
  /** The lowest unit it fills. */
  rackUnit?: number;
  /** How many units tall it is. */
  rackUnits?: number;
}

const goodUnit = (n: number | undefined) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 60);

/**
 * Records which site and rack an item sits in and which units it fills, or clears it (`null`).
 * Choosing a rack also records its site (the rack stands there). An item reaching past the top of
 * the rack is refused; two items in one unit is a warning.
 */
export function placeInRack(data: NetworkData, equipmentId: string, place: RackPlace | null, _ctx: CommandContext = {}): CommandResult<Equipment> {
  const item = data.equipment.find((e) => e.id === equipmentId);
  if (!item) return fail('Equipment Missing', `${equipmentId} was not found.`);
  let fields: Record<string, unknown> = { siteId: undefined, rackId: undefined, rackUnit: undefined, rackUnits: undefined };
  let text = 'not in a recorded site or rack';
  if (place) {
    const rack = place.rackId ? racksOf(data).find((r) => r.id === place.rackId) : undefined;
    if (place.rackId && !rack) return fail('Rack missing', `Rack ${place.rackId} is not on record.`);
    const siteId = place.siteId || rack?.siteId;
    if (rack && place.siteId && place.siteId !== rack.siteId) return fail('Not saved', `Rack ${rack.name} is at another site. Choose a rack at the chosen site.`, 'warning');
    const site = siteId ? sitesOf(data).find((s) => s.id === siteId) : undefined;
    if (siteId && !site) return fail('Site missing', `Site ${siteId} is not on record.`);
    if (!site) return fail('Not saved', 'Choose the site, and the rack if it is in one.', 'warning');
    if (!goodUnit(place.rackUnit) || !goodUnit(place.rackUnits)) return fail('Not saved', 'A unit number and a height are whole numbers from 1 to 60.', 'warning');
    if ((place.rackUnit !== undefined || place.rackUnits !== undefined) && !rack) return fail('Not saved', 'Choose the rack before its unit.', 'warning');
    if (place.rackUnits !== undefined && place.rackUnit === undefined) return fail('Not saved', 'Write the lowest unit it fills too, or leave the height empty.', 'warning');
    fields = { siteId: site.id, rackId: rack?.id, rackUnit: place.rackUnit, rackUnits: place.rackUnits };
    const units = unitsFilled({ rackUnit: place.rackUnit, rackUnits: place.rackUnits });
    text = `${site.name}${rack ? `, rack ${rack.name}` : ''}${units ? `, ${unitText(units)}${units.heightKnown ? '' : ' (height not recorded)'}` : rack ? ', unit not recorded' : ''}`;
  }
  const updated = withFields(item, fields);
  return checkedChange(
    data,
    { equipment: data.equipment.map((e) => (e.id === equipmentId ? updated : e)) },
    updated,
    {
      notice: notice('success', 'Place saved', `${item.name}: ${text}.`),
      audit: [{ action: place ? 'EQUIPMENT_RACKED' : 'EQUIPMENT_UNRACKED', details: `${item.id}: ${text}`, assetId: item.id, assetType: 'Equipment' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* What to show                                                        */
/* ------------------------------------------------------------------ */

export interface RackSlot {
  equipment: Equipment;
  from: number;
  to: number;
  heightKnown: boolean;
  /** Reaches past the top of the rack. */
  beyond: boolean;
}

export interface RackElevation {
  rack: Rack;
  /** Recorded height, or undefined: then no unit is drawn or called free. */
  height?: number;
  numbering: RackNumbering;
  numberingRecorded: boolean;
  /** Items with a recorded unit, lowest first. */
  slots: RackSlot[];
  /** Items recorded in this rack with no unit written. */
  unplaced: Equipment[];
  /** Units 1..height that no recorded item fills. Undefined when the height is not recorded. */
  freeUnits?: number[];
  /** Items whose height is not recorded: only their first unit is known, so more may be taken. */
  heightUnknown: number;
}

/** The rack as recorded: what sits in each unit and which units are free. */
export function rackElevation(rack: Rack, equipment: readonly Equipment[]): RackElevation {
  const inside = equipment.filter((e) => e.rackId === rack.id);
  const slots: RackSlot[] = inside
    .flatMap((e) => {
      const u = unitsFilled(e);
      return u ? [{ equipment: e, ...u, beyond: rack.heightUnits !== undefined && u.to > rack.heightUnits }] : [];
    })
    .sort((a, b) => a.from - b.from || a.equipment.name.localeCompare(b.equipment.name));
  const height = rack.heightUnits;
  let freeUnits: number[] | undefined;
  if (height !== undefined) {
    const taken = new Set<number>();
    for (const s of slots) for (let u = s.from; u <= Math.min(s.to, height); u += 1) taken.add(u);
    freeUnits = Array.from({ length: height }, (_, i) => i + 1).filter((u) => !taken.has(u));
  }
  return {
    rack,
    height,
    numbering: rack.numbering ?? 'bottom_up',
    numberingRecorded: rack.numbering !== undefined,
    slots,
    unplaced: inside.filter((e) => !e.rackUnit),
    freeUnits,
    heightUnknown: slots.filter((s) => !s.heightKnown).length,
  };
}

/** Free units as short runs, such as "1 to 4, 9, 12 to 20". */
export function describeUnitRuns(units: readonly number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < units.length; ) {
    let j = i;
    while (j + 1 < units.length && units[j + 1] === units[j] + 1) j += 1;
    runs.push(i === j ? `${units[i]}` : `${units[i]} to ${units[j]}`);
    i = j + 1;
  }
  return runs.join(', ');
}

export interface WhereItSits {
  site?: Site;
  rack?: Rack;
  /** What to show for the site: the record's name, else the older free text, else "Not recorded". */
  siteText: string;
  rackText: string;
  unitText: string;
  /** True when the site or rack text came from the older free-text fields. */
  fromFreeText: boolean;
}

/** Where an item is, for showing. Linked records first; the older free text only when no record is linked. */
export function whereItSits(data: Partial<Pick<NetworkData, 'sites' | 'racks'>>, item: Equipment): WhereItSits {
  const rack = item.rackId ? racksOf(data).find((r) => r.id === item.rackId) : undefined;
  const site = sitesOf(data).find((s) => s.id === (item.siteId ?? rack?.siteId));
  const units = unitsFilled(item);
  const siteText = site ? site.name : item.siteId ? `${item.siteId} (not on record)` : item.site?.trim() ? `${item.site.trim()} (as written)` : 'Not recorded';
  const rackText = rack ? rack.name : item.rackId ? `${item.rackId} (not on record)` : item.rackNumber?.trim() ? `${item.rackNumber.trim()} (as written)` : 'Not recorded';
  return {
    site,
    rack,
    siteText,
    rackText,
    unitText: units ? `${units.from === units.to ? `Unit ${units.from}` : `Units ${units.from} to ${units.to}`}${units.heightKnown ? '' : ' (height not recorded)'}` : 'Not recorded',
    fromFreeText: (!site && !item.siteId && !!item.site?.trim()) || (!rack && !item.rackId && !!item.rackNumber?.trim()),
  };
}
