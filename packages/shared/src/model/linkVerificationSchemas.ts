import { z } from 'zod';

/*
 * Network mapping Phase 13: a check of one physical link (a splice, a patch cord, a splitter
 * output, a drop fibre...), as the person who did it recorded it. The link itself stays where it
 * always was (on the closure, the ODF port, the splitter...); a check only names it by its
 * connection id from the connection index (`domain/connectionIndex.ts`). Kept apart from the link
 * on purpose, so no existing field or command changes, and a check is history: a new check never
 * changes an older one.
 */

/** How the link was checked. */
export const LINK_CHECK_METHODS = ['otdr', 'vfl', 'power_reading', 'visual', 'continuity'] as const;
export const linkCheckMethodSchema = z.enum(LINK_CHECK_METHODS);
export type LinkCheckMethod = z.infer<typeof linkCheckMethodSchema>;

export const LINK_CHECK_METHOD_LABELS: Record<LinkCheckMethod, string> = {
  otdr: 'OTDR test',
  vfl: 'Red light (VFL)',
  power_reading: 'Light meter reading',
  visual: 'Looked at it',
  continuity: 'Continuity test',
};

/** What the check found. */
export const LINK_CHECK_RESULTS = ['pass', 'fail', 'inconclusive'] as const;
export const linkCheckResultSchema = z.enum(LINK_CHECK_RESULTS);
export type LinkCheckResult = z.infer<typeof linkCheckResultSchema>;

export const LINK_CHECK_RESULT_LABELS: Record<LinkCheckResult, string> = {
  pass: 'Good: the link works',
  fail: 'Bad: the link does not work',
  inconclusive: 'Could not tell',
};

export const linkVerificationSchema = z.object({
  id: z.string().min(1),
  /** The connection index id of the link checked, such as `splice:CLO-1:SPC-2`. */
  connectionId: z.string().trim().min(1).max(300),
  /** What the link joined when it was checked, in plain words, so the check still says what it was about if the link changes or goes. */
  connectionLabel: z.string().max(400),
  /** The link's two ends when it was checked. A later change to the ends makes this check out of date. */
  endsKey: z.string().max(600).optional(),
  method: linkCheckMethodSchema,
  result: linkCheckResultSchema,
  /** The day of the check, as the person gave it (YYYY-MM-DD). */
  checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-11.'),
  /** Who did the check, as written. */
  technician: z.string().trim().min(1).max(120),
  /** Photo ids stored by `/api/v1/photos/<id>` (meter display, OTDR screen, the link itself). */
  photoIds: z.array(z.string().min(1)).max(20).optional(),
  /** OTDR file name or test reference, as written. */
  otdrRef: z.string().trim().max(120).optional(),
  /** A light meter reading in dBm, exactly as read. Always measured in the field: a calculated value is never a check. */
  readingDbm: z.number().min(-70).max(30).optional(),
  /** The wavelength the reading or test was taken at, as set on the meter. */
  wavelengthNm: z.number().int().min(800).max(1700).optional(),
  /** The meter, OTDR or light source used (make, model or serial), as written. */
  instrument: z.string().trim().max(120).optional(),
  notes: z.string().max(1000).optional(),
  createdAt: z.string(),
  createdBy: z.string().optional(),
});
export type LinkVerification = z.infer<typeof linkVerificationSchema>;
