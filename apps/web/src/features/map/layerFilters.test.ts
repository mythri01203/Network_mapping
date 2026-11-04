import { describe, expect, it } from 'vitest';

import type { Cable, Equipment } from '@fibergis/shared';
import { SAMPLE_CABLES, SAMPLE_EQUIPMENT } from '@fibergis/shared/sample';

import { DEFAULT_LAYERS } from '../../stores/mapStore';
import { cableLayerKey, findSnapTarget, isCableVisible, isEquipmentVisible, oltFamily } from './layerFilters';

const equipmentOfType = (type: Equipment['type']): Equipment => {
  const found = SAMPLE_EQUIPMENT.find((eq) => eq.type === type);
  if (!found) throw new Error(`sample data has no ${type}`);
  return found;
};

const cableOfType = (type: Cable['type']): Cable => {
  const found = SAMPLE_CABLES.find((cable) => cable.type === type);
  if (!found) throw new Error(`sample data has no ${type}`);
  return found;
};

const visibility = { networkMode: 'All' as const, layers: { ...DEFAULT_LAYERS }, oltFilter: 'All' as const };

describe('isEquipmentVisible', () => {
  it('shows everything with default layers', () => {
    expect(SAMPLE_EQUIPMENT.every((eq) => isEquipmentVisible(eq, visibility))).toBe(true);
  });

  it('hides equipment whose layer is switched off', () => {
    const splitter = { ...equipmentOfType('FAT'), id: 'spl', type: 'Fiber Splitter' as const };
    expect(isEquipmentVisible(splitter, { ...visibility, layers: { ...DEFAULT_LAYERS, splitters: false } })).toBe(
      false,
    );
    const odf = equipmentOfType('ODF');
    expect(isEquipmentVisible(odf, { ...visibility, layers: { ...DEFAULT_LAYERS, odf: false } })).toBe(false);
  });

  it('filters OLTs by PON family', () => {
    const olt = { ...equipmentOfType('OLT'), technology: 'EPON' as const };
    expect(isEquipmentVisible(olt, { ...visibility, oltFilter: 'GPON' })).toBe(false);
    expect(isEquipmentVisible(olt, { ...visibility, oltFilter: 'EPON' })).toBe(true);
    expect(oltFamily({ technology: '10G-EPON' })).toBe('EPON');
    expect(oltFamily({ technology: 'XGS-PON' })).toBe('GPON');
    expect(oltFamily({})).toBe('GPON');
  });

  it('hides cable TV plant in fiber mode and non-OLT central office gear in cable TV mode', () => {
    const olt = equipmentOfType('OLT');
    const catv = equipmentOfType('CATV Optical Node');
    const rack = { ...olt, id: 'rack', type: 'ODF' as const };
    expect(isEquipmentVisible(catv, { ...visibility, networkMode: 'Fiber' })).toBe(false);
    expect(isEquipmentVisible(rack, { ...visibility, networkMode: 'CableTV' })).toBe(false);
    expect(isEquipmentVisible(olt, { ...visibility, networkMode: 'CableTV' })).toBe(true);
  });
});

describe('isCableVisible', () => {
  it('maps cable types to their layer toggles', () => {
    expect(cableLayerKey('Main Feeder Fiber')).toBe('feederCable');
    expect(cableLayerKey('Coaxial Cable')).toBe('coaxialCable');
    expect(cableLayerKey('Custom Cable')).toBeNull();
  });

  it('respects layer toggles and network mode', () => {
    const feeder = cableOfType('Main Feeder Fiber');
    expect(isCableVisible(feeder, visibility)).toBe(true);
    expect(isCableVisible(feeder, { ...visibility, layers: { ...DEFAULT_LAYERS, feederCable: false } })).toBe(false);
    expect(isCableVisible(feeder, { ...visibility, networkMode: 'CableTV' })).toBe(false);
    expect(isCableVisible({ ...feeder, cableCategory: 'Coaxial' }, { ...visibility, networkMode: 'Fiber' })).toBe(
      false,
    );
  });
});

describe('findSnapTarget', () => {
  const nodes = [
    { id: 'a', name: 'A', lat: 12.9, lng: 77.6 },
    { id: 'b', name: 'B', lat: 12.9001, lng: 77.6 },
  ];

  it('returns the nearest node inside the radius', () => {
    const target = findSnapTarget(nodes, 12.90008, 77.6);
    expect(target?.id).toBe('b');
    expect(target?.distanceMeters).toBeCloseTo(2.22, 1);
  });

  it('returns null when nothing is close enough', () => {
    expect(findSnapTarget(nodes, 12.91, 77.6)).toBeNull();
    expect(findSnapTarget(nodes, 12.9, 77.6, 0)?.id).toBe('a');
  });
});
