import type { CableType, EquipmentType } from '../model/enums';
import type { FiberCore } from '../model/types';

const PASSIVE_INFRASTRUCTURE = new Set<string>([
  'Manhole',
  'Handhole',
  'Underground Chamber',
  'Duct',
  'Microduct',
  'Cable Tray',
  'Junction Point',
  'Building Entry Point',
  'Fiber Slack Loop',
]);

const SUBSCRIBER_DEVICES = new Set<string>(['ONT', 'ONU', 'Optical Modem', 'Customer Terminal']);

/** Physical port count a newly placed piece of equipment starts with. */
export function defaultPortCount(type: EquipmentType): number {
  if (type === 'FAT' || type.includes('Terminal Box')) return 8;
  if (type === 'FDT') return 48;
  if (type === 'FDMS' || type === 'Fiber Distribution Cabinet') return 96;
  if (type === 'ODF' || type === 'Fiber Patch Panel') return 48;
  if (type === 'OLT') return 16;
  if (type === 'MikroTik Router') return 16;
  if (type === 'Outdoor Splitter') return 8;
  if (type === 'Ratio Coupler' || type === 'Optical Attenuator' || type === 'Optical Instrument') return 2;
  if (type === 'Fiber Splice Joint') return 12;
  if (type === 'Fiber Connector') return 1;
  if (SUBSCRIBER_DEVICES.has(type)) return 1;
  if (type.includes('Pole') || PASSIVE_INFRASTRUCTURE.has(type)) return 0;
  return 24;
}

/** Core count a newly drawn cable starts with. */
export function defaultFiberCount(type: CableType): number {
  if (type === 'Main Feeder Fiber') return 48;
  if (type === 'Distribution Fiber') return 24;
  if (type === 'Drop Fiber') return 2;
  if (type === 'Coaxial Cable') return 1;
  return 12;
}

/**
 * A fresh, fully available core inventory. No tube or colour is stored: they come from the cable's
 * recorded layout and scheme (`coreIdentity`), never from an assumed TIA-598 with 12 per tube.
 */
export function buildCores(count: number): FiberCore[] {
  return Array.from({ length: count }, (_, i) => ({ coreNumber: i + 1, status: 'Available' as const }));
}

export const isLatLngPair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number' && Number.isFinite(v));

export const isValidCoordinate = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** A customer with no recorded position is stored at 0, 0 ("unmapped"), never at a made-up place. */
export const hasRecordedLocation = (point: { lat: number; lng: number }): boolean =>
  Number.isFinite(point.lat) && Number.isFinite(point.lng) && !(point.lat === 0 && point.lng === 0);
