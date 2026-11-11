import { type ColorScheme, type CoreIdentity, coreIdentity, DEFAULT_COLOR_SCHEMES, type SchemeColor, tubeSpans } from '../fiber/colors';
import { CORE_STATUS_LABELS, type CoreStatus } from '../model/enums';
import type { Cable, CoreAssignment, JointClosure, SpliceRecord } from '../model/types';
import { activeAssignment, completeCores, effectiveCoreStatus } from './fiberCommands';
import { isSpliceActive } from './fiberIndex';

/**
 * Tube and core management (Phase 7): finding a fiber, the splices a fiber has had, and the data
 * for a cable cross-section. Everything is worked out from the records; nothing is stored here and
 * nothing is guessed. A colour is given only when the cable's scheme is known.
 */

/* ------------------------------------------------------------------ */
/* Find a fiber                                                        */
/* ------------------------------------------------------------------ */

export interface CoreSearchHit {
  cableId: string;
  cableName: string;
  coreNumber: number;
  identity: CoreIdentity;
  status: CoreStatus;
  /** The active assignment's use, when there is one. */
  use?: string;
  /** Plain words for what matched, such as "use: Tower link (released)". */
  matched: string[];
}

export interface CoreSearchOptions {
  schemes?: readonly ColorScheme[];
  /** Search one cable only. */
  cableId?: string;
  /** Most hits returned (default 50). `total` still counts them all. */
  limit?: number;
}

export interface CoreSearchResult {
  hits: CoreSearchHit[];
  total: number;
}

type Term =
  | { kind: 'fiber'; n: number; raw: string }
  | { kind: 'tube'; n: number; raw: string }
  | { kind: 'tubeFiber'; tube: number; fiber: number; raw: string }
  | { kind: 'number'; n: number; raw: string }
  | { kind: 'text'; text: string; raw: string };

/**
 * Reads "F13", "fiber 13", "core 13", "T2", "tube 2", "T2/3", a bare number, and any other word.
 * Words are matched against the cable name and id, the status, a known colour, and what the fiber
 * is or was used for (use, from, to, customer, notes, override reason).
 */
export function parseCoreQuery(query: string): Term[] {
  const words = query.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  const terms: Term[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    const num = (s: string | undefined) => (s && /^\d{1,4}$/.test(s) ? Number(s) : undefined);
    let m: RegExpMatchArray | null;
    if ((word === 'fiber' || word === 'fibre' || word === 'core' || word === 'f') && num(next) !== undefined) {
      terms.push({ kind: 'fiber', n: num(next)!, raw: `${word} ${next}` });
      i += 1;
    } else if ((word === 'tube' || word === 't') && num(next) !== undefined) {
      terms.push({ kind: 'tube', n: num(next)!, raw: `${word} ${next}` });
      i += 1;
    } else if ((m = word.match(/^t(\d{1,3})\/(\d{1,3})$/))) {
      terms.push({ kind: 'tubeFiber', tube: Number(m[1]), fiber: Number(m[2]), raw: word });
    } else if ((m = word.match(/^(?:f|fiber|fibre|core)(\d{1,4})$/))) {
      terms.push({ kind: 'fiber', n: Number(m[1]), raw: word });
    } else if ((m = word.match(/^(?:t|tube)(\d{1,3})$/))) {
      terms.push({ kind: 'tube', n: Number(m[1]), raw: word });
    } else if (num(word) !== undefined) {
      terms.push({ kind: 'number', n: num(word)!, raw: word });
    } else {
      terms.push({ kind: 'text', text: word, raw: word });
    }
  }
  return terms;
}

const assignmentText = (a: CoreAssignment) =>
  [a.use, a.source, a.destination, a.customerId, a.equipmentId, a.oltId, a.ponPortId, a.notes, a.override?.reason].filter(Boolean).join(' ').toLowerCase();

/** Fibers whose cable, tube, number, state or use match every word of the query. */
export function searchCores(cables: readonly Cable[], query: string, options: CoreSearchOptions = {}): CoreSearchResult {
  const terms = parseCoreQuery(query);
  if (terms.length === 0) return { hits: [], total: 0 };
  const schemes = options.schemes ?? DEFAULT_COLOR_SCHEMES;
  const limit = options.limit ?? 50;
  const hits: CoreSearchHit[] = [];
  let total = 0;
  for (const cable of cables) {
    if (options.cableId && cable.id !== options.cableId) continue;
    if (cable.cableCategory === 'Coaxial' || cable.fiberCount < 1) continue;
    const cableText = `${cable.name} ${cable.id}`.toLowerCase();
    for (const core of completeCores(cable)) {
      const identity = coreIdentity(cable, core.coreNumber, schemes);
      const status = effectiveCoreStatus(core);
      const active = activeAssignment(core);
      const matched: string[] = [];
      const ok = terms.every((term) => {
        switch (term.kind) {
          case 'fiber':
            return core.coreNumber === term.n;
          case 'tube':
            return identity.tubeNumber === term.n;
          case 'tubeFiber':
            return identity.tubeNumber === term.tube && identity.fiberInTube === term.fiber;
          case 'number':
            if (core.coreNumber === term.n) return true;
            if (cableText.includes(term.raw)) return true;
            return (core.assignments ?? []).some((a) => assignmentText(a).includes(term.raw));
          case 'text': {
            if (cableText.includes(term.text)) return true;
            if (CORE_STATUS_LABELS[status].toLowerCase().includes(term.text) || status.toLowerCase().includes(term.text)) {
              matched.push(`state: ${CORE_STATUS_LABELS[status]}`);
              return true;
            }
            // A colour only matches when the scheme says so; an unknown scheme has no colours.
            if (identity.fiberColor?.name.toLowerCase() === term.text) {
              matched.push(`colour: ${identity.fiberColor.name}`);
              return true;
            }
            if (identity.tubeColor?.name.toLowerCase() === term.text) {
              matched.push(`tube colour: ${identity.tubeColor.name}`);
              return true;
            }
            const assignment = (core.assignments ?? []).find((a) => assignmentText(a).includes(term.text));
            if (assignment) {
              matched.push(`use: ${assignment.use}${assignment.releasedAt ? ' (released)' : ''}`);
              return true;
            }
            const extra = [core.customerId, core.customerName, core.remarks].filter(Boolean).join(' ').toLowerCase();
            if (extra.includes(term.text)) {
              matched.push('remarks or customer on the fiber record');
              return true;
            }
            return false;
          }
          default:
            return false;
        }
      });
      if (!ok) continue;
      total += 1;
      if (hits.length < limit) {
        hits.push({ cableId: cable.id, cableName: cable.name, coreNumber: core.coreNumber, identity, status, ...(active ? { use: active.use } : {}), matched: [...new Set(matched)] });
      }
    }
  }
  return { hits, total };
}

/* ------------------------------------------------------------------ */
/* Splice history of one fiber                                         */
/* ------------------------------------------------------------------ */

export interface CoreSpliceEntry {
  closureId: string;
  closureName: string;
  splice: SpliceRecord;
  /** 'from' when this fiber is the OLT side of the splice, 'to' when it is the customer side. */
  side: 'from' | 'to';
  otherCableId: string;
  otherCableName: string;
  otherCore: number;
  /** Still joining the two fibers (not retired, not "Unused"). */
  active: boolean;
}

/**
 * Every splice recorded on this fiber, in service or retired, found from the closures' splice
 * records (both sides). Oldest first by splice date, then by when it was retired.
 */
export function coreSpliceHistory(closures: readonly JointClosure[], cableId: string, coreNumber: number): CoreSpliceEntry[] {
  const entries: CoreSpliceEntry[] = [];
  for (const closure of closures) {
    for (const splice of closure.splices) {
      const asInput = splice.inputCableId === cableId && splice.inputCore === coreNumber;
      const asOutput = splice.outputCableId === cableId && splice.outputCore === coreNumber;
      if (!asInput && !asOutput) continue;
      const side = asInput ? 'from' : 'to';
      entries.push({
        closureId: closure.id,
        closureName: closure.name,
        splice,
        side,
        otherCableId: side === 'from' ? splice.outputCableId : splice.inputCableId,
        otherCableName: side === 'from' ? splice.outputCableName : splice.inputCableName,
        otherCore: side === 'from' ? splice.outputCore : splice.inputCore,
        active: isSpliceActive(splice),
      });
    }
  }
  return entries.sort((a, b) => (a.splice.date || '').localeCompare(b.splice.date || '') || (a.splice.retiredAt ?? '￿').localeCompare(b.splice.retiredAt ?? '￿'));
}

/* ------------------------------------------------------------------ */
/* Cross-section                                                       */
/* ------------------------------------------------------------------ */

export interface CrossSectionFiber {
  coreNumber: number;
  /** Position inside its tube; absent when the tubes are not recorded. */
  fiberInTube?: number;
  /** Only when the cable's fiber scheme is known. */
  color?: SchemeColor;
  status: CoreStatus;
  label: string;
}

export interface CrossSectionTube {
  /** Absent for the single group shown when the tubes are not recorded. */
  number?: number;
  /** Only when written on the tube record or known from the tube scheme. */
  color?: SchemeColor;
  fibers: CrossSectionFiber[];
}

export interface CoreCrossSection {
  /** False when the tubes are not recorded: all fibers are shown in one group, by number. */
  tubesKnown: boolean;
  schemeKnown: boolean;
  tubes: CrossSectionTube[];
}

/** The cable's tubes and fibers, ready to draw. With no tube layout, one group of numbered fibers. */
export function coreCrossSection(cable: Cable, schemes: readonly ColorScheme[] = DEFAULT_COLOR_SCHEMES): CoreCrossSection {
  const cores = completeCores(cable);
  const fiberOf = (n: number): CrossSectionFiber => {
    const identity = coreIdentity(cable, n, schemes);
    return {
      coreNumber: n,
      ...(identity.fiberInTube !== undefined ? { fiberInTube: identity.fiberInTube } : {}),
      ...(identity.fiberColor ? { color: identity.fiberColor } : {}),
      status: effectiveCoreStatus(cores[n - 1]),
      label: identity.label,
    };
  };
  const spans = cable.fiberCount > 0 ? tubeSpans(cable) : undefined;
  const schemeKnown = cable.fiberCount > 0 && coreIdentity(cable, 1, schemes).schemeKnown;
  if (!spans) {
    return { tubesKnown: false, schemeKnown, tubes: cable.fiberCount > 0 ? [{ fibers: cores.map((c) => fiberOf(c.coreNumber)) }] : [] };
  }
  return {
    tubesKnown: true,
    schemeKnown,
    tubes: spans.map((span) => {
      const tubeColor = coreIdentity(cable, span.firstCore, schemes).tubeColor;
      return {
        number: span.number,
        ...(tubeColor ? { color: tubeColor } : {}),
        fibers: Array.from({ length: span.fiberCount }, (_, i) => fiberOf(span.firstCore + i)),
      };
    }),
  };
}
