import type { ChangeSet } from '../model/api';
import type { RfElement, RfLink } from '../model/rfSchemas';
import type { FiberProblem } from './fiberRules';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';
import { checkRfLevels, estimateAt, estimateRfLevels, profileAppliesAt } from './rfLevels';
import { DEFAULT_RF_SETTINGS, profileWindowDbuv, type RfSettings } from './rfSettings';
import { describeRfLink, describeRfPort, findRfLoops, findRfPort, indexRf, isPoweredRf, portKey, RF_KIND_INFO, type RfData, traceRfUpstream } from './rfTree';
import { formatRfBoth } from './rfUnits';

/**
 * Cable TV checks (Phase 6). The browser commands and the server run the same rules. Errors are
 * physical impossibilities or broken data and are refused: a link from an input or into an output,
 * light into an RF port (optical becomes RF only inside a node), two feeds into one input, one port
 * feeding two places (such as a tap drop port used twice), a loop, a 1310 nm transmitter into an
 * EDFA, PON light through a plain EDFA, a link or level naming something not on record, a level
 * called measured or device reported with nothing to say where it came from. Everything else is a
 * warning that may be accepted, and the acceptance goes into the audit trail.
 *
 * **No PON rule is applied here, and no rule here is applied to PON records.** An RF splitter or tap
 * has no ratio rule and no 10·log10(N) minimum: its losses are as entered. RF records are not in the
 * fiber or connection checks at all.
 */

export type RfCheckData = RfData;

export const PON_WAVELENGTHS_NM = [1490, 1310, 1577, 1270] as const;
const carriesPon = (link: Pick<RfLink, 'wavelengthsNm'>) => (link.wavelengthsNm ?? []).some((w) => (PON_WAVELENGTHS_NM as readonly number[]).includes(w));

const MEDIUM_FITS: Record<RfLink['medium'], readonly string[]> = { coax: ['rf'], fiber: ['optical'], jumper: ['rf', 'optical'], power: ['power'] };

export interface RfCheckOptions {
  rf?: RfSettings;
  optical?: OpticalSettings;
  /** Level, power and cascade warnings. Off for the server, which only refuses errors. */
  warnings?: boolean;
}

export function findRfProblems(data: RfCheckData, options: RfCheckOptions = {}): FiberProblem[] {
  const rf = options.rf ?? DEFAULT_RF_SETTINGS;
  const problems: FiberProblem[] = [];
  const error = (code: string, key: string, message: string, refs: string[]) => problems.push({ severity: 'error', code, key: `${code}:${key}`, message, refs });
  const warning = (code: string, key: string, message: string, refs: string[]) => problems.push({ severity: 'warning', code, key: `${code}:${key}`, message, refs });
  const ix = indexRf(data);
  const label = (el: RfElement) => `${RF_KIND_INFO[el.kind].label} ${el.name}`;
  const customers = new Map((data.customers ?? []).map((c) => [c.id, c]));
  const equipment = new Set((data.equipment ?? []).map((e) => e.id));

  // --- Items -----------------------------------------------------------------------------------
  for (const el of data.rfElements) {
    const portIds = el.ports.map((p) => p.id);
    if (new Set(portIds).size !== portIds.length) error('rf_port_repeated', el.id, `${label(el)} lists one port twice.`, [el.id]);
    if (el.customerId && data.customers && !customers.has(el.customerId)) error('rf_missing_customer', el.id, `${label(el)} names customer ${el.customerId}, who is not on record.`, [el.id]);
    if (el.siteEquipmentId && data.equipment && !equipment.has(el.siteEquipmentId)) error('rf_missing_site', el.id, `${label(el)} is placed at pin ${el.siteEquipmentId}, which is not on record.`, [el.id]);
  }

  // --- Links -----------------------------------------------------------------------------------
  for (const link of data.rfLinks.filter((l) => l.status === 'active')) {
    const from = ix.elements.get(link.from.elementId);
    const to = ix.elements.get(link.to.elementId);
    if (!from || !to) {
      error('rf_link_missing_item', link.id, `A Cable TV link (${link.id}) names ${!from ? link.from.elementId : link.to.elementId}, which is not on record.`, [link.id]);
      continue;
    }
    const fp = findRfPort(from, link.from.portId);
    const tp = findRfPort(to, link.to.portId);
    if (!fp || !tp) {
      error('rf_link_missing_port', link.id, `A Cable TV link names ${!fp ? describeRfPort(ix, link.from) : describeRfPort(ix, link.to)}.`, [link.id]);
      continue;
    }
    if (from.id === to.id) error('rf_link_self', link.id, `${label(from)} is linked to itself.`, [link.id, from.id]);
    if (fp.direction !== 'out' || tp.direction !== 'in') {
      error(
        'rf_link_direction',
        link.id,
        `${describeRfPort(ix, fp.direction !== 'out' ? link.from : link.to)} is ${fp.direction !== 'out' ? 'an input, so it cannot feed anything' : 'an output, so nothing can feed it'}. Signal goes from an OUT port to an IN port.`,
        [link.id],
      );
    }
    if (fp.signal !== tp.signal) {
      const lightToRf = fp.signal === 'optical' && tp.signal === 'rf';
      error(
        'rf_signal_mismatch',
        link.id,
        lightToRf
          ? `${describeRfPort(ix, link.from)} carries light and ${describeRfPort(ix, link.to)} takes TV signal on coax. Light becomes TV signal only inside a node or mini-node.`
          : `${describeRfPort(ix, link.from)} (${fp.signal}) cannot feed ${describeRfPort(ix, link.to)} (${tp.signal}).`,
        [link.id],
      );
    } else if (!MEDIUM_FITS[link.medium].includes(fp.signal)) {
      error('rf_medium_mismatch', link.id, `A ${link.medium} link cannot join ${describeRfPort(ix, link.from)} to ${describeRfPort(ix, link.to)}, which are ${fp.signal} ports.`, [link.id]);
    }
    if (link.medium === 'fiber' && link.cableId && data.cables) {
      const cable = ix.cables.get(link.cableId);
      if (!cable) error('rf_missing_cable', link.id, `The fiber link into ${to.name} names cable ${link.cableId}, which is not on record.`, [link.id]);
      else if (link.fiberNumber !== undefined && link.fiberNumber > cable.fiberCount) {
        error('rf_missing_fiber', link.id, `The fiber link into ${to.name} uses fiber ${link.fiberNumber} of ${cable.name}, which has ${cable.fiberCount} fibers.`, [link.id, cable.id]);
      }
    } else if (link.cableId && data.cables && !ix.cables.has(link.cableId)) {
      error('rf_missing_cable', link.id, `The link into ${to.name} names cable ${link.cableId}, which is not on record.`, [link.id]);
    }
    // Optical physics.
    if (to.kind === 'edfa' && tp.signal === 'optical') {
      const upTx = traceRfUpstream(ix, from.id).steps.map((s) => s.element).find((e) => e.kind === 'optical_transmitter' && e.wavelengthNm !== undefined);
      if (upTx && (upTx.wavelengthNm! < 1545 || upTx.wavelengthNm! > 1565)) {
        error('rf_edfa_wavelength', link.id, `${label(upTx)} sends ${upTx.wavelengthNm} nm, but ${label(to)} only amplifies 1545–1565 nm. A 1310 nm transmitter cannot feed an EDFA.`, [link.id, upTx.id, to.id]);
      }
    }
    if (carriesPon(link) && ((to.kind === 'edfa' && to.edfaKind !== 'wdm') || (from.kind === 'edfa' && from.edfaKind !== 'wdm'))) {
      const edfa = to.kind === 'edfa' ? to : from;
      error('rf_pon_through_edfa', link.id, `${describeRfLink(ix, link)} carries PON light through ${label(edfa)}, which is not recorded as a WDM EDFA with a pass port. A plain CATV EDFA cannot pass PON light.`, [link.id, edfa.id]);
    }
    if (options.warnings !== false) {
      if (carriesPon(link) && tp.signal === 'optical' && !(to.kind === 'wdm' && to.wdmRole === 'separate') && to.kind !== 'edfa') {
        warning('rf_shared_fiber_no_wdm', link.id, `${describeRfLink(ix, link)} carries TV and PON light into ${label(to)}. Record the WDM that takes them apart, or check the wavelengths.`, [link.id, to.id]);
      }
      if (link.medium === 'fiber' && link.cableId && link.fiberNumber !== undefined && !carriesPon(link)) {
        const core = ix.cables.get(link.cableId)?.cores?.find((c) => c.coreNumber === link.fiberNumber);
        const pon = core?.assignments?.find((a) => !a.releasedAt);
        if (pon) warning('rf_fiber_in_pon_use', link.id, `${describeRfLink(ix, link)} is also recorded in use for "${pon.use}". If TV and internet share it, add their wavelengths and record the WDM.`, [link.id]);
      }
      if (fp.role === 'drop' && !['stb', 'cable_modem', 'rf_splitter'].includes(to.kind)) {
        warning('rf_drop_to_line', link.id, `${describeRfPort(ix, link.from)} is a house wire port but feeds ${label(to)}. Tap drop ports feed only a house wire, a house splitter, a set top box or a modem.`, [link.id]);
      }
    }
  }

  // Two feeds into one input; one output feeding two places.
  for (const [key, list] of ix.into) {
    if (list.length < 2) continue;
    error('rf_two_feeds', key, `${describeRfPort(ix, list[0].to)} has ${list.length} links recorded into it. One input takes one feed.`, list.map((l) => l.id));
  }
  for (const [key, list] of ix.outOf) {
    if (list.length < 2) continue;
    const el = ix.elements.get(list[0].from.elementId);
    const p = findRfPort(el, list[0].from.portId);
    const targets = list.map((l) => describeRfPort(ix, l.to)).join('; ');
    if (el?.kind === 'tap' && p?.role === 'drop') {
      error('rf_tap_port_used', key, `${describeRfPort(ix, list[0].from)} already feeds ${describeRfPort(ix, list[0].to)}. One tap port takes one house wire; it is recorded for ${targets}.`, list.map((l) => l.id));
    } else {
      error('rf_port_two_links', key, `${describeRfPort(ix, list[0].from)} feeds ${list.length} places (${targets}). One port takes one cable; record a splitter or coupler between them.`, list.map((l) => l.id));
    }
  }
  for (const id of findRfLoops(ix)) {
    const el = ix.elements.get(id)!;
    error('rf_loop', id, `The recorded links go round in a loop at ${label(el)}. Signal in a Cable TV line flows one way only.`, [id]);
  }

  // --- Levels ----------------------------------------------------------------------------------
  for (const level of data.rfLevels ?? []) {
    const el = ix.elements.get(level.elementId);
    if (!el) {
      error('rf_level_missing_item', level.id, `A level (${level.id}) is recorded on item ${level.elementId}, which is not on record.`, [level.id]);
      continue;
    }
    const p = findRfPort(el, level.portId);
    if (!p) {
      error('rf_level_missing_port', level.id, `A level is recorded on ${describeRfPort(ix, { elementId: el.id, portId: level.portId })}.`, [level.id]);
      continue;
    }
    if (p.signal === 'optical' && level.unit !== 'dBm') {
      error('rf_level_unit', level.id, `${describeRfPort(ix, level)} carries light, so its level is in dBm, not ${level.unit}.`, [level.id]);
    }
    if (level.origin === 'field_measured' && !level.technician && !level.instrument && !level.photoId) {
      error('rf_level_no_source', level.id, `A measured level at ${describeRfPort(ix, level)} names no technician, meter or photo. Say who read it, or record it as designed.`, [level.id]);
    }
    if (level.origin === 'device_reported' && !level.source) {
      error('rf_level_no_source', level.id, `A level at ${describeRfPort(ix, level)} is called reported by a device, but no source is recorded. Name the device page or report it came from.`, [level.id]);
    }
    if (level.origin === 'calculated') {
      error('rf_level_calculated_stored', level.id, `A level at ${describeRfPort(ix, level)} is stored as calculated. Estimates are worked out on the page, never stored as readings.`, [level.id]);
    }
  }

  if (options.warnings === false) return problems;

  // --- Warnings: gaps, power, cascades, levels -------------------------------------------------
  for (const el of data.rfElements) {
    const info = RF_KIND_INFO[el.kind];
    if (info.power === 'ask' && el.powered === undefined) {
      warning('rf_power_not_recorded', el.id, `${label(el)}: powered or passive is not recorded. A passive mini-node has a much tighter level budget.`, [el.id]);
    }
    if ((el.kind === 'optical_node' || el.kind === 'mini_node') && el.powered === false) {
      const input = el.ports.find((p) => p.direction === 'in');
      const recorded = (data.rfLevels ?? []).some((l) => l.elementId === el.id && l.portId === input?.id && l.unit === 'dBm' && l.origin !== 'calculated');
      if (!recorded) warning('rf_passive_node_no_light', el.id, `${label(el)} is passive, but no light level is recorded at its input. Record a meter reading.`, [el.id]);
    }
    if (el.kind === 'rf_amplifier' && el.gainDb === undefined) warning('rf_amp_no_gain', el.id, `${label(el)}: gain not recorded, so levels below it cannot be estimated.`, [el.id]);
    if ((el.kind === 'stb' || el.kind === 'cable_modem') && !el.customerId) warning('rf_device_no_customer', el.id, `${label(el)} is not linked to a customer.`, [el.id]);
    if (!info.root) {
      const trace = traceRfUpstream(ix, el.id);
      if (!trace.complete && !trace.loop && trace.steps[0]?.element.id === el.id) {
        warning('rf_not_linked', el.id, trace.gap ?? `${label(el)} is not reached from a headend.`, [el.id]);
      }
      if (trace.complete && trace.amplifiers > rf.cascadeLimit && el.kind === 'rf_amplifier') {
        warning('rf_cascade', el.id, `${label(el)} is amplifier ${trace.amplifiers} in its cascade, above the ${rf.cascadeLimit} in Cable TV settings (proposed).`, [el.id]);
      }
      if (el.kind === 'rf_amplifier' && el.powerFeed === 'coax' && trace.complete) {
        const inserter = trace.steps.some((s) => s.element.kind === 'power_inserter' || (s.element.id !== el.id && s.element.kind === 'rf_amplifier' && s.element.powerFeed === 'local'));
        if (!inserter) warning('rf_no_power_inserter', el.id, `${label(el)} is powered over the coax, but no power inserter is recorded above it.`, [el.id]);
      }
    }
  }
  for (const c of data.customers ?? []) {
    if (c.accessNetwork !== 'hfc' || c.status === 'Disconnected') continue;
    if (!data.rfElements.some((e) => e.customerId === c.id)) {
      warning('rf_customer_no_device', c.id, `Cable TV customer ${c.id} has no set top box or modem recorded.`, [c.id]);
    }
  }

  const estimates = estimateRfLevels(data, rf, options.optical ?? DEFAULT_OPTICAL_SETTINGS, ix);
  for (const check of checkRfLevels(data, estimates, rf, ix)) {
    const where = describeRfPort(ix, check.level);
    if (check.outsideProfile && check.window) {
      warning(
        'rf_level_outside_profile',
        check.level.id,
        `${where}: ${formatRfBoth(check.trueDbuv)} is ${check.outsideProfile} the ${rf.profiles[rf.activeProfile].label} window (${formatRfBoth(check.window.min)} to ${formatRfBoth(check.window.max)}, proposed).`,
        [check.level.id],
      );
    }
    if (check.aboveEstimate) {
      warning(
        'rf_level_above_estimate',
        check.level.id,
        `${where}: the reading ${formatRfBoth(check.trueDbuv)} is above the estimate ${formatRfBoth(check.estimateDbuv)}. Passive parts cannot add signal: check the unit (60 dB between dBµV and dBmV), a test point, or the port read.`,
        [check.level.id],
      );
    }
  }
  // Estimated levels at customer devices outside the window.
  const profile = rf.profiles[rf.activeProfile];
  for (const el of data.rfElements) {
    for (const p of el.ports) {
      if (!profileAppliesAt(el, p) || el.kind === 'tap') continue;
      const e = estimates.get(portKey(el.id, p.id));
      for (const f of [rf.lowMhz, rf.highMhz]) {
        const v = estimateAt(e, f, rf);
        if (v === undefined) continue;
        const w = profileWindowDbuv(profile, f);
        if (v < w.min || v > w.max) {
          warning('rf_estimate_outside_profile', `${el.id}/${f}`, `${label(el)}: the estimated level at ${f} MHz, ${formatRfBoth(v)}, is ${v < w.min ? 'below' : 'above'} the ${profile.label} window (proposed). Estimated, not measured.`, [el.id]);
        }
      }
    }
  }
  return problems;
}

export interface RfChangeCheck {
  errors: FiberProblem[];
  warnings: FiberProblem[];
}

/** Problems a change adds. Problems already in the data are not blamed on it. */
export function newRfProblems(before: RfCheckData, after: RfCheckData, options: RfCheckOptions = {}): RfChangeCheck {
  const old = new Set(findRfProblems(before, options).map((p) => p.key));
  const added = findRfProblems(after, options).filter((p) => !old.has(p.key));
  return { errors: added.filter((p) => p.severity === 'error'), warnings: added.filter((p) => p.severity === 'warning') };
}

const RF_CHECKED = ['rfElements', 'rfLinks', 'rfLevels', 'cables', 'customers', 'equipment'] as const;

/** Whether a change set could add a Cable TV problem. */
export function changeSetTouchesRf(changes: ChangeSet): boolean {
  const writes = (['rfElements', 'rfLinks', 'rfLevels'] as const).some((name) => (changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0);
  const deletesParents = (['cables', 'customers', 'equipment'] as const).some((name) => (changes.deletes?.[name]?.length ?? 0) > 0);
  return writes || deletesParents;
}

/** Errors a change set would add to the stored Cable TV records. Used by the server before it writes. */
export function checkChangeSetRf(current: RfCheckData, changes: ChangeSet): FiberProblem[] {
  const after: Record<string, { id: string }[]> = {};
  for (const name of RF_CHECKED) {
    const byId = new Map(((current[name] ?? []) as unknown as { id: string }[]).map((r) => [r.id, r]));
    for (const id of changes.deletes?.[name] ?? []) byId.delete(id);
    for (const record of (changes.upserts?.[name] ?? []) as { id: string }[]) byId.set(record.id, record);
    after[name] = [...byId.values()];
  }
  return newRfProblems(current, after as unknown as RfCheckData, { warnings: false }).errors;
}

/** Why a pin, cable or customer cannot be deleted yet: a Cable TV item or link still names it. */
export function rfUsesOf(data: Pick<RfData, 'rfElements' | 'rfLinks'>, id: string): string[] {
  const uses: string[] = [];
  for (const el of data.rfElements) {
    if (el.siteEquipmentId === id) uses.push(`${RF_KIND_INFO[el.kind].label} ${el.name} is placed here`);
    if (el.customerId === id) uses.push(`${RF_KIND_INFO[el.kind].label} ${el.name} belongs to this customer`);
  }
  for (const link of data.rfLinks.filter((l) => l.status === 'active')) if (link.cableId === id) uses.push(`a Cable TV link runs in it`);
  return uses;
}

/** Whether a stored record names this element (so it is not deleted silently). */
export const rfLinksOf = (data: Pick<RfData, 'rfLinks'>, elementId: string): RfLink[] =>
  data.rfLinks.filter((l) => l.status === 'active' && (l.from.elementId === elementId || l.to.elementId === elementId));

/** Warnings only shown, never blocking: whether the element is powered, for the tree badges. */
export const rfPowerWord = (el: RfElement): string => {
  const p = isPoweredRf(el);
  if (RF_KIND_INFO[el.kind].power === 'customer') return 'Customer device';
  return p === true ? 'Powered' : p === false ? 'Passive' : 'Power not recorded';
};

