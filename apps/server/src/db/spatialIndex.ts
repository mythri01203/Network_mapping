import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { CollectionName } from '@fibergis/shared';

import { type Bounds, boundsOfShapes, type Box, type LatLngPair, ownPoint, shapesOf } from './recordGeometry';

/**
 * Phase 24 (migration 3): the map position of each stored record that has one, so a map-area query
 * reads only the records near the box instead of the whole network. `record_bounds` names the
 * record; `record_bounds_rtree` (an SQLite R-tree) holds its smallest enclosing box. Both are kept in
 * the same transaction as every write, delete, restore and reset, and are rebuilt from `records`
 * whenever the migration runs. They hold nothing that is not in `records`, so they are never backed up.
 */
export const SPATIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS record_bounds (
    rid INTEGER PRIMARY KEY,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    UNIQUE (collection, id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS record_bounds_rtree USING rtree(rid, min_lat, max_lat, min_lng, max_lng);
`;

type Row = Record<string, unknown>;

/** One candidate from the index: the R-tree box is rounded outwards, so the exact test is done after. */
export interface AreaCandidate {
  collection: CollectionName;
  id: string;
  position: number;
  version: number;
  data: string;
}

export class SpatialIndex {
  private readonly q: Record<string, StatementSync>;

  constructor(private readonly db: DatabaseSync) {
    this.q = {
      rid: db.prepare('SELECT rid FROM record_bounds WHERE collection = ? AND id = ?'),
      insert: db.prepare('INSERT INTO record_bounds (collection, id) VALUES (?, ?) RETURNING rid'),
      put: db.prepare('INSERT OR REPLACE INTO record_bounds_rtree (rid, min_lat, max_lat, min_lng, max_lng) VALUES (?, ?, ?, ?, ?)'),
      removeBox: db.prepare('DELETE FROM record_bounds_rtree WHERE rid = ?'),
      removeName: db.prepare('DELETE FROM record_bounds WHERE rid = ?'),
      clearBoxes: db.prepare('DELETE FROM record_bounds_rtree WHERE rid IN (SELECT rid FROM record_bounds WHERE collection = ?)'),
      clearNames: db.prepare('DELETE FROM record_bounds WHERE collection = ?'),
      point: db.prepare("SELECT data FROM records WHERE collection = 'equipment' AND id = ?"),
      spansNaming: db.prepare("SELECT id, data FROM records WHERE collection = 'spans' AND instr(data, ?) > 0"),
      allSpans: db.prepare("SELECT id, data FROM records WHERE collection = 'spans'"),
      area: db.prepare(
        `SELECT b.collection AS collection, b.id AS id, r.position AS position, r.version AS version, r.data AS data
           FROM record_bounds_rtree t
           JOIN record_bounds b ON b.rid = t.rid
           JOIN records r ON r.collection = b.collection AND r.id = b.id
          WHERE t.max_lat >= ? AND t.min_lat <= ? AND t.max_lng >= ? AND t.min_lng <= ?
          ORDER BY b.collection, r.position`,
      ),
    };
  }

  /** A structure's position, for a span's ends. */
  readonly pointOf = (id: string): LatLngPair | undefined => {
    const row = this.q.point.get(id) as Row | undefined;
    return row ? ownPoint(JSON.parse(String(row.data)) as Record<string, unknown>) : undefined;
  };

  /** Stores (or clears) the box of one record, from its stored data (`undefined`: deleted). */
  update(collection: CollectionName, id: string, record: Record<string, unknown> | undefined) {
    const bounds = record ? boundsOfShapes(shapesOf(collection, record, this.pointOf)) : null;
    this.put(collection, id, bounds);
  }

  private put(collection: CollectionName, id: string, bounds: Bounds | null) {
    const existing = this.q.rid.get(collection, id) as Row | undefined;
    if (!bounds) {
      if (existing) {
        this.q.removeBox.run(existing.rid as number);
        this.q.removeName.run(existing.rid as number);
      }
      return;
    }
    const rid = existing ? Number(existing.rid) : Number((this.q.insert.get(collection, id) as Row).rid);
    this.q.put.run(rid, bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng);
  }

  /** A structure moved or went: the spans that end at it are redrawn. */
  refreshSpansAt(structureIds: Iterable<string>) {
    for (const structureId of structureIds) {
      for (const row of this.q.spansNaming.all(JSON.stringify(structureId)) as Row[]) {
        const span = JSON.parse(String(row.data)) as Record<string, unknown>;
        if (span.fromStructureId === structureId || span.toStructureId === structureId) this.update('spans', String(row.id), span);
      }
    }
  }

  refreshAllSpans() {
    for (const row of this.q.allSpans.all() as Row[]) this.update('spans', String(row.id), JSON.parse(String(row.data)) as Record<string, unknown>);
  }

  clearCollection(collection: CollectionName) {
    this.q.clearBoxes.run(collection);
    this.q.clearNames.run(collection);
  }

  /** Rebuilds the whole index from `records`. Safe to run any number of times. */
  rebuild() {
    this.db.exec('DELETE FROM record_bounds_rtree; DELETE FROM record_bounds;');
    // Structures first, so spans find their ends.
    for (const row of this.db.prepare("SELECT collection, id, data FROM records ORDER BY collection = 'spans', collection, position").iterate() as Iterable<Row>) {
      this.update(String(row.collection) as CollectionName, String(row.id), JSON.parse(String(row.data)) as Record<string, unknown>);
    }
  }

  /** Records whose box overlaps `box`, by collection and stored order. */
  candidates(box: Box): Iterable<AreaCandidate> {
    const [south, west, north, east] = box;
    return this.q.area.iterate(south, north, west, east) as Iterable<AreaCandidate>;
  }
}
