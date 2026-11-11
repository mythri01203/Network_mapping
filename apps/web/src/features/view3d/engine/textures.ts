import * as THREE from 'three';

/**
 * Small surface textures drawn on a canvas at run time (no image files): wood grain for poles,
 * brushed metal for faceplates, moulded plastic for boxes, concrete, plaster, floor tiles and the
 * square holes of 19-inch rack rails. Greyscale-ish, so the material colour tints them. One texture
 * per kind per `Kit`, shared by every model, so they batch and cost a few hundred kB in all.
 */

export type SurfaceKind = 'wood' | 'brushed' | 'plastic' | 'concrete' | 'plaster' | 'tiles' | 'rail' | 'vent';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, amount: number, base: number, seed: number) {
  const img = g.getImageData(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n + base));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n + base));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n + base));
  }
  g.putImageData(img, 0, 0);
}

export function makeSurface(kind: SurfaceKind): THREE.Texture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const c = document.createElement('canvas');
  const size = kind === 'tiles' || kind === 'rail' ? 128 : 256;
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const r = rng(kind.length * 7919);
  switch (kind) {
    case 'wood': {
      // Grain runs along the pole: vertical streaks (u goes round the cylinder, v along it).
      g.fillStyle = '#c8c8c8';
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < 90; i += 1) {
        const x = r() * size;
        const w = 0.6 + r() * 2.4;
        const v = Math.floor(120 + r() * 90);
        g.fillStyle = `rgba(${v},${v},${v},${0.35 + r() * 0.4})`;
        g.fillRect(x, 0, w, size);
      }
      for (let i = 0; i < 5; i += 1) {
        // Knots and cracks.
        const x = r() * size;
        const y = r() * size;
        g.fillStyle = 'rgba(70,70,70,.55)';
        g.beginPath();
        g.ellipse(x, y, 2 + r() * 3, 5 + r() * 8, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(60,60,60,.5)';
        g.fillRect(r() * size, r() * size, 0.8, 20 + r() * 50);
      }
      noise(g, size, size, 30, 0, 11);
      break;
    }
    case 'brushed': {
      g.fillStyle = '#d0d0d0';
      g.fillRect(0, 0, size, size);
      for (let y = 0; y < size; y += 1) {
        const v = Math.floor(185 + r() * 50);
        g.fillStyle = `rgba(${v},${v},${v},.55)`;
        g.fillRect(0, y, size, 1);
      }
      noise(g, size, size, 14, 0, 23);
      break;
    }
    case 'plastic': {
      g.fillStyle = '#e4e4e4';
      g.fillRect(0, 0, size, size);
      noise(g, size, size, 18, 0, 31);
      break;
    }
    case 'concrete': {
      g.fillStyle = '#bdbdbd';
      g.fillRect(0, 0, size, size);
      noise(g, size, size, 60, 0, 41);
      for (let i = 0; i < 140; i += 1) {
        const v = Math.floor(90 + r() * 80);
        g.fillStyle = `rgba(${v},${v},${v},.5)`;
        g.beginPath();
        g.arc(r() * size, r() * size, 0.5 + r() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'plaster': {
      g.fillStyle = '#e8e8e8';
      g.fillRect(0, 0, size, size);
      noise(g, size, size, 22, 0, 53);
      for (let i = 0; i < 40; i += 1) {
        g.fillStyle = `rgba(150,150,150,${0.05 + r() * 0.08})`;
        g.beginPath();
        g.arc(r() * size, r() * size, 6 + r() * 22, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'tiles': {
      g.fillStyle = '#d6d6d6';
      g.fillRect(0, 0, size, size);
      noise(g, size, size, 16, 0, 61);
      g.strokeStyle = 'rgba(80,80,80,.7)';
      g.lineWidth = 2;
      for (let i = 0; i <= 2; i += 1) {
        g.beginPath();
        g.moveTo(i * (size / 2), 0);
        g.lineTo(i * (size / 2), size);
        g.moveTo(0, i * (size / 2));
        g.lineTo(size, i * (size / 2));
        g.stroke();
      }
      break;
    }
    case 'rail': {
      // A 19-inch rack rail: square cage-nut holes, three per rack unit.
      g.fillStyle = '#cfcfcf';
      g.fillRect(0, 0, size, size);
      g.fillStyle = '#151515';
      for (let y = 0; y < size; y += size / 12) g.fillRect(size * 0.35, y + 2, size * 0.3, size / 24);
      break;
    }
    case 'vent': {
      g.fillStyle = '#9a9a9a';
      g.fillRect(0, 0, size, size);
      g.fillStyle = '#1a1a1a';
      const step = size / 16;
      for (let y = step / 2; y < size; y += step)
        for (let x = step / 2 + ((y / step) % 2) * (step / 2); x < size; x += step) {
          g.beginPath();
          g.arc(x, y, step * 0.28, 0, Math.PI * 2);
          g.fill();
        }
      break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
