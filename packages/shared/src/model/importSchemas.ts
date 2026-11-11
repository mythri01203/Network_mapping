import { z } from 'zod';

/*
 * Network mapping Phase 21: one import of a map file (KML, KMZ, GeoJSON, CSV or Shapefile), kept as
 * history. It says who imported what file when, what the person chose (column mapping, what each
 * group is, coordinate system), how many items came in, and exactly which records the import made
 * or changed, each with a fingerprint of the record as the import left it. Undoing an import later
 * ("rollback") removes or restores exactly those records, and only when nothing changed them since
 * and nothing else uses them. The record is never rewritten: only the undo fields are added.
 */

export const IMPORT_FORMATS = ['kml', 'kmz', 'geojson', 'csv', 'shapefile'] as const;
export const importFormatSchema = z.enum(IMPORT_FORMATS);
export type ImportFormat = z.infer<typeof importFormatSchema>;

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  kml: 'KML (Google Earth)',
  kmz: 'KMZ (Google Earth, zipped)',
  geojson: 'GeoJSON',
  csv: 'CSV spreadsheet',
  shapefile: 'Shapefile',
};

/** The collections an import can add to or change. */
export const IMPORTED_COLLECTIONS = ['equipment', 'cables', 'ducts'] as const;
export const importedCollectionSchema = z.enum(IMPORTED_COLLECTIONS);
export type ImportedCollection = z.infer<typeof importedCollectionSchema>;

const ref = z.string().trim().min(1).max(120);

/** One record the import made, with the fingerprint of it as the import left it. */
export const importedRecordRefSchema = z.object({
  collection: importedCollectionSchema,
  id: ref,
  fingerprint: z.string().min(1).max(40),
});
export type ImportedRecordRef = z.infer<typeof importedRecordRefSchema>;

/** One existing record the import changed: the copy from before, and the fingerprint after. */
export const importChangedRecordSchema = importedRecordRefSchema.extend({
  before: z.record(z.string(), z.unknown()),
});
export type ImportChangedRecord = z.infer<typeof importChangedRecordSchema>;

const count = z.number().int().nonnegative();

export const importRecordSchema = z
  .object({
    /** The import id, the same as `importInfo.importId` on every record it made. */
    id: ref,
    fileName: z.string().trim().min(1).max(260),
    format: importFormatSchema,
    importedAt: z.string().min(1),
    importedBy: z.string().trim().min(1).max(120),
    counts: z.object({
      points: count,
      cables: count,
      ducts: count,
      /** Features not imported, each with a reason in the import screen. */
      skipped: count,
      /** Items that looked like one already on the map and were left out. */
      heldBack: count,
      /** Cable or duct ends connected because the person confirmed them. */
      endsConfirmed: count,
    }),
    /** What the person chose, in words: column mapping, group choices, coordinate system. */
    settingsUsed: z.record(z.string().max(120), z.string().max(500)),
    /** Warnings the person accepted, each written out (a logged override). */
    overrides: z.array(z.string().max(500)).max(50),
    created: z.array(importedRecordRefSchema).max(50_000),
    changed: z.array(importChangedRecordSchema).max(5_000),
    rolledBackAt: z.string().min(1).optional(),
    rolledBackBy: z.string().trim().min(1).max(120).optional(),
    rollbackNote: z.string().trim().max(500).optional(),
  })
  .refine((r) => (r.rolledBackAt === undefined) === (r.rolledBackBy === undefined), {
    message: 'An undone import needs who undid it and when.',
    path: ['rolledBackBy'],
  });
export type ImportRecord = z.infer<typeof importRecordSchema>;
