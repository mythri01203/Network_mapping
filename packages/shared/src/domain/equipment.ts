import type { EquipmentType } from '../model/enums';
import type { Equipment, EquipmentImage, EquipmentPort, ImageAnnotation } from '../model/types';
import {
  type CommandContext,
  type CommandResult,
  fail,
  type NetworkData,
  notice,
  previewIds,
  sameId,
  succeed,
} from './command';
import { connectionUsesOf } from './connectionRules';
import { defaultPortCount, isValidCoordinate } from './defaults';
import { fiberCascadeForEquipment } from './fiberCommands';
import { polylineLengthMeters } from './geo';
import { equipmentIdPrefix, newRecordId, uniqueId } from './ids';
import { cascadeAudit, ospCascadeForEquipment } from './outsidePlant';
import { generateLogicalPorts, summarizePorts } from './ports';
import { createSplitter } from './provisioning';
import { isoDate } from './time';

export type EquipmentDraft = Partial<Equipment> & { name: string; type: EquipmentType; lat: number; lng: number };

const replaceEquipment = (data: NetworkData, item: Equipment) =>
  data.equipment.map((e) => (e.id === item.id ? item : e));

export function createEquipment(
  data: NetworkData,
  draft: EquipmentDraft,
  ctx: CommandContext = {},
): CommandResult<Equipment> {
  if (!isValidCoordinate(draft.lat, draft.lng)) {
    return fail('Invalid Location', 'Equipment needs a valid latitude (-90..90) and longitude (-180..180).');
  }

  // Phase 9: a random ID, so two people working offline never make the same one. The name is what people see.
  const id = draft.id?.trim() || newRecordId(equipmentIdPrefix(draft.type));
  if (data.equipment.some((e) => sameId(e.id, id))) {
    return fail('Duplicate ID Error', `Equipment with ID "${id}" already exists.`);
  }

  const totalPorts = draft.totalPorts ?? defaultPortCount(draft.type);
  const usedPorts = Math.min(draft.usedPorts ?? 0, totalPorts);
  const base: Equipment = {
    ...draft,
    id,
    category: draft.category || 'Fiber Distribution',
    // Facts nobody has given stay blank; screens show "Not recorded".
    area: draft.area || '',
    street: draft.street || '',
    status: draft.status || 'Active',
    totalPorts,
    usedPorts,
    availablePorts: draft.availablePorts ?? totalPorts - usedPorts,
    images: draft.images || [],
    notes: draft.notes || 'Created via GIS visual mapping toolbar',
    installedDate: draft.installedDate || isoDate(ctx.now),
    logicalPorts: draft.logicalPorts || [],
  };
  const created: Equipment = { ...base, logicalPorts: generateLogicalPorts(base) };
  // A splitter placed with its ratio gets its port records at once: one splitter model, not two.
  const splitterRecord =
    /Splitter/.test(created.type) && created.splitterConfig?.ratio
      ? createSplitter({ ...data, equipment: [...data.equipment, created] }, { terminalBoxId: created.id, ratio: created.splitterConfig.ratio }, ctx)
      : undefined;

  return succeed(
    created,
    {
      equipment: [...data.equipment, created],
      ...(splitterRecord?.ok && splitterRecord.patch.splitters ? { splitters: splitterRecord.patch.splitters } : {}),
    },
    {
      notice: notice('success', 'Equipment Placed', `Successfully mapped ${created.name} (${created.id})`),
      audit: [
        {
          action: 'EQUIPMENT_CREATED',
          details: `Added new ${created.type} ${created.id} at [${created.lat.toFixed(4)}, ${created.lng.toFixed(4)}]`,
          assetId: created.id,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

export function updateEquipment(data: NetworkData, item: Equipment): CommandResult<Equipment> {
  if (!data.equipment.some((e) => e.id === item.id)) {
    return fail('Equipment Missing', `Equipment ${item.id} was not found.`);
  }
  return succeed(
    item,
    { equipment: replaceEquipment(data, item) },
    {
      notice: notice('success', 'Equipment Updated', `Saved modifications for ${item.id}`),
      audit: [
        {
          action: 'EQUIPMENT_UPDATED',
          details: `Updated ${item.type} ${item.id}`,
          assetId: item.id,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

/**
 * Moves equipment and the matching end of every cable connected to it, recalculating each cable's
 * length, as one undoable step. Customers' houses stay where they are.
 */
export function moveEquipment(
  data: NetworkData,
  equipmentId: string,
  lat: number,
  lng: number,
): CommandResult<{ equipment: Equipment; movedCableIds: string[] }> {
  const eq = data.equipment.find((e) => e.id === equipmentId);
  if (!eq) return fail('Equipment Missing', `Equipment ${equipmentId} was not found.`);
  if (!isValidCoordinate(lat, lng)) {
    return fail('Invalid Location', 'Equipment needs a valid latitude (-90..90) and longitude (-180..180).');
  }

  // A field point the office places by hand is no longer waiting for placement.
  const moved: Equipment = {
    ...eq,
    lat,
    lng,
    locationMethod: 'map_pick',
    locationAccuracyMeters: undefined,
    locationSampleCount: undefined,
    officeMustPlace: undefined,
  };
  const movedCableIds: string[] = [];
  const cables = data.cables.map((cable) => {
    const atStart = cable.startEquipmentId === equipmentId;
    const atEnd = cable.endEquipmentId === equipmentId;
    if ((!atStart && !atEnd) || cable.coordinates.length === 0) return cable;
    const coordinates = cable.coordinates.map((point) => [...point] as [number, number]);
    if (atStart) coordinates[0] = [lat, lng];
    if (atEnd) coordinates[coordinates.length - 1] = [lat, lng];
    movedCableIds.push(cable.id);
    return { ...cable, coordinates, lengthMeters: Math.round(polylineLengthMeters(coordinates)) };
  });

  const cableNote = movedCableIds.length > 0 ? ` ${movedCableIds.length} connected cable(s) moved with it.` : '';
  return succeed(
    { equipment: moved, movedCableIds },
    { equipment: replaceEquipment(data, moved), ...(movedCableIds.length > 0 ? { cables } : {}) },
    {
      notice: notice('info', 'Equipment Moved', `Moved ${eq.name}.${cableNote} Press Undo to put it back.`),
      audit: [
        {
          action: 'EQUIPMENT_MOVED',
          details: `Moved ${eq.type} ${eq.id} to [${lat.toFixed(5)}, ${lng.toFixed(5)}]${movedCableIds.length ? `; updated cables ${movedCableIds.join(', ')}` : ''}`,
          assetId: eq.id,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

export function updateEquipmentPort(
  data: NetworkData,
  equipmentId: string,
  portId: string,
  changes: Partial<EquipmentPort>,
): CommandResult<Equipment> {
  const eq = data.equipment.find((e) => e.id === equipmentId);
  if (!eq) return fail('Equipment Missing', `Equipment ${equipmentId} was not found.`);

  const ports = generateLogicalPorts(eq).map((p) => (p.id === portId ? { ...p, ...changes } : p));
  const port = ports.find((p) => p.id === portId);
  if (!port) return fail('Port Missing', `Port ${portId} does not exist on ${equipmentId}.`);

  const summary = summarizePorts(ports);
  const updated: Equipment = {
    ...eq,
    logicalPorts: ports,
    usedPorts: summary.used,
    availablePorts: summary.available,
    totalPorts: summary.total,
  };
  return succeed(
    updated,
    { equipment: replaceEquipment(data, updated) },
    {
      notice: notice('success', 'Port Updated', `${equipmentId} port ${port.portNumber} is now ${port.status}`),
      audit: [
        {
          action: 'PORT_UPDATED',
          details: `${equipmentId} port ${port.portNumber} set to ${port.status}`,
          assetId: equipmentId,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

/** Validates that equipment can be removed. Owned splitters are removed with it; the caller must confirm. */
export function deleteEquipment(data: NetworkData, id: string): CommandResult<Equipment> {
  const target = data.equipment.find((e) => e.id === id);
  if (!target) return fail('Equipment Missing', `Equipment ${id} was not found.`);

  const connectedCables = data.cables.filter((c) => c.startEquipmentId === id || c.endEquipmentId === id);
  if (connectedCables.length > 0) {
    return fail(
      'Cannot Delete Equipment',
      `${id} is connected to ${connectedCables.length} cable(s) (${connectedCables.map((c) => c.id).join(', ')}). Disconnect or delete those cables first.`,
    );
  }
  const dependentCustomers = data.customers.filter((c) => c.terminalBoxId === id || c.oltId === id);
  if (dependentCustomers.length > 0) {
    return fail(
      'Cannot Delete Equipment',
      `${id} serves ${dependentCustomers.length} customer(s) (${previewIds(dependentCustomers.map((c) => c.id))}). Move or disconnect them first.`,
    );
  }

  const connectionUses = connectionUsesOf(data, id);
  if (connectionUses.length > 0) {
    return fail('Cannot Delete Equipment', `${id}: ${connectionUses.join('; ')}. Change those records first.`);
  }

  const ownedSplitters = data.splitters.filter((s) => s.terminalBoxId === id);
  const splitterNote =
    ownedSplitters.length > 0 ? ` Its ${ownedSplitters.length} splitter(s) will also be removed.` : '';
  const osp = ospCascadeForEquipment(data, id);
  const fiber = fiberCascadeForEquipment(data, id);
  return succeed(
    target,
    {
      ...osp.patch,
      ...(fiber.closures ? { closures: fiber.closures } : {}),
      equipment: (fiber.equipment ?? data.equipment).filter((e) => e.id !== id),
      ...(ownedSplitters.length > 0 ? { splitters: data.splitters.filter((s) => s.terminalBoxId !== id) } : {}),
    },
    {
      confirm: `Delete equipment ${id} (${target.name})?${splitterNote}${osp.summary ? ` ${osp.summary}` : ''}${fiber.summary ? ` ${fiber.summary}` : ''} You can undo this with Ctrl+Z.`,
      notice: notice('info', 'Equipment Deleted', `Removed ${target.name} (${id}). Press Ctrl+Z to undo.`),
      audit: [
        cascadeAudit(
          {
            action: 'EQUIPMENT_DELETED',
            details: `Deleted ${target.type} ${id}${ownedSplitters.length ? ` and splitters ${ownedSplitters.map((s) => s.id).join(', ')}` : ''}`,
            assetId: id,
            assetType: 'Equipment',
          },
          osp,
        ),
      ],
    },
  );
}

export function addEquipmentPhoto(
  data: NetworkData,
  equipmentId: string,
  photo: Partial<EquipmentImage>,
  ctx: CommandContext = {},
): CommandResult<EquipmentImage> {
  const eq = data.equipment.find((e) => e.id === equipmentId);
  if (!eq) return fail('Upload Failed', `Equipment ${equipmentId} was not found.`);
  if (!photo.url) return fail('Upload Failed', 'No image data was provided.');

  const image: EquipmentImage = {
    id: photo.id || uniqueId('IMG'),
    equipmentId,
    url: photo.url,
    name: photo.name || 'Field Photo',
    category: photo.category || 'Internal Trays',
    uploadDate: isoDate(ctx.now),
    uploadedBy: photo.uploadedBy || ctx.actor || 'Field User',
    description: photo.description || 'Uploaded field verification photograph',
    annotations: photo.annotations || [],
  };
  return succeed(
    image,
    { equipment: replaceEquipment(data, { ...eq, images: [...eq.images, image] }) },
    {
      notice: notice('success', 'Photograph Uploaded', `Added ${image.name} to ${equipmentId}`),
      audit: [
        {
          action: 'PHOTO_UPLOADED',
          details: `Added photo "${image.name}" (${image.category}) to ${equipmentId}`,
          assetId: equipmentId,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

const editImage = (
  data: NetworkData,
  equipmentId: string,
  imageId: string,
  edit: (image: EquipmentImage) => EquipmentImage,
): NetworkData['equipment'] | undefined => {
  const eq = data.equipment.find((e) => e.id === equipmentId);
  if (!eq || !eq.images.some((img) => img.id === imageId)) return undefined;
  return replaceEquipment(data, { ...eq, images: eq.images.map((img) => (img.id === imageId ? edit(img) : img)) });
};

/** Adds or replaces an annotation; the original photo is never modified. */
export function saveImageAnnotation(
  data: NetworkData,
  equipmentId: string,
  imageId: string,
  annotation: ImageAnnotation,
): CommandResult<ImageAnnotation> {
  const equipment = editImage(data, equipmentId, imageId, (img) => ({
    ...img,
    annotations: img.annotations.some((a) => a.id === annotation.id)
      ? img.annotations.map((a) => (a.id === annotation.id ? annotation : a))
      : [...img.annotations, annotation],
  }));
  if (!equipment) return fail('Photo Missing', `Photo ${imageId} was not found on ${equipmentId}.`);
  return succeed(
    annotation,
    { equipment },
    { notice: notice('success', 'Annotation Saved', `Marked ${annotation.label} on image`) },
  );
}

export function deleteImageAnnotation(
  data: NetworkData,
  equipmentId: string,
  imageId: string,
  annotationId: string,
): CommandResult<void> {
  const equipment = editImage(data, equipmentId, imageId, (img) => ({
    ...img,
    annotations: img.annotations.filter((a) => a.id !== annotationId),
  }));
  if (!equipment) return fail('Photo Missing', `Photo ${imageId} was not found on ${equipmentId}.`);
  return succeed(
    undefined,
    { equipment },
    { notice: notice('info', 'Annotation Removed', 'Deleted port mark from photograph') },
  );
}
