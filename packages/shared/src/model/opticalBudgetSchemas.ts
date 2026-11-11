import { z } from 'zod';

import { OPTICS_CLASSES } from '../domain/opticalSettings';

/*
 * Network mapping Phase 17: a stored optical budget run. One run is what the budget said for one
 * traced fibre path at one moment: who ran it, when, every input with where it came from, the
 * result per direction and the formula written out. A run is history, never a network record: no
 * trace, count or check reads it, nothing in it changes a record, and it is never changed or
 * deleted once stored (the server refuses both). Customers are named by id only.
 */

/** Where one input of a budget came from. */
export const BUDGET_INPUT_ORIGINS = ['record', 'map', 'setting', 'default', 'not_recorded'] as const;
export const budgetInputOriginSchema = z.enum(BUDGET_INPUT_ORIGINS);
export type BudgetInputOrigin = z.infer<typeof budgetInputOriginSchema>;

/** Plain words for each origin. Only "From the record" is a fact about this network. */
export const BUDGET_INPUT_ORIGIN_LABELS: Record<BudgetInputOrigin, string> = {
  record: 'From the record',
  map: 'Drawn line on the map',
  setting: 'Your setting',
  default: 'Default, not your network',
  not_recorded: 'Not recorded',
};

/** What a budget says for one direction. Only the first four are a pass or fail. */
export const BUDGET_OUTCOMES = [
  'fits_with_margin',
  'fits_under_margin',
  'too_little_loss',
  'over_budget',
  'estimated_default_class',
  'unknown_splitter',
] as const;
export const budgetOutcomeSchema = z.enum(BUDGET_OUTCOMES);
export type BudgetOutcome = z.infer<typeof budgetOutcomeSchema>;

export const BUDGET_OUTCOME_LABELS: Record<BudgetOutcome, string> = {
  fits_with_margin: 'Fits with margin',
  fits_under_margin: 'Fits, but under the repair margin',
  too_little_loss: 'Too little loss (too much light)',
  over_budget: 'Over budget',
  estimated_default_class: 'Estimated with default class',
  unknown_splitter: 'Splitter loss not known',
};

/** The outcomes that are a pass or fail against a recorded class. */
export const isBudgetVerdict = (o: BudgetOutcome): boolean => o !== 'estimated_default_class' && o !== 'unknown_splitter';

const text = (max: number) => z.string().max(max);

export const budgetInputLineSchema = z.object({
  /** Stable key, such as `opticsClass`, `fiber.1310`, `length:CBL-1`, `splice:S1`. */
  key: text(160),
  label: text(200),
  /** The value as shown, with its unit ("0.35 dB/km", "GPON B+", "Not recorded"). */
  value: text(200),
  number: z.number().finite().optional(),
  origin: budgetInputOriginSchema,
  /** Where it came from in words: the record, the setting id and its source note, or what is missing. */
  source: text(600),
  settingId: text(120).optional(),
  recordId: text(160).optional(),
});
export type BudgetInputLine = z.infer<typeof budgetInputLineSchema>;

const db = z.number().finite();

export const budgetDirectionSchema = z.object({
  direction: z.enum(['downstream', 'upstream']),
  /** The settings wavelength used. */
  wavelengthNm: z.number().int().positive(),
  /** The wavelength the path really uses, when the settings hold no value for it. */
  nominalNm: z.number().int().positive().optional(),
  fiberLossDb: db,
  splitterLossDb: db,
  spliceLossDb: db,
  connectorLossDb: db,
  totalLossDb: db,
  classMinLossDb: db.optional(),
  classMaxLossDb: db,
  remainingDb: db,
  afterMarginDb: db,
  marginDb: db,
  outcome: budgetOutcomeSchema,
  /** Only with the port's recorded launch power. */
  expectedRxDbm: db.optional(),
  /** From the class launch range when the launch is not recorded. */
  expectedRxRangeDbm: z.object({ min: db, max: db }).optional(),
  /** Only a real meter or device reading. */
  measuredRxDbm: db.optional(),
  discrepancyDb: db.optional(),
  /** This direction's sum, written out with the numbers used. */
  formula: text(2000),
});
export type BudgetDirection = z.infer<typeof budgetDirectionSchema>;

export const opticalBudgetRunSchema = z
  .object({
    id: z.string().min(1).max(80),
    ranAt: z.string().min(1),
    ranBy: text(120),
    /** What was traced. A customer by id only, never by name. */
    target: z.object({ kind: z.enum(['customer', 'fiber']), id: text(160), label: text(200) }),
    oltId: text(80).optional(),
    ponPortId: text(80).optional(),
    opticsClass: z.enum(OPTICS_CLASSES),
    opticsClassRecorded: z.boolean(),
    inputs: z.array(budgetInputLineSchema).max(400),
    directions: z.array(budgetDirectionSchema).min(1).max(2),
    /** The general formula, in words. */
    formula: text(2000),
    /** Which code did the sum, so a later reader can tell runs of different versions apart. */
    method: text(200),
    note: z.string().trim().max(500).optional(),
  })
  .refine((r) => r.opticsClassRecorded || r.directions.every((d) => !isBudgetVerdict(d.outcome)), {
    message: 'A run with an assumed optics class cannot carry a pass or fail. Use "Estimated with default class".',
    path: ['directions'],
  });
export type OpticalBudgetRun = z.infer<typeof opticalBudgetRunSchema>;
