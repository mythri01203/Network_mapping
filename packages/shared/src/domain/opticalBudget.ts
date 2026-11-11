import type { ChangeSet } from '../model/api';
import {
  BUDGET_OUTCOME_LABELS,
  type BudgetDirection,
  type BudgetInputLine,
  type BudgetOutcome,
  isBudgetVerdict,
  type OpticalBudgetRun,
  opticalBudgetRunSchema,
} from '../model/opticalBudgetSchemas';
import type { Customer, Splitter } from '../model/types';
import { sameJson } from './access';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { type CorePathResult, type DirectionBudget, wavelengthsFor } from './fiberPath';
import { newRecordId } from './ids';
import { DEFAULT_OPTICAL_SETTINGS, OPTICAL_SETTING_DEFS, type OpticalOverride, type OpticalSettings, type WavelengthNm } from './opticalSettings';
import { rxReadingOf } from './rxReading';

/**
 * Network mapping Phase 17: the optical budget of one traced fibre path, with every input labelled
 * by where it came from (the record, the drawn line, the operator's setting, a built-in default, or
 * not recorded), and the runs people choose to store (`opticalBudgetRuns`).
 *
 * This file adds no loss calculation. The path and its parts come from `traceCustomerCores`
 * (`fiberPath.ts`); the sums come from `calculateOpticalLossBudget` (`lossEngine.ts`), which the
 * fibre path already calls per direction. Here they are only explained, labelled and stored.
 *
 * Rules: an assumed optics class gives no pass or fail ("Estimated with default class"); a splitter
 * with no loss on record is "Unknown", never a guessed number; a stored run is never changed or
 * deleted, and never changes a network record.
 */

/** What did the sum, stored on each run. */
export const BUDGET_METHOD = 'Fibre path (fiberPath.traceCustomerCores) summed by lossEngine.calculateOpticalLossBudget';

/** The formula in words, the same for every run. */
export const BUDGET_FORMULA =
  'Path loss (dB) = length (km) × fibre loss (dB/km) + the loss of each splitter + the loss of each splice + connector pairs × loss per connector pair. ' +
  'Room left (dB) = the class highest loss − path loss. After margin (dB) = room left − repair margin. ' +
  'Expected receive (dBm) = OLT launch (dBm) − path loss; with no recorded launch it is a range from the class launch settings. ' +
  'Each direction is worked out at its own wavelength (down 1490 nm, up 1310 nm for GPON and EPON).';

/** An operator setting as stored, with the source the operator wrote. */
export type BudgetOverride = OpticalOverride & { source?: string };

export interface BudgetContext {
  settings?: OpticalSettings;
  /** The stored settings records, to tell the operator's setting from a built-in default. */
  overrides?: readonly BudgetOverride[];
  /** Splitter records, to read where a splitter's loss came from. */
  splitters?: readonly Pick<Splitter, 'id' | 'lossSource'>[];
  /** The traced customer, for the reading line. */
  customer?: Customer;
}

export interface FibreBudget {
  targetId: string;
  complete: boolean;
  /** Why there is no budget, in plain words (from the trace). */
  gaps: string[];
  opticsClass: CorePathResult['opticsClass'];
  opticsClassRecorded: boolean;
  inputs: BudgetInputLine[];
  /** Inputs that are not a fact about this network: a setting, a default, the drawn line, or nothing recorded. */
  flagged: BudgetInputLine[];
  /** One per direction, only on a complete path. */
  directions: BudgetDirection[];
  /** The worst direction, or why there is no pass or fail. Undefined on an incomplete path. */
  outcome?: BudgetOutcome;
  outcomeText: string;
  formula: string;
  method: string;
}

const fmt = (n: number, places = 2) => n.toFixed(places);

/** Whether a stored settings value is the operator's, or the built-in default. */
function settingSource(id: string, current: number | undefined, overrides: readonly BudgetOverride[]): Pick<BudgetInputLine, 'origin' | 'source' | 'settingId'> {
  const def = OPTICAL_SETTING_DEFS.find((d) => d.id === id);
  const own = overrides.find((o) => o.id === id && typeof o.value === 'number' && Number.isFinite(o.value));
  if (own) return { origin: 'setting', settingId: id, source: `Setting ${id}. Source written: ${own.source?.trim() || 'none'}.` };
  if (def && current !== undefined && current !== def.defaultValue) return { origin: 'setting', settingId: id, source: `Setting ${id} (value given to this budget).` };
  return { origin: 'default', settingId: id, source: `Built-in default ${id}. ${def?.source ?? ''}`.trim() };
}

const settingLine = (key: string, label: string, id: string, value: number | undefined, unit: string, overrides: readonly BudgetOverride[]): BudgetInputLine => ({
  key,
  label,
  value: value === undefined ? 'Not set' : `${value} ${unit}`,
  ...(value !== undefined ? { number: value } : {}),
  ...settingSource(id, value, overrides),
});

const LOSS_ORIGIN_WORDS: Record<string, string> = {
  field_measured: 'measured on site',
  device_reported: 'reported by a device',
  designed: 'design value',
  calculated: 'calculated',
  'origin not recorded': 'where it came from is not written',
};

/** The settings use the same loss for a wavelength they hold no value for; say so. */
const nmText = (d: DirectionBudget) => (d.nominalNm ? `${d.nominalNm} nm (settings value for ${d.wavelengthNm} nm)` : `${d.wavelengthNm} nm`);

/** Every input of the budget of one fibre path, with where it came from. */
function budgetInputs(path: CorePathResult, ctx: BudgetContext, settings: OpticalSettings, overrides: readonly BudgetOverride[]): BudgetInputLine[] {
  const lines: BudgetInputLine[] = [];
  const { pon, olt } = path;
  const technology = pon?.technology ?? olt?.technology;
  const cls = path.opticsClass;

  // Optics class.
  if (!pon) {
    lines.push({ key: 'opticsClass', label: 'Optics class', value: 'Not known', origin: 'not_recorded', source: 'The path does not reach a PON port, so its class is not known.' });
  } else if (path.opticsClassRecorded) {
    lines.push({ key: 'opticsClass', label: 'Optics class', value: cls, origin: 'record', source: `Recorded on ${olt?.name ?? 'the OLT'} ${pon.id}.`, recordId: `${olt?.id ?? ''}/${pon.id}` });
  } else {
    lines.push({
      key: 'opticsClass',
      label: 'Optics class',
      value: `${cls} (assumed)`,
      origin: 'default',
      source: `Not recorded on ${olt?.name ?? 'the OLT'} ${pon.id}, so it is assumed from ${technology ? `the technology (${technology})` : 'nothing (no technology recorded either)'}. No pass or fail is given until the class is recorded on the port.`,
      recordId: `${olt?.id ?? ''}/${pon.id}`,
    });
  }
  const range = settings.classes[cls];
  if (range) {
    if (range.minLossDb !== undefined) lines.push(settingLine('class.min', `${cls} lowest path loss`, `optical.class.${cls}.minLossDb`, range.minLossDb, 'dB', overrides));
    lines.push(settingLine('class.max', `${cls} highest path loss`, `optical.class.${cls}.maxLossDb`, range.maxLossDb, 'dB', overrides));
  }
  if (pon?.vendorBudgetDb !== undefined) {
    lines.push({ key: 'vendorBudget', label: 'Vendor budget for the port', value: `${pon.vendorBudgetDb} dB`, number: pon.vendorBudgetDb, origin: 'record', source: `Recorded on ${pon.id}${pon.vendorBudgetSource ? ` (${pon.vendorBudgetSource})` : ''}. Shown apart from the class.`, recordId: `${olt?.id ?? ''}/${pon.id}` });
  }

  // Launch power.
  if (pon?.txPowerDbm !== undefined) {
    lines.push({ key: 'launch', label: 'OLT launch power', value: `${pon.txPowerDbm} dBm`, number: pon.txPowerDbm, origin: 'record', source: `Recorded on ${pon.id}.`, recordId: `${olt?.id ?? ''}/${pon.id}` });
  } else {
    lines.push({ key: 'launch', label: 'OLT launch power', value: 'Not recorded', origin: 'not_recorded', source: 'Not recorded on the port, so the expected receive level is a range from the class launch settings. Get the real launch from the OLT.' });
    if (range?.launchMinDbm !== undefined) lines.push(settingLine('class.launchMin', `${cls} OLT launch, low`, `optical.class.${cls}.launchMinDbm`, range.launchMinDbm, 'dBm', overrides));
    if (range?.launchMaxDbm !== undefined) lines.push(settingLine('class.launchMax', `${cls} OLT launch, high`, `optical.class.${cls}.launchMaxDbm`, range.launchMaxDbm, 'dBm', overrides));
  }

  // Fibre loss per wavelength.
  const wl = wavelengthsFor(technology);
  for (const [dir, nm, nominal] of [['down', wl.down, wl.downNominal], ['up', wl.up, wl.upNominal]] as [string, WavelengthNm, number | undefined][]) {
    const line = settingLine(`fiber.${nm}`, `Fibre loss at ${nm} nm (${dir})`, `optical.fiber.${nm}`, settings.fiberDbPerKm[nm], 'dB/km', overrides);
    if (nominal) line.source = `${line.source} The path uses ${nominal} nm; the settings hold no value for it.`;
    lines.push(line);
  }

  // Each cable: its length and where the length came from.
  for (const step of path.steps) {
    if (step.kind !== 'cable' || !step.cableId) continue;
    const meters = step.lengthMeters ?? 0;
    const base = { key: `length:${step.cableId}#${step.core ?? ''}`, label: `Length of ${step.title}`, recordId: step.cableId };
    if (meters <= 0) lines.push({ ...base, value: 'Not recorded', origin: 'not_recorded', source: 'No OTDR length, sheath marks or drawn length.' });
    else if (step.lengthBasis === 'optical') lines.push({ ...base, value: `${meters} m`, number: meters, origin: 'record', source: 'OTDR length on the cable record.' });
    else if (step.lengthBasis === 'sheath') lines.push({ ...base, value: `${meters} m`, number: meters, origin: 'record', source: 'Sheath marks on the cable record.' });
    else lines.push({ ...base, value: `${meters} m`, number: meters, origin: 'map', source: 'Length of the line drawn on the map. No OTDR length or sheath marks are recorded, so the real fibre may be longer (slack, bends, risers).' });
  }

  // Splitters: the loss on record, a value copied from the settings, or unknown.
  const splitterRecords = new Map((ctx.splitters ?? []).map((s) => [s.id, s]));
  for (const step of path.steps) {
    if (step.kind !== 'splitter' || !step.partLoss) continue;
    const part = step.partLoss;
    const base = { key: `splitter:${part.recordId}`, label: `Loss of ${step.title}`, recordId: step.id };
    if (part.db === undefined) {
      lines.push({ ...base, value: 'Unknown', origin: 'not_recorded', source: 'No loss is recorded for this output. It is not guessed: there is no budget until it is recorded (datasheet or meter).' });
      continue;
    }
    const written = part.source ?? splitterRecords.get(step.id)?.lossSource;
    if (written && /settings? default/i.test(written)) {
      lines.push({ ...base, value: `${part.db} dB`, number: part.db, origin: 'default', source: `Copied from the settings when the splitter was added ("${written}"). Replace it with the datasheet value.` });
    } else {
      lines.push({ ...base, value: `${part.db} dB`, number: part.db, origin: 'record', source: `On the splitter record${written ? ` (${written})` : '; where it came from is not written'}.` });
    }
  }

  // Splices: the loss on record, or the setting for the type.
  for (const step of path.steps) {
    if (step.kind !== 'splice' || !step.partLoss) continue;
    const part = step.partLoss;
    const base = { key: `splice:${part.recordId}`, label: `${step.title}`, recordId: part.recordId };
    if (part.origin === 'setting' && part.settingId) {
      const s = settingSource(part.settingId, part.db, overrides);
      lines.push({ ...base, value: `${part.db} dB`, ...(part.db !== undefined ? { number: part.db } : {}), ...s, source: `No loss recorded for this splice. ${s.source}` });
    } else {
      lines.push({ ...base, value: `${part.db} dB`, ...(part.db !== undefined ? { number: part.db } : {}), origin: 'record', source: `On the splice record (${LOSS_ORIGIN_WORDS[part.source ?? ''] ?? part.source ?? 'where it came from is not written'}).` });
    }
  }

  // Connector pairs: counted from the ports on the path; each at the setting.
  lines.push({
    key: 'connectors.count',
    label: 'Connector pairs on the path',
    value: `${path.parts.connectorPairs}`,
    number: path.parts.connectorPairs,
    origin: 'record',
    source: 'Counted from the ports on the recorded path: the PON port, each ODF port, the box output adapter and the ONT. Pigtail splices count only when recorded as splices.',
  });
  lines.push(settingLine('connectors.loss', 'Loss per connector pair', 'optical.connector.pair', settings.connectorPairDb, 'dB', overrides));
  lines.push(settingLine('margin', 'Repair margin', 'optical.margin', settings.marginDb, 'dB', overrides));

  // The customer's reading: only a real one is compared with the estimate.
  if (ctx.customer) {
    const reading = rxReadingOf(ctx.customer, settings);
    lines.push(
      reading.isMeasured
        ? { key: 'reading', label: 'Receive level at the ONT', value: reading.text, ...(reading.valueDbm !== undefined ? { number: reading.valueDbm } : {}), origin: 'record', source: `A real reading${reading.measuredAt ? ` from ${reading.measuredAt}` : ''}, compared with the estimate.` }
        : { key: 'reading', label: 'Receive level at the ONT', value: reading.text, origin: 'not_recorded', source: 'No meter or device reading. Only a real reading is compared with the estimate; this one is not used.' },
    );
  }
  return lines;
}

const VERDICT_RANK: Record<BudgetOutcome, number> = {
  fits_with_margin: 0,
  fits_under_margin: 1,
  too_little_loss: 2,
  over_budget: 3,
  estimated_default_class: 4,
  unknown_splitter: 5,
};

/** One direction written out with the numbers used. */
function directionFormula(d: DirectionBudget, path: CorePathResult, settings: OpticalSettings): string {
  const b = d.budget;
  const splitters = path.parts.splitters.map((s) => `${s.lossDb ?? '?'}`).join(' + ') || '0';
  const splices = path.steps.flatMap((s) => (s.kind === 'splice' && s.partLoss?.db !== undefined ? [`${s.partLoss.db}`] : [])).join(' + ') || '0';
  const parts = [
    `Loss at ${nmText(d)} = fibre ${fmt(b.totalDistanceMeters / 1000, 3)} km × ${b.attenuationRateDbPerKm} dB/km (${fmt(b.fiberLossDb)} dB)`,
    `+ splitters ${splitters} (${fmt(b.splitterLossDb)} dB)`,
    `+ splices ${splices} (${fmt(b.spliceLossDb)} dB)`,
    `+ ${path.parts.connectorPairs} connector pairs × ${settings.connectorPairDb} dB (${fmt(b.connectorLossDb)} dB)`,
    `= ${fmt(b.totalLossDb)} dB.`,
  ];
  let text = parts.join(' ');
  text += ` Room left = ${b.opticsClass}${b.opticsClassRecorded ? '' : ' (assumed)'} highest ${b.classMaxLossDb} dB − ${fmt(b.totalLossDb)} dB = ${fmt(b.remainingDb)} dB; after the ${settings.marginDb} dB repair margin ${fmt(b.afterMarginDb)} dB.`;
  if (b.classMinLossDb !== undefined) text += ` Lowest allowed loss ${b.classMinLossDb} dB.`;
  if (d.direction === 'downstream') {
    if (b.expectedRxDbm !== undefined && b.oltTxPowerDbm !== undefined) {
      text += ` Expected receive = launch ${b.oltTxPowerDbm} dBm (recorded) − ${fmt(b.totalLossDb)} dB = ${b.expectedRxDbm} dBm.`;
    } else if (b.expectedRxRangeDbm) {
      const r = settings.classes[b.opticsClass];
      text += ` Expected receive = class launch ${r?.launchMinDbm} to ${r?.launchMaxDbm} dBm − ${fmt(b.totalLossDb)} dB = ${b.expectedRxRangeDbm.min} to ${b.expectedRxRangeDbm.max} dBm (launch not recorded).`;
    } else {
      text += ' Expected receive: not known (no launch recorded and no launch range in the class settings).';
    }
    if (b.measuredRxDbm !== undefined) {
      text += ` Real reading ${b.measuredRxDbm} dBm${b.discrepancyDb !== undefined ? `, ${b.discrepancyDb > 0 ? '+' : ''}${b.discrepancyDb} dB against expected` : ''}.`;
    }
  }
  return text;
}

function directionOf(d: DirectionBudget, path: CorePathResult, settings: OpticalSettings): BudgetDirection {
  const b = d.budget;
  const outcome: BudgetOutcome =
    b.verdictWithheld === 'unknown_splitter' || b.unknownSplitters.length > 0
      ? 'unknown_splitter'
      : !path.opticsClassRecorded || b.verdictWithheld === 'default_class'
        ? 'estimated_default_class'
        : b.linkVerdict;
  return {
    direction: d.direction,
    wavelengthNm: d.wavelengthNm,
    ...(d.nominalNm ? { nominalNm: d.nominalNm } : {}),
    fiberLossDb: b.fiberLossDb,
    splitterLossDb: b.splitterLossDb,
    spliceLossDb: b.spliceLossDb,
    connectorLossDb: b.connectorLossDb,
    totalLossDb: b.totalLossDb,
    ...(b.classMinLossDb !== undefined ? { classMinLossDb: b.classMinLossDb } : {}),
    classMaxLossDb: b.classMaxLossDb,
    remainingDb: b.remainingDb,
    afterMarginDb: b.afterMarginDb,
    marginDb: settings.marginDb,
    outcome,
    ...(b.expectedRxDbm !== undefined ? { expectedRxDbm: b.expectedRxDbm } : {}),
    ...(b.expectedRxRangeDbm ? { expectedRxRangeDbm: b.expectedRxRangeDbm } : {}),
    ...(b.measuredRxDbm !== undefined ? { measuredRxDbm: b.measuredRxDbm } : {}),
    ...(b.discrepancyDb !== undefined ? { discrepancyDb: b.discrepancyDb } : {}),
    formula: directionFormula(d, path, settings),
  };
}

/** Plain words for the whole budget. */
function outcomeWords(budget: Pick<FibreBudget, 'complete' | 'gaps' | 'outcome' | 'opticsClass'>): string {
  if (!budget.complete || !budget.outcome) return `No budget: the fibre path is not recorded end to end. ${budget.gaps[0] ?? ''}`.trim();
  switch (budget.outcome) {
    case 'estimated_default_class':
      return `Estimated with default class. The port's optics class is not recorded, so ${budget.opticsClass} is only assumed: no pass or fail is given. Record the class on the PON port.`;
    case 'unknown_splitter':
      return 'Splitter loss not known, so the total is too low and no pass or fail is given. Record the splitter loss.';
    default:
      return `${BUDGET_OUTCOME_LABELS[budget.outcome]} (estimated from the records and settings below; a meter reading is the real check).`;
  }
}

/** The budget of one traced fibre path, every input labelled by where it came from. Adds no calculation of its own. */
export function fibrePathBudget(path: CorePathResult, ctx: BudgetContext = {}): FibreBudget {
  const settings = ctx.settings ?? DEFAULT_OPTICAL_SETTINGS;
  const overrides = ctx.overrides ?? [];
  const inputs = budgetInputs(path, ctx, settings, overrides);
  const directions = path.complete ? path.directions.map((d) => directionOf(d, path, settings)) : [];
  const outcome = directions.length ? directions.reduce<BudgetOutcome>((worst, d) => (VERDICT_RANK[d.outcome] > VERDICT_RANK[worst] ? d.outcome : worst), directions[0].outcome) : undefined;
  const budget = {
    targetId: path.targetId,
    complete: path.complete && directions.length > 0,
    gaps: path.gaps,
    opticsClass: path.opticsClass,
    opticsClassRecorded: path.opticsClassRecorded,
    inputs,
    flagged: inputs.filter((l) => l.origin !== 'record'),
    directions,
    outcome,
    formula: BUDGET_FORMULA,
    method: BUDGET_METHOD,
  };
  return { ...budget, outcomeText: outcomeWords(budget) };
}

/* ------------------------------------------------------------------ */
/* Stored runs                                                         */
/* ------------------------------------------------------------------ */

export const budgetRunsOf = (data: Partial<Pick<NetworkData, 'opticalBudgetRuns'>>): OpticalBudgetRun[] => data.opticalBudgetRuns ?? [];

/** The stored runs for one target, newest first. */
export const budgetRunsFor = (data: Partial<Pick<NetworkData, 'opticalBudgetRuns'>>, targetId: string): OpticalBudgetRun[] =>
  budgetRunsOf(data)
    .filter((r) => r.target.id === targetId)
    .sort((a, b) => b.ranAt.localeCompare(a.ranAt));

/** Customer names in a stored sentence replaced by "customer <id>": a run is read by every role. */
function withoutNames(value: string, names: readonly [string, string][]): string {
  let out = value;
  for (const [name, id] of names) out = out.split(name).join(`customer ${id}`);
  return out;
}

export interface BudgetRunDraft {
  path: CorePathResult;
  overrides?: readonly BudgetOverride[];
  note?: string;
}

/**
 * Stores what the budget says now for one complete fibre path, as a new run. Nothing in the network
 * is changed. An incomplete path is not stored: it has no budget.
 */
export function storeBudgetRun(data: NetworkData, draft: BudgetRunDraft, ctx: CommandContext = {}): CommandResult<OpticalBudgetRun> {
  const { path } = draft;
  const customer = data.customers.find((c) => c.id === path.targetId);
  const budget = fibrePathBudget(path, { settings: ctx.optical, overrides: draft.overrides, splitters: data.splitters, customer });
  if (!budget.complete || budget.directions.length === 0) {
    return fail('Not stored', `There is no budget to store: the fibre path is not recorded end to end. ${path.gaps[0] ?? ''}`.trim());
  }
  const names = data.customers
    .filter((c) => c.name && c.name.trim().length >= 2)
    .map((c) => [c.name, c.id] as [string, string])
    .sort((a, b) => b[0].length - a[0].length);
  const clean = (s: string) => withoutNames(s, names);
  const run: OpticalBudgetRun = {
    id: newRecordId('OBR-'),
    ranAt: (ctx.now ?? new Date()).toISOString(),
    ranBy: ctx.actor ?? 'Not recorded',
    target: customer ? { kind: 'customer', id: customer.id, label: `Customer ${customer.id}` } : { kind: 'fiber', id: path.targetId, label: clean(path.targetLabel).slice(0, 200) },
    ...(path.olt ? { oltId: path.olt.id } : {}),
    ...(path.pon ? { ponPortId: path.pon.id } : {}),
    opticsClass: budget.opticsClass,
    opticsClassRecorded: budget.opticsClassRecorded,
    inputs: budget.inputs.map((l) => ({ ...l, label: clean(l.label).slice(0, 200), value: clean(l.value).slice(0, 200), source: clean(l.source).slice(0, 600) })),
    directions: budget.directions.map((d) => ({ ...d, formula: clean(d.formula).slice(0, 2000) })),
    formula: budget.formula,
    method: budget.method,
    ...(draft.note?.trim() ? { note: clean(draft.note.trim()).slice(0, 500) } : {}),
  };
  const parsed = opticalBudgetRunSchema.safeParse(run);
  if (!parsed.success) return fail('Not stored', parsed.error.issues[0]?.message ?? 'The budget run is not complete.');
  const outcome = budget.outcome ? BUDGET_OUTCOME_LABELS[budget.outcome] : 'no budget';
  return succeed(
    parsed.data,
    { opticalBudgetRuns: [...budgetRunsOf(data), parsed.data] },
    {
      notice: notice('success', 'Budget run stored', `${run.target.label}: ${outcome}. Kept as history; nothing on the network was changed.`),
      audit: [{ action: 'BUDGET_RUN_STORED', details: `Optical budget run for ${run.target.label}: ${outcome}`, assetId: run.id, assetType: 'BudgetRun' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* Server checks                                                       */
/* ------------------------------------------------------------------ */

export const changeSetTouchesBudgetRuns = (changes: ChangeSet): boolean =>
  (changes.upserts?.opticalBudgetRuns?.length ?? 0) > 0 || (changes.deletes?.opticalBudgetRuns?.length ?? 0) > 0;

export interface BudgetRunProblem {
  id: string;
  message: string;
}

/**
 * Budget runs a change may not store: a delete (runs are history), a change to a stored run (a run
 * says what the budget said then; run it again instead), or a pass or fail with an assumed class
 * (the schema refuses that one too). `stored` looks up the stored run by id.
 */
export function checkChangeSetBudgetRuns(changes: ChangeSet, stored: (id: string) => OpticalBudgetRun | undefined): BudgetRunProblem[] {
  const problems: BudgetRunProblem[] = [];
  for (const id of changes.deletes?.opticalBudgetRuns ?? []) {
    if (stored(id)) problems.push({ id, message: `Budget run ${id} is kept as history and cannot be deleted.` });
  }
  for (const run of changes.upserts?.opticalBudgetRuns ?? []) {
    const parsed = opticalBudgetRunSchema.safeParse(run);
    if (!parsed.success) {
      problems.push({ id: run.id, message: `Budget run ${run.id}: ${parsed.error.issues[0]?.message ?? 'not a valid run'}.` });
      continue;
    }
    const before = stored(run.id);
    if (before && !sameJson(before, run)) {
      problems.push({ id: run.id, message: `Budget run ${run.id} is already stored and is never changed. Run the budget again to store a new one.` });
    }
    if (!run.opticsClassRecorded && run.directions.some((d) => isBudgetVerdict(d.outcome))) {
      problems.push({ id: run.id, message: `Budget run ${run.id} gives a pass or fail with an assumed optics class.` });
    }
  }
  return problems;
}
