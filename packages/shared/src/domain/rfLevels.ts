import type { RfElement, RfLevel, RfLink, RfPort } from '../model/rfSchemas';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';
import { DEFAULT_RF_SETTINGS, profileWindowDbuv, type RfSettings } from './rfSettings';
import { findRfPort, indexRf, mainInputOf, portKey, RF_KIND_INFO, type RfData, type RfIndex } from './rfTree';
import { formatRfBoth, trueRfLevelDbuv } from './rfUnits';

/**
 * Estimated levels down the RF tree (Phase 6). Every number here is **Estimated**: worked out from
 * what was recorded (the node's datasheet rating and its light, amplifier gain and tilt as entered,
 * coax type and length, the loss entered for each splitter and tap port), never measured. Where a
 * value is missing the estimate stops at that port and says which value is missing; it never fills
 * in a typical number. Recorded optical levels (a meter or a design figure) are used as the starting
 * point wherever they exist; on the RF side only a node's output is used that way.
 *
 * The formulas are the app's own, written down so they can be checked:
 *   coax loss at f = loss per 100 m at 750 MHz × √(f / 750) × length / 100 (rule of thumb)
 *   amplifier out at high f = in + gain; at low f = in + gain − tilt
 *   node RF out = rated output + 2 × (light in − rated light), because 1 dB of light is 2 dB of RF
 *   fiber loss = length × the 1550 nm loss per km in Optical settings + one connector pair
 */

/** RF in dBµV at the two reference frequencies, or light in dBm. */
export interface RfPortEstimate {
  low?: number;
  high?: number;
  opticalDbm?: number;
  /** How it was worked out, top first. */
  basis: string[];
  /** Why it could not be worked out: the first missing value. */
  stop?: string;
}

export type RfEstimates = Map<string, RfPortEstimate>;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The newest recorded level at a port that is not itself an estimate. */
export function latestRecordedLevel(levels: readonly RfLevel[] | undefined, elementId: string, portId: string, unit?: 'optical' | 'rf'): RfLevel | undefined {
  return (levels ?? [])
    .filter((l) => l.elementId === elementId && l.portId === portId && l.origin !== 'calculated' && (unit === undefined || (unit === 'optical') === (l.unit === 'dBm')))
    .sort((a, b) => (b.measuredAt ?? b.createdAt).localeCompare(a.measuredAt ?? a.createdAt))[0];
}

/** Coax loss in dB at a frequency, or the reason it cannot be worked out. */
export function coaxLossDb(link: Pick<RfLink, 'coaxType' | 'lengthM'>, frequencyMhz: number, settings: RfSettings = DEFAULT_RF_SETTINGS): number | string {
  if (!link.coaxType) return 'coax type not recorded';
  const per100 = settings.coaxLossPer100mAt750[link.coaxType];
  if (per100 === undefined) return `no loss in Cable TV settings for ${link.coaxType} coax`;
  if (link.lengthM === undefined) return 'coax length not recorded';
  return per100 * Math.sqrt(frequencyMhz / 750) * (link.lengthM / 100);
}

interface Ctx {
  data: RfData;
  ix: RfIndex;
  rf: RfSettings;
  optical: OpticalSettings;
  out: RfEstimates;
}

const name = (el: RfElement) => `${RF_KIND_INFO[el.kind].label} ${el.name}`;
const stopped = (stop: string, basis: string[] = []): RfPortEstimate => ({ basis, stop });

/** What arrives at the input port through the link, from the upstream port's estimate. */
function acrossLink(c: Ctx, link: RfLink, up: RfPortEstimate | undefined, to: RfElement, toPort: RfPort): RfPortEstimate {
  const where = `${to.name} ${toPort.label}`;
  if (!up || up.stop) return stopped(up?.stop ?? `nothing worked out above ${where}`, up?.basis ?? []);
  if (toPort.signal === 'optical') {
    if (up.opticalDbm === undefined) return stopped(`no light level above ${where}`, up.basis);
    if (link.medium === 'jumper') return { opticalDbm: up.opticalDbm, basis: [...up.basis, 'jumper counted as no loss'] };
    const cable = link.cableId ? c.ix.cables.get(link.cableId) : undefined;
    const meters = link.lengthM ?? (cable && cable.lengthMeters > 0 ? cable.lengthMeters : undefined);
    if (meters === undefined) return stopped(`fiber length into ${where} not recorded`, up.basis);
    const loss = (meters / 1000) * c.optical.fiberDbPerKm[1550] + c.optical.connectorPairDb;
    const from = link.lengthM !== undefined ? 'as entered' : 'drawn on the map';
    return { opticalDbm: up.opticalDbm - loss, basis: [...up.basis, `fiber ${r1(meters)} m (${from}) and one connector pair: −${r1(loss)} dB`] };
  }
  if (up.low === undefined || up.high === undefined) return stopped(`no RF level above ${where}`, up.basis);
  if (link.medium === 'jumper') return { low: up.low, high: up.high, basis: [...up.basis, 'jumper counted as no loss'] };
  const lowLoss = coaxLossDb(link, c.rf.lowMhz, c.rf);
  const highLoss = coaxLossDb(link, c.rf.highMhz, c.rf);
  if (typeof lowLoss === 'string' || typeof highLoss === 'string') return stopped(`${typeof lowLoss === 'string' ? lowLoss : highLoss} on the line into ${where}`, up.basis);
  return {
    low: up.low - lowLoss,
    high: up.high - highLoss,
    basis: [...up.basis, `${link.coaxType} ${link.lengthM} m: −${r1(lowLoss)} dB at ${c.rf.lowMhz} MHz, −${r1(highLoss)} dB at ${c.rf.highMhz} MHz`],
  };
}

/** The element's main input, from the link that feeds it, or a recorded light level at that port. */
function inputEstimate(c: Ctx, el: RfElement, input: RfPort): RfPortEstimate {
  const recorded = input.signal === 'optical' ? latestRecordedLevel(c.data.rfLevels, el.id, input.id, 'optical') : undefined;
  if (recorded) {
    return { opticalDbm: recorded.value, basis: [`${recorded.value} dBm recorded at ${el.name} ${input.label} (${recorded.origin.replace('_', ' ')})`] };
  }
  const feeds = c.ix.into.get(portKey(el.id, input.id)) ?? [];
  if (feeds.length !== 1) return stopped(feeds.length === 0 ? `${name(el)} ${input.label} has no recorded link` : `${name(el)} ${input.label} has ${feeds.length} links`);
  const [link] = feeds;
  const upEl = c.ix.elements.get(link.from.elementId);
  if (!upEl) return stopped(`the link into ${el.name} comes from an item not on record`);
  const up = c.out.get(portKey(upEl.id, link.from.portId));
  return acrossLink(c, link, up, el, input);
}

/** Output estimates for one element, given its input estimate. */
function outputsOf(c: Ctx, el: RfElement, input: RfPortEstimate | undefined): void {
  const set = (p: RfPort, e: RfPortEstimate) => c.out.set(portKey(el.id, p.id), e);
  const outs = el.ports.filter((p) => p.direction === 'out' && p.signal !== 'power');
  for (const p of outs) {
    const recordedLight = p.signal === 'optical' ? latestRecordedLevel(c.data.rfLevels, el.id, p.id, 'optical') : undefined;
    if (recordedLight) {
      set(p, { opticalDbm: recordedLight.value, basis: [`${recordedLight.value} dBm recorded at ${el.name} ${p.label} (${recordedLight.origin.replace('_', ' ')})`] });
      continue;
    }
    switch (el.kind) {
      case 'headend':
      case 'cmts':
      case 'optical_transmitter':
      case 'edfa':
        set(p, stopped(p.signal === 'optical' ? `light out of ${name(el)} ${p.label} not recorded` : `RF out of ${name(el)} not needed for the estimate`));
        break;
      case 'optical_node':
      case 'mini_node':
        set(p, nodeOutput(c, el, p, input));
        break;
      case 'rf_amplifier': {
        if (!input || input.stop || input.low === undefined || input.high === undefined) set(p, stopped(input?.stop ?? `no level into ${el.name}`, input?.basis));
        else if (el.gainDb === undefined) set(p, stopped(`gain of ${name(el)} not recorded`, input.basis));
        else {
          const tilt = el.tiltDb ?? 0;
          set(p, {
            low: input.low + el.gainDb - tilt,
            high: input.high + el.gainDb,
            basis: [...input.basis, `${el.name}: gain ${el.gainDb} dB${el.tiltDb === undefined ? ', tilt not recorded (taken as 0)' : `, tilt ${tilt} dB`}`],
          });
        }
        break;
      }
      default: {
        // Passive parts: the loss entered for this output port.
        if (!input || input.stop) {
          set(p, stopped(input?.stop ?? `no level into ${el.name}`, input?.basis));
          break;
        }
        if (p.lossDb === undefined) {
          set(p, stopped(`loss of ${name(el)} ${p.label} not recorded`, input.basis));
          break;
        }
        const step = `${el.name} ${p.label}: −${p.lossDb} dB (as entered)`;
        if (p.signal === 'optical') {
          set(p, input.opticalDbm === undefined ? stopped(`no light into ${el.name}`, input.basis) : { opticalDbm: input.opticalDbm - p.lossDb, basis: [...input.basis, step] });
        } else if (input.low === undefined || input.high === undefined) {
          set(p, stopped(`no RF level into ${el.name}`, input.basis));
        } else {
          set(p, { low: input.low - p.lossDb, high: input.high - p.lossDb, basis: [...input.basis, step] });
        }
      }
    }
  }
}

function nodeOutput(c: Ctx, el: RfElement, p: RfPort, input: RfPortEstimate | undefined): RfPortEstimate {
  const tilt = el.tiltDb ?? 0;
  const tiltNote = el.tiltDb === undefined ? ', tilt not recorded (taken as flat)' : `, tilt ${tilt} dB`;
  const recorded = latestRecordedLevel(c.data.rfLevels, el.id, p.id, 'rf');
  if (recorded) {
    const v = trueRfLevelDbuv(recorded);
    if (v !== undefined) {
      const atHigh = (recorded.frequencyMhz ?? c.rf.highMhz) >= (c.rf.lowMhz + c.rf.highMhz) / 2;
      return {
        low: atHigh ? v - tilt : v,
        high: atHigh ? v : v + tilt,
        basis: [`${formatRfBoth(v)} recorded at ${el.name} ${p.label} (${recorded.origin.replace('_', ' ')})${tiltNote}`],
      };
    }
  }
  if (el.ratedOutputDbuv === undefined || el.ratedAtInputDbm === undefined) return stopped(`rated output of ${name(el)} not recorded`, input?.basis);
  if (!input || input.opticalDbm === undefined) return stopped(input?.stop ?? `light into ${name(el)} not recorded`, input?.basis);
  const high = el.ratedOutputDbuv + 2 * (input.opticalDbm - el.ratedAtInputDbm);
  return {
    low: high - tilt,
    high,
    basis: [...input.basis, `${el.name}: rated ${el.ratedOutputDbuv} dBµV at ${el.ratedAtInputDbm} dBm, light ${r1(input.opticalDbm)} dBm (2 dB RF per 1 dB light)${tiltNote}`],
  };
}

/**
 * Estimates for every port that can be worked out, keyed by `portKey`. Input ports hold what
 * arrives; output ports what leaves. Items are visited from the top of each recorded chain down.
 */
export function estimateRfLevels(data: RfData, rf: RfSettings = DEFAULT_RF_SETTINGS, optical: OpticalSettings = DEFAULT_OPTICAL_SETTINGS, ix: RfIndex = indexRf(data)): RfEstimates {
  const c: Ctx = { data, ix, rf, optical, out: new Map() };
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (el: RfElement) => {
    if (done.has(el.id) || visiting.has(el.id)) return;
    visiting.add(el.id);
    const input = mainInputOf(el);
    let inEstimate: RfPortEstimate | undefined;
    if (input) {
      const feed = (ix.into.get(portKey(el.id, input.id)) ?? [])[0];
      const upEl = feed ? ix.elements.get(feed.from.elementId) : undefined;
      if (upEl) visit(upEl);
      inEstimate = inputEstimate(c, el, input);
      c.out.set(portKey(el.id, input.id), inEstimate);
    }
    outputsOf(c, el, inEstimate);
    visiting.delete(el.id);
    done.add(el.id);
  };
  for (const el of data.rfElements) visit(el);
  return c.out;
}

export interface RfLevelCheck {
  level: RfLevel;
  element?: RfElement;
  port?: RfPort;
  /** The real level at the port (unit converted, test point added). Absent for light. */
  trueDbuv?: number;
  estimate?: RfPortEstimate;
  /** The estimate at the reading's frequency (nearest of the two reference frequencies). */
  estimateDbuv?: number;
  window?: { min: number; max: number };
  outsideProfile?: 'below' | 'above';
  aboveEstimate?: boolean;
}

/** Ports where the customer profile applies: a set top box or modem input, and a tap's drop ports. */
export function profileAppliesAt(el: RfElement, p: RfPort): boolean {
  if ((el.kind === 'stb' || el.kind === 'cable_modem') && p.direction === 'in') return true;
  return el.kind === 'tap' && p.role === 'drop';
}

/** Estimate at a frequency: the nearer of the two reference frequencies. */
export const estimateAt = (e: RfPortEstimate | undefined, frequencyMhz: number | undefined, rf: RfSettings): number | undefined => {
  if (!e || e.stop) return undefined;
  if (frequencyMhz === undefined) return e.high;
  return Math.abs(frequencyMhz - rf.lowMhz) <= Math.abs(frequencyMhz - rf.highMhz) ? e.low : e.high;
};

/** Each recorded RF level against the active profile and against the estimate. */
export function checkRfLevels(data: RfData, estimates: RfEstimates, rf: RfSettings = DEFAULT_RF_SETTINGS, ix: RfIndex = indexRf(data)): RfLevelCheck[] {
  const profile = rf.profiles[rf.activeProfile];
  return (data.rfLevels ?? []).map((level) => {
    const element = ix.elements.get(level.elementId);
    const port = findRfPort(element, level.portId);
    const check: RfLevelCheck = { level, ...(element ? { element } : {}), ...(port ? { port } : {}) };
    // Light (dBm at an optical port) is not an RF level: it is shown as recorded, never converted.
    if (!element || !port || port.signal !== 'rf') return check;
    const trueDbuv = trueRfLevelDbuv(level);
    if (trueDbuv === undefined) return check;
    check.trueDbuv = trueDbuv;
    const estimate = estimates.get(portKey(element.id, port.id));
    if (estimate) check.estimate = estimate;
    const at = estimateAt(estimate, level.frequencyMhz, rf);
    if (at !== undefined && level.origin !== 'designed') {
      check.estimateDbuv = at;
      check.aboveEstimate = trueDbuv > at + rf.aboveEstimateDb;
    }
    if (profileAppliesAt(element, port)) {
      const w = profileWindowDbuv(profile, level.frequencyMhz);
      check.window = w;
      if (trueDbuv < w.min) check.outsideProfile = 'below';
      else if (trueDbuv > w.max) check.outsideProfile = 'above';
    }
    return check;
  });
}
