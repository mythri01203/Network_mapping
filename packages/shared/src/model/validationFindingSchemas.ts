import { z } from 'zod';

/*
 * Network mapping Phase 15: a stored finding of the map check (the `fibergis-map-check` rules and
 * the geometry rules). A finding names what was found by a stable key (rule and record ids), so the
 * same problem found again is the same finding. People mark it acknowledged (it is fine as it is:
 * the logged override of a warning) or resolved (fixed), always with who, when and a note. A check
 * that no longer finds it marks it "no longer found"; nothing is ever deleted, and every change is
 * kept in its history. Findings never hold a customer's name or house position: customers are
 * named by id, so a finding can be read by every role.
 */

/** What people have said about the finding. */
export const VALIDATION_FINDING_STATES = ['open', 'acknowledged', 'resolved'] as const;
export const validationFindingStateSchema = z.enum(VALIDATION_FINDING_STATES);
export type ValidationFindingState = z.infer<typeof validationFindingStateSchema>;

export const VALIDATION_FINDING_STATE_LABELS: Record<ValidationFindingState, string> = {
  open: 'Open: needs a look',
  acknowledged: 'Checked: fine as it is',
  resolved: 'Fixed',
};

/** What the last check run said: still found, or not found any more. */
export const VALIDATION_FINDING_PRESENCE = ['found', 'no_longer_found'] as const;
export const validationFindingPresenceSchema = z.enum(VALIDATION_FINDING_PRESENCE);
export type ValidationFindingPresence = z.infer<typeof validationFindingPresenceSchema>;

export const VALIDATION_FINDING_PRESENCE_LABELS: Record<ValidationFindingPresence, string> = {
  found: 'Still found by the last check',
  no_longer_found: 'No longer found by the check',
};

export const VALIDATION_FINDING_EVENTS = ['found', 'found_again', 'not_found', 'acknowledged', 'resolved', 'reopened'] as const;
export type ValidationFindingEvent = (typeof VALIDATION_FINDING_EVENTS)[number];

export const VALIDATION_FINDING_EVENT_LABELS: Record<ValidationFindingEvent, string> = {
  found: 'Found by the check',
  found_again: 'Found again',
  not_found: 'No longer found by the check',
  acknowledged: 'Marked fine as it is',
  resolved: 'Marked fixed',
  reopened: 'Opened again',
};

export const validationFindingHistorySchema = z.object({
  at: z.string(),
  event: z.enum(VALIDATION_FINDING_EVENTS),
  /** Who did it, or "Map check" for the check itself. */
  by: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
});
export type ValidationFindingHistory = z.infer<typeof validationFindingHistorySchema>;

export const validationFindingSchema = z.object({
  id: z.string().min(1),
  /** Rule and record ids. The same problem found again has the same key. */
  key: z.string().trim().min(1).max(400),
  rule: z.string().trim().min(1).max(80),
  severity: z.enum(['error', 'warning', 'note']),
  /** Which rules found it: the map check script, or the geometry rules. */
  source: z.enum(['map_check', 'geometry']),
  /** The kind of record it is about, when known (`equipment`, `cables`, `customers`...). */
  targetCollection: z.string().max(40).optional(),
  targetId: z.string().trim().min(1).max(200),
  relatedIds: z.array(z.string().max(200)).max(20).optional(),
  /** Plain words, as the check put them. Customers by id only. */
  message: z.string().max(800),
  /** What to do about it, in plain words. */
  fix: z.string().max(500),
  /** Where to look on the map. Never stored for a customer: their house position is personal data. */
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  state: validationFindingStateSchema,
  /** Who set the state, when, and why. Required for acknowledged and resolved. */
  stateBy: z.string().max(120).optional(),
  stateAt: z.string().optional(),
  stateNote: z.string().max(1000).optional(),
  presence: validationFindingPresenceSchema,
  /** When the presence last changed (found, found again, or no longer found). */
  presenceAt: z.string(),
  firstFoundAt: z.string(),
  history: z.array(validationFindingHistorySchema).max(1000),
  createdAt: z.string(),
  createdBy: z.string().optional(),
});
export type ValidationFinding = z.infer<typeof validationFindingSchema>;
