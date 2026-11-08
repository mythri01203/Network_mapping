import { kmlWithFolders } from '@tmcw/togeojson';
import { strFromU8, unzipSync } from 'fflate';

import type { KmlFeatureInput } from '@fibergis/shared';

/**
 * Reads a KML or KMZ file into plain features for `previewKml` in `@fibergis/shared`. Parsing uses
 * @tmcw/togeojson (KML to GeoJSON, keeping folders) and fflate (unzipping KMZ). Nothing here decides
 * what a feature is: that is the person's choice in the import screen.
 */

/** Largest file accepted. A whole city's route map is far smaller. */
export const KML_MAX_BYTES = 30 * 1024 * 1024;

/** Properties togeojson adds for styling and structure. Everything else came from ExtendedData. */
const NOT_EXTENDED_DATA = new Set([
  'name',
  'description',
  'styleUrl',
  'styleHash',
  'styleMapHash',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'fill',
  'fill-opacity',
  'icon',
  'icon-scale',
  'icon-heading',
  'icon-offset',
  'icon-offset-units',
  'icon-color',
  'icon-opacity',
  'label-scale',
  'label-color',
  'label-opacity',
  'visibility',
  'timespan',
  'timestamp',
  'coordinateProperties',
  '@geometry-type',
  'address',
  'phoneNumber',
]);

export class KmlReadError extends Error {}

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

/** The KML text inside a file: the file itself, or doc.kml (else the first .kml) inside a KMZ. */
export async function readKmlText(file: File): Promise<string> {
  if (file.size > KML_MAX_BYTES) throw new KmlReadError('This file is too large to import here (over 30 MB). Split it in Google Earth.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) return new TextDecoder().decode(bytes);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (entry) => entry.name.toLowerCase().endsWith('.kml') });
  } catch {
    throw new KmlReadError('This KMZ could not be opened. It may be damaged.');
  }
  const names = Object.keys(entries).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const chosen = names.find((n) => n.toLowerCase() === 'doc.kml') ?? names[0];
  if (!chosen) throw new KmlReadError('This KMZ has no KML file inside.');
  return strFromU8(entries[chosen]);
}

type TreeNode = ReturnType<typeof kmlWithFolders>['children'][number];

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object' && 'value' in value && typeof (value as { value: unknown }).value === 'string') {
    return ((value as { value: string }).value as string).trim() || undefined;
  }
  return undefined;
};

/** Every placemark in document order, with its folder path, name, description, style and ExtendedData. */
export function parseKmlText(source: string): KmlFeatureInput[] {
  const dom = new DOMParser().parseFromString(source, 'text/xml');
  if (dom.getElementsByTagName('parsererror').length > 0 || !dom.documentElement) {
    throw new KmlReadError('This is not a readable KML file.');
  }
  if (!/kml/i.test(dom.documentElement.nodeName)) throw new KmlReadError('This file is XML but not KML.');
  const tree = kmlWithFolders(dom);
  const features: KmlFeatureInput[] = [];

  const walk = (nodes: TreeNode[], path: string[]) => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        walk(node.children as TreeNode[], [...path, text(node.meta.name) ?? '(folder with no name)']);
        continue;
      }
      if (node.type !== 'Feature') continue;
      const props = (node.properties ?? {}) as Record<string, unknown>;
      const extendedData: Record<string, string> = {};
      for (const [key, value] of Object.entries(props)) {
        if (NOT_EXTENDED_DATA.has(key) || value === null || value === undefined) continue;
        extendedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
      const styleUrl = text(props.styleUrl);
      features.push({
        index: features.length,
        folderPath: path.join(' / '),
        ...(text(props.name) ? { name: text(props.name) } : {}),
        ...(text(props.description) ? { description: text(props.description) } : {}),
        ...(styleUrl ? { styleId: styleUrl.includes('#') ? styleUrl.slice(styleUrl.lastIndexOf('#') + 1) : styleUrl } : {}),
        geometry: node.geometry as KmlFeatureInput['geometry'],
        extendedData,
      });
    }
  };
  walk(tree.children, []);
  return features;
}
