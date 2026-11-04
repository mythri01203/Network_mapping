import type { NetworkDocument, NetworkZone } from '../model/types';
import {
  type CommandContext,
  type CommandResult,
  fail,
  networkAnchor,
  type NetworkData,
  notice,
  sameId,
  succeed,
} from './command';
import { nextSequentialId } from './ids';
import { isoDate } from './time';

export type ZoneDraft = Partial<NetworkZone> & { name: string; areaCode: string };
export type DocumentDraft = Partial<NetworkDocument> & { title: string; category: NetworkDocument['category'] };

/** Half-width, in degrees, of the placeholder square drawn for a zone created without a boundary. */
const DEFAULT_ZONE_HALF_SIZE = 0.0035;

export function createZone(data: NetworkData, draft: ZoneDraft, ctx: CommandContext = {}): CommandResult<NetworkZone> {
  const name = draft.name.trim();
  const areaCode = draft.areaCode.trim();
  if (!name || !areaCode) return fail('Missing Zone Details', 'A zone needs a name and an area code.');

  const id =
    draft.id ||
    nextSequentialId(
      'ZONE-',
      data.zones.map((z) => z.id),
    );
  if (data.zones.some((z) => sameId(z.id, id))) return fail('Duplicate Zone ID', `Zone ${id} already exists.`);

  const [lat, lng] = networkAnchor(data, ctx.fallbackLocation) ?? [0, 0];
  const d = DEFAULT_ZONE_HALF_SIZE;
  const zone: NetworkZone = {
    id,
    name,
    areaCode,
    coverageSqKm: draft.coverageSqKm ?? 2.5,
    homePassed: draft.homePassed ?? 0,
    connectedCustomers: draft.connectedCustomers ?? 0,
    feederCableCount: draft.feederCableCount ?? 0,
    fatCount: draft.fatCount ?? 0,
    penetrationRatePct: draft.penetrationRatePct ?? 0,
    status: draft.status || 'Expansion',
    boundaryCoords:
      draft.boundaryCoords && draft.boundaryCoords.length >= 3
        ? draft.boundaryCoords
        : [
            [lat - d, lng - d],
            [lat + d, lng - d],
            [lat + d, lng + d],
            [lat - d, lng + d],
          ],
  };
  return succeed(
    zone,
    { zones: [...data.zones, zone] },
    {
      notice: notice('success', 'Network Zone Added', `Created zone ${zone.name} (${zone.areaCode})`),
      audit: [
        {
          action: 'ZONE_CREATED',
          details: `Created zone ${zone.name} (${zone.areaCode})`,
          assetId: zone.id,
          assetType: 'Zone',
        },
      ],
    },
  );
}

export function updateZone(data: NetworkData, zone: NetworkZone): CommandResult<NetworkZone> {
  if (!data.zones.some((z) => z.id === zone.id)) return fail('Zone Missing', `Zone ${zone.id} was not found.`);
  return succeed(
    zone,
    { zones: data.zones.map((z) => (z.id === zone.id ? zone : z)) },
    {
      notice: notice('success', 'Zone Updated', `Saved changes for zone ${zone.name}`),
      audit: [{ action: 'ZONE_UPDATED', details: `Updated zone ${zone.name}`, assetId: zone.id, assetType: 'Zone' }],
    },
  );
}

export function deleteZone(data: NetworkData, id: string): CommandResult<NetworkZone> {
  const zone = data.zones.find((z) => z.id === id);
  if (!zone) return fail('Zone Missing', `Zone ${id} was not found.`);
  return succeed(
    zone,
    { zones: data.zones.filter((z) => z.id !== id) },
    {
      notice: notice('info', 'Zone Removed', `Deleted zone ${zone.name}`),
      audit: [{ action: 'ZONE_DELETED', details: `Deleted zone ${zone.name}`, assetId: id, assetType: 'Zone' }],
    },
  );
}

export function createDocument(
  data: NetworkData,
  draft: DocumentDraft,
  ctx: CommandContext = {},
): CommandResult<NetworkDocument> {
  const title = draft.title.trim();
  if (!title) return fail('Missing Title', 'A document needs a title.');
  const id =
    draft.id ||
    nextSequentialId(
      'DOC-',
      data.documents.map((d) => d.id),
      3,
    );
  if (data.documents.some((d) => sameId(d.id, id)))
    return fail('Duplicate Document ID', `Document ${id} already exists.`);

  const doc: NetworkDocument = {
    id,
    title,
    category: draft.category,
    equipmentId: draft.equipmentId,
    cableId: draft.cableId,
    uploadedBy: draft.uploadedBy || ctx.actor || 'Field User',
    uploadDate: isoDate(ctx.now),
    fileSizeKb: draft.fileSizeKb ?? 0,
    url: draft.url || '#',
  };
  return succeed(
    doc,
    { documents: [doc, ...data.documents] },
    {
      notice: notice('success', 'Document Uploaded', `Added ${doc.title} to repository`),
      audit: [
        {
          action: 'DOCUMENT_ADDED',
          details: `Added ${doc.category} "${doc.title}"`,
          assetId: doc.id,
          assetType: 'Document',
        },
      ],
    },
  );
}

export function deleteDocument(data: NetworkData, id: string): CommandResult<NetworkDocument> {
  const doc = data.documents.find((d) => d.id === id);
  if (!doc) return fail('Document Missing', `Document ${id} was not found.`);
  return succeed(
    doc,
    { documents: data.documents.filter((d) => d.id !== id) },
    {
      notice: notice('info', 'Document Deleted', `Removed "${doc.title}" from repository`),
      audit: [{ action: 'DOCUMENT_DELETED', details: `Deleted "${doc.title}"`, assetId: id, assetType: 'Document' }],
    },
  );
}
