import type { Cable, Customer, Equipment } from '@fibergis/shared';

import { escapeXml as x } from './xml';

export interface KmlSource {
  equipment: readonly Equipment[];
  cables: readonly Cable[];
  customers: readonly Customer[];
}

const placemark = (name: string, description: string, geometry: string) => `
      <Placemark>
        <name>${name}</name>
        <description>${description}</description>
        ${geometry}
      </Placemark>`;

const point = (lat: number, lng: number) => `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;

const folder = (name: string, placemarks: string[]) => `
    <Folder>
      <name>${name}</name>${placemarks.join('')}
    </Folder>`;

/** Google Earth (KML 2.2) document with equipment, cable routes and customers. */
export function buildNetworkKml({ equipment, cables, customers }: KmlSource): string {
  const equipmentMarks = equipment.map((eq) =>
    placemark(
      `${x(eq.name)} (${x(eq.id)})`,
      `Type: ${x(eq.type)} | Area: ${x(eq.area)} | Status: ${x(eq.status)}`,
      point(eq.lat, eq.lng),
    ),
  );

  const cableMarks = cables
    .filter((cb) => cb.coordinates.length >= 2)
    .map((cb) =>
      placemark(
        `${x(cb.name)} (${x(cb.id)})`,
        `Type: ${x(cb.type)} | Length: ${cb.lengthMeters}m | Cores: ${cb.fiberCount} | Status: ${x(cb.status)}`,
        `<LineString><tessellate>1</tessellate><coordinates>${cb.coordinates
          .map(([lat, lng]) => `${lng},${lat},0`)
          .join(' ')}</coordinates></LineString>`,
      ),
    );

  const customerMarks = customers.map((c) =>
    placemark(
      `${x(c.name)} (${x(c.id)})`,
      `Plan: ${x(c.plan)} | Status: ${x(c.status)} | FAT: ${x(c.terminalBoxId)} port ${c.splitterOutputPort}`,
      point(c.lat, c.lng),
    ),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>FiberGIS Network Export</name>
    <description>Exported from FiberGIS</description>${folder('Equipment', equipmentMarks)}${folder(
      'Cables',
      cableMarks,
    )}${folder('Customers', customerMarks)}
  </Document>
</kml>
`;
}
