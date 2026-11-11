import { type CollectionName, isCollectionName } from '@fibergis/shared';

import { type Box, parseBox } from '../db/recordGeometry';
import { badRequest } from './errors';

/** Phase 24: reading the query strings of the paging, area and change routes, with plain refusals. */

export function boxParam(text: string | undefined): Box | undefined {
  if (text === undefined) return undefined;
  const box = parseBox(text);
  if (!box) throw badRequest('bbox must be four numbers "south,west,north,east" in degrees, with south <= north and west <= east.');
  return box;
}

export function wholeNumberParam(name: string, text: string | undefined, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number | undefined {
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text.trim()) || Number(text) < min || Number(text) > max) throw badRequest(`${name} must be a whole number from ${min} to ${max}.`);
  return Number(text);
}

export function collectionsParam(text: string | undefined): CollectionName[] | undefined {
  if (text === undefined) return undefined;
  const names = text.split(',').map((n) => n.trim()).filter(Boolean);
  const unknown = names.filter((n) => !isCollectionName(n));
  if (unknown.length > 0) throw badRequest(`Unknown collection "${unknown[0]}".`);
  return names as CollectionName[];
}

export function idsParam(text: string | undefined): string[] | undefined {
  if (text === undefined) return undefined;
  const ids = [...new Set(text.split(',').map((id) => id.trim()).filter(Boolean))];
  if (ids.length > 1000) throw badRequest('ids may name at most 1000 records.');
  return ids;
}
