import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { type Kit, type PickInfo } from './kit';

/**
 * Static batching. Racks, poles, boxes and their parts are hundreds of small meshes each; drawn
 * one by one, a 1000-house network is tens of thousands of draw calls (twice, with shadows). This
 * merges every static mesh that shares a material into one mesh, so the count is the number of
 * distinct materials. Clicks keep working through invisible pick boxes, one per picked object.
 *
 * Left alone: anything under `keep` (fibers, houses, labels, gallery: they change at run time)
 * and anything under a spinner (the OLT fans turn).
 */
export function batchStatic(
  kit: Kit,
  root: THREE.Object3D,
  keep: readonly THREE.Object3D[],
): { proxies: THREE.Group; before: number; after: number } {
  root.updateMatrixWorld(true);
  const skip = new Set<THREE.Object3D>(keep);
  for (const s of kit.spinners) skip.add(s.object);

  // Pick boxes first, while each picked group still has its meshes.
  const proxies = new THREE.Group();
  proxies.name = 'pick-proxies';
  const hidden = kit.own(new THREE.MeshBasicMaterial({ visible: false }));
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const visit = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    const pick = o.userData.pick as PickInfo | undefined;
    if (pick && pick.kind === 'equipment') {
      box.setFromObject(o);
      if (!box.isEmpty()) {
        box.getSize(size).max(new THREE.Vector3(0.15, 0.15, 0.15));
        box.getCenter(centre);
        const proxy = new THREE.Mesh(kit.boxGeo(1, 1, 1), hidden);
        proxy.scale.copy(size);
        proxy.position.copy(centre);
        proxy.userData.pick = pick;
        proxies.add(proxy);
      }
      // Its children are batched below; the proxy answers clicks for it.
    }
    for (const c of o.children) visit(c);
  };
  visit(root);

  // Collect static meshes by material (and by indexed or not: they cannot be merged together).
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  let before = 0;
  const collect = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    for (const c of o.children) collect(c);
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || o.userData.noBatch)
      return;
    before += 1;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const name of Object.keys(g.attributes))
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv)
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    const key = `${m.material.uuid}|${g.index ? 'i' : 'n'}`;
    const b = buckets.get(key) ?? { material: m.material, geos: [], meshes: [] };
    b.geos.push(g);
    b.meshes.push(m);
    buckets.set(key, b);
  };
  collect(root);

  let after = 0;
  for (const { material, geos, meshes } of buckets.values()) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue; // incompatible attributes: leave these meshes as they are
    if (geos.length > 1) for (const g of geos) g.dispose();
    kit.own(merged);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = meshes.some((x) => x.castShadow);
    mesh.receiveShadow = meshes.some((x) => x.receiveShadow);
    mesh.renderOrder = Math.max(...meshes.map((x) => x.renderOrder));
    mesh.name = 'batched';
    for (const x of meshes) x.removeFromParent();
    root.add(mesh);
    after += 1;
  }
  root.add(proxies);
  return { proxies, before, after };
}
