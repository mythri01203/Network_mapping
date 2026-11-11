import {
  distanceMeters,
  type Equipment,
  type EquipmentDraft,
  type EquipmentType,
  hasPlacedPosition,
  hasRecordedLocation,
  isPoleType,
  type LatLng,
  type LocationMethod,
} from '@fibergis/shared';

import { useMapStore } from '../../stores/mapStore';
import { logAudit } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { placeEquipmentChecked } from '../../stores/ospActions';
import { useUiStore } from '../../stores/uiStore';
import { categoryForType } from './markerIcons';
import { newEquipmentName, nextPoleName } from './sketch/poleNaming';

/**
 * Phase 3: the ways to place an item besides tapping the map. Every one goes through
 * `placeEquipmentChecked`, so "same one?" is asked exactly as for a tap, and each new item gets its
 * own name. Nothing here connects the new item to anything.
 */

/** What is being placed: the kind, and what the catalogue or a copied item gives it. */
export interface PlacementChoice {
  type: EquipmentType;
  template: Partial<Equipment> | null;
}

/** Chambers and entries an item can be put at, besides poles. */
const STRUCTURE_TYPES = new Set(['Manhole', 'Handhole', 'Underground Chamber', 'Building Entry Point', 'Junction Point']);

export const isStructureType = (type: string) => isPoleType(type) || STRUCTURE_TYPES.has(type);

/** The name a new item gets, worked out from what is already on the map: the next pole number, else the next "FAT-08". */
export function nameForNew(type: EquipmentType, template: Partial<Equipment> | null, equipment: readonly Equipment[]): string {
  if (type.includes('Pole')) return nextPoleName(equipment);
  return template?.name || (type === 'Fiber Slack Loop' ? 'Fiber Slack Loop' : newEquipmentName(type, equipment));
}

/** The names a row of `count` new items would get, in order, as shown before the person confirms. */
export function previewNames(choice: PlacementChoice, count: number, equipment: readonly Equipment[]): string[] {
  const names: string[] = [];
  const seen: Pick<Equipment, 'id' | 'name'>[] = [...equipment];
  for (let i = 0; i < count; i += 1) {
    const name = nameForNew(choice.type, choice.template, seen as Equipment[]);
    names.push(name);
    seen.push({ id: name, name });
  }
  return names;
}

/** The draft for one new item, built the same way as a tap on the map. */
export function draftFor(
  choice: PlacementChoice,
  point: LatLng,
  locationMethod: LocationMethod,
  equipment: readonly Equipment[],
  position: Pick<Equipment, 'locationAccuracyMeters'> = {},
): EquipmentDraft {
  const tpl = choice.template;
  const totalPorts = tpl?.totalPorts;
  return {
    type: choice.type,
    category: tpl?.category || categoryForType(choice.type),
    totalPorts,
    availablePorts: totalPorts,
    ...tpl,
    name: nameForNew(choice.type, tpl, equipment),
    lat: point[0],
    lng: point[1],
    locationMethod,
    ...(position.locationAccuracyMeters !== undefined ? { locationAccuracyMeters: position.locationAccuracyMeters } : {}),
  };
}

/** Poles, manholes and chambers with a real position, nearest to `center` first, matching `query`. */
export function structuresNear(
  equipment: readonly Equipment[],
  center: LatLng,
  query = '',
  limit = 30,
): { equipment: Equipment; distanceMeters: number }[] {
  const q = query.trim().toLowerCase();
  return equipment
    .filter((e) => isStructureType(e.type) && hasPlacedPosition(e) && hasRecordedLocation(e))
    .filter((e) => !q || [e.name, e.id, e.poleNumber, e.ownerPoleNumber, e.tagCode, e.street].some((v) => v?.toLowerCase().includes(q)))
    .map((e) => ({ equipment: e, distanceMeters: distanceMeters(center, [e.lat, e.lng]) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

/** Leaves the placing tool and shows what was made, as a tap on the map does. */
function finishPlacing(created: Equipment | null) {
  const map = useMapStore.getState();
  map.resetSketches();
  map.setActiveTool('select');
  map.setEquipmentTypeToAdd(null);
  map.setEquipmentDraftTemplate(null);
  if (!created) return;
  const ui = useUiStore.getState();
  ui.select({ type: 'equipment', data: created });
  // On a phone the inspector would cover the map; a tap on the pin opens it.
  if (typeof window !== 'undefined' && window.innerWidth >= 768) ui.setPanelOpen('right', true);
  map.flyTo(created.lat, created.lng, Math.max(map.viewport.zoom, 18));
  if (created.type === 'OLT') ui.openOltConfigModal(created);
}

/** Places one item at typed coordinates. */
export async function placeAtTyped(choice: PlacementChoice, point: LatLng): Promise<Equipment | null> {
  const created = await placeEquipmentChecked(draftFor(choice, point, 'typed', useNetworkStore.getState().equipment));
  if (created) finishPlacing(created);
  return created;
}

/**
 * Places one item at the position of a pole, manhole or chamber the person picked. The position and
 * how it was found are the structure's; the audit says so. No link to the structure is stored.
 */
export async function placeAtStructure(choice: PlacementChoice, structure: Equipment): Promise<Equipment | null> {
  const draft = draftFor(
    choice,
    [structure.lat, structure.lng],
    structure.locationMethod ?? 'map_pick',
    useNetworkStore.getState().equipment,
    structure,
  );
  const created = await placeEquipmentChecked(draft);
  if (created) {
    logAudit('PLACED_AT_STRUCTURE', `${created.name} (${created.id}) placed at the recorded position of ${structure.name} (${structure.id}), as chosen by the person`, created.id, 'Equipment');
    finishPlacing(created);
  }
  return created;
}

export interface LinePlacementResult {
  created: Equipment[];
  /** Places where the person said an existing item was the same one. */
  sameOne: number;
}

/**
 * Places a row of items, one point at a time and in order, each through "same one?". Each gets its
 * own next name when it is made, so a "same one" answer never leaves a gap in the numbering.
 */
export async function placeAlongLine(choice: PlacementChoice, points: readonly LatLng[], spacingMeters: number, lineLengthMeters: number): Promise<LinePlacementResult> {
  const created: Equipment[] = [];
  let sameOne = 0;
  for (const point of points) {
    const item = await placeEquipmentChecked(draftFor(choice, point, 'map_pick', useNetworkStore.getState().equipment));
    if (item) created.push(item);
    else sameOne += 1;
  }
  if (created.length > 0) {
    logAudit(
      'PLACED_ALONG_LINE',
      `${created.length} ${choice.type} placed every ${spacingMeters} m along a drawn line of ${Math.round(lineLengthMeters)} m (${created[0].name} to ${created[created.length - 1].name}). Positions are from the drawing, not surveyed.`,
      created[0].id,
      'Equipment',
    );
  }
  finishPlacing(created[created.length - 1] ?? null);
  return { created, sameOne };
}
