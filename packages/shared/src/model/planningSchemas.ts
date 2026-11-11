import { z } from 'zod';

import { splitterRatioSchema } from './enums';

/*
 * Network mapping Phase 18: an expansion scenario. A planner writes down additions that are only
 * ideas ("40 more customers on this box", "a new 1:8 splitter fed from output 3", "a 24-fibre cable
 * in this duct") and sees the capacity "if built". A scenario is kept in its own collection and is
 * never a network record: no count, trace, report or map layer of the built network reads it. The
 * production records it names are named by id only; nothing in them is changed.
 */

export const SCENARIO_STATUSES = ['open', 'closed'] as const;
export const scenarioStatusSchema = z.enum(SCENARIO_STATUSES);
export type ScenarioStatus = z.infer<typeof scenarioStatusSchema>;

export const SCENARIO_STATUS_LABELS: Record<ScenarioStatus, string> = {
  open: 'Being worked on',
  closed: 'Closed (kept for reference)',
};

const ref = z.string().trim().min(1).max(80);
const note = z.string().trim().max(500).optional();

/** N more customers, put on one splitter (recorded, or one planned in this scenario), one box, or one PON port. */
export const scenarioCustomersSchema = z
  .object({
    id: ref,
    kind: z.literal('customers'),
    count: z.number().int().positive().max(1024),
    /** A splitter on record, or the id of a planned splitter in the same scenario. */
    splitterId: ref.optional(),
    /** A box (FAT, FDT…) on record: the customers take any free output of the splitters in it. */
    boxId: ref.optional(),
    /** A PON port on record: only the ONT count of the port is looked at. */
    oltId: ref.optional(),
    ponPortId: ref.optional(),
    note,
  })
  .refine((c) => [c.splitterId, c.boxId, c.oltId && c.ponPortId].filter(Boolean).length === 1, {
    message: 'Name one place for the customers: a splitter, a box, or an OLT and PON port.',
    path: ['splitterId'],
  });

/** What a planned splitter would hang on. `not_decided` is allowed and said so. */
export const scenarioSplitterFeedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('splitter'), splitterId: ref, output: z.number().int().positive().max(64).optional() }),
  z.object({ kind: z.literal('pon'), oltId: ref, ponPortId: ref }),
  z.object({ kind: z.literal('not_decided') }),
]);

/** A new splitter that would be put in a box on record. */
export const scenarioSplitterSchema = z.object({
  id: ref,
  kind: z.literal('splitter'),
  name: z.string().trim().max(80).optional(),
  ratio: splitterRatioSchema,
  boxId: ref,
  feed: scenarioSplitterFeedSchema,
  note,
});

/** A new cable that would be pulled through a duct on record (or not decided yet). */
export const scenarioCableSchema = z.object({
  id: ref,
  kind: z.literal('cable'),
  name: z.string().trim().max(80).optional(),
  fiberCount: z.number().int().positive().max(1728),
  /** The duct it would go in. */
  ductId: ref.optional(),
  /** Its outside diameter from the maker's sheet, for the duct fill. Absent: fill not known. */
  outerDiameterMm: z.number().positive().max(100).optional(),
  /** Poles it would hang on, for the pole load. */
  poleIds: z.array(ref).max(500).optional(),
  note,
});

export const scenarioItemSchema = z.union([scenarioCustomersSchema, scenarioSplitterSchema, scenarioCableSchema]);
export type ScenarioItem = z.infer<typeof scenarioItemSchema>;
export type ScenarioCustomers = z.infer<typeof scenarioCustomersSchema>;
export type ScenarioSplitter = z.infer<typeof scenarioSplitterSchema>;
export type ScenarioCable = z.infer<typeof scenarioCableSchema>;

export const planningScenarioSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    /** What the planner wants to find out, as written. */
    purpose: z.string().trim().max(500).optional(),
    status: scenarioStatusSchema,
    items: z.array(scenarioItemSchema).max(200),
    createdAt: z.string(),
    createdBy: z.string().max(120).optional(),
    updatedAt: z.string().optional(),
    updatedBy: z.string().max(120).optional(),
  })
  .refine((s) => new Set(s.items.map((i) => i.id)).size === s.items.length, {
    message: 'Two lines of a scenario have the same id.',
    path: ['items'],
  });
export type PlanningScenario = z.infer<typeof planningScenarioSchema>;
