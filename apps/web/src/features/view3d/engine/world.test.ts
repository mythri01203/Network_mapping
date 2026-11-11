import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createDemoNetwork } from '../scene/demoNetwork';
import { toScene3D } from '../scene/toScene3D';
import type { Scene3D } from '../scene/types';
import { buildWorld, PRESET_KEYS } from './world';

const NOW = new Date('2026-11-11T10:00:00Z');
const demoScene = () =>
  toScene3D(createDemoNetwork(NOW), { origin: { lat: 12.9716, lng: 77.5946 }, now: NOW, isDemo: true });

/** A scene with many customers around one box, to check that houses stay instanced. */
function bigScene(n: number): Scene3D {
  const base = demoScene();
  const houses = Array.from({ length: n }, (_, i) => ({
    ...base.houses[0],
    id: `H-${i}`,
    customerIds: [`C-${i}`],
    number: i + 1,
    position: { x: (i % 40) * 9, z: Math.floor(i / 40) * 9 },
    fault: i % 97 === 0,
  }));
  const customers = houses.map((h, i) => ({
    ...base.customers[0],
    customerId: `C-${i}`,
    number: i + 1,
    houseId: h.id,
  }));
  const cables = houses.map((h, i) => ({
    id: `D-${i}`,
    name: `drop ${i}`,
    role: 'drop' as const,
    ponKeys: [],
    aerial: true,
    points: [{ x: h.position.x + 5, z: h.position.z }, h.position],
    schematic: false,
    colorHex: '#0284c7',
    customerId: `C-${i}`,
  }));
  return {
    ...base,
    houses,
    customers,
    cables: [...base.cables.filter((c) => c.role !== 'drop'), ...cables],
    extent: 200,
  };
}

describe('buildWorld (smoke, no WebGL)', () => {
  it('renders the demo network: rack, poles, boxes, fibers and 100 houses', () => {
    const world = buildWorld(demoScene(), { labels: true, dark: true });
    expect(world.counts).toMatchObject({ racks: 1, poles: 20, boxes: 18, houses: 100 });
    expect(world.counts.fibers).toBeGreaterThanOrEqual(1 + 4 + 13 + 100 + 1);
    // Hundreds of static parts are merged by material into far fewer draw calls.
    expect(world.counts.staticMeshesMerged).toBeGreaterThan(500);
    expect(world.counts.meshes).toBeLessThan(world.counts.staticMeshesMerged / 3);
    for (const key of PRESET_KEYS) expect(world.presets[key], key).not.toBeNull();
    // Every equipment record can be focused.
    for (const id of ['DEMO-OLT-1', 'DEMO-SW-1', 'DEMO-FDT-1', 'DEMO-FAT-13', 'P-F1'])
      expect(world.focus.has(id), id).toBe(true);
    world.rebuildGallery(null, null, true);
    expect(world.gallery.children.length).toBeGreaterThan(0);
    world.dispose();
    expect(world.root.children.length).toBe(0);
  });

  it('keeps 1000 houses at a fixed number of draw calls', () => {
    const world = buildWorld(bigScene(1000), { labels: false, dark: false });
    const houses = world.houses!;
    expect(houses.walls).toBeInstanceOf(THREE.InstancedMesh);
    expect(houses.walls.count).toBe(1000);
    const instanced = houses.group.children.filter((c) => c instanceof THREE.InstancedMesh);
    // walls, roof, door, window, ONT, LED, base, step, frames (4), side window and the fault markers.
    expect(instanced.length).toBe(14);
    // All fibers are two merged meshes (drops, everything else) plus two instanced pulse meshes.
    const fiberMeshes = world.fibers.group.children.filter(
      (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh),
    );
    expect(fiberMeshes.map((c) => c.name).sort()).toEqual(['drops', 'lines']);
    const drops = world.fibers.group.children.filter((c) => c.name === 'drops');
    expect(drops).toHaveLength(1);
    world.dispose();
  });

  it('dims everything but one customer drop when a house is picked', () => {
    const scene = demoScene();
    const world = buildWorld(scene, { labels: false, dark: true });
    const target = scene.customers[36];
    world.fibers.apply({ kind: 'all' }, target.customerId);
    const drops = world.fibers.group.children.find((c) => c.name === 'drops') as THREE.Mesh;
    const colors = (drops.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    const max = Math.max(...colors);
    expect(max).toBeGreaterThan(0.2);
    world.dispose();
  });
});
