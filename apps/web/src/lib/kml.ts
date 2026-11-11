import { type Building, type Cable, type Customer, type Duct, type Equipment, hasRecordedLocation, type LatLng, type Span } from '@fibergis/shared';

import { escapeXml as x } from './xml';

export interface KmlSource {
  equipment: readonly Equipment[];
  cables: readonly Cable[];
  customers: readonly Customer[];
  /** Network mapping Phase 21: outside plant in the export too. Absent lists are left out. */
  ducts?: readonly Duct[];
  spans?: readonly Span[];
  buildings?: readonly Building[];
}

const placemark = (name: string, description: string, geometry: string) => `
      <Placemark>
        <name>${name}</name>
        <description>${description}</description>
        ${geometry}
      </Placemark>`;

const point = (lat: number, lng: number) => `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;

const lineString = (coords: readonly LatLng[]) =>
  `<LineString><tessellate>1</tessellate><coordinates>${coords.map(([lat, lng]) => `${lng},${lat},0`).join(' ')}</coordinates></LineString>`;

const polygon = (coords: readonly LatLng[]) => {
  const ring = [...coords, coords[0]!];
  return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring.map(([lat, lng]) => `${lng},${lat},0`).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
};

const folder = (name: string, placemarks: string[]) => `
    <Folder>
      <name>${name}</name>${placemarks.join('')}
    </Folder>`;

/** A recorded value, or "not recorded". Nothing is filled in. */
const shown = (value: string | number | undefined | null) => (value === undefined || value === null || value === '' ? 'not recorded' : String(value));

/** Google Earth (KML 2.2) document with equipment, cable routes, ducts, spans, buildings and customers. */
export function buildNetworkKml({ equipment, cables, customers, ducts, spans, buildings }: KmlSource): string {
  const byId = new Map(equipment.map((e) => [e.id, e]));
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
        `Type: ${x(cb.type)} | Drawn length: ${cb.lengthMeters}m | Cores: ${cb.fiberCount > 0 ? cb.fiberCount : 'not recorded'} | Status: ${x(cb.status)}`,
        lineString(cb.coordinates),
      ),
    );

  const ductMarks = (ducts ?? [])
    .filter((d) => d.coordinates.length >= 2)
    .map((d) =>
      placemark(
        `${x(d.name)} (${x(d.id)})`,
        `Duct | Status: ${x(d.status)} | Ways: ${x(shown(d.wayCount))} | Cables in it: ${d.cableIds.length + d.subducts.reduce((n, s) => n + s.cableIds.length, 0)}`,
        lineString(d.coordinates),
      ),
    );

  // A span runs between its two structures (with any bends a person drew). One whose structure is
  // missing or not placed is left out: there is no line to draw.
  const spanMarks = (spans ?? []).flatMap((s) => {
    const from = byId.get(s.fromStructureId);
    const to = byId.get(s.toStructureId);
    if (!from || !to || !hasRecordedLocation(from) || !hasRecordedLocation(to)) return [];
    const line: LatLng[] = [[from.lat, from.lng], ...(s.routePoints ?? []), [to.lat, to.lng]];
    return [
      placemark(
        `${x(s.name)} (${x(s.id)})`,
        `Span ${x(from.name)} to ${x(to.name)} | Status: ${x(s.status)} | Measured length: ${s.measuredLengthMeters !== undefined ? `${s.measuredLengthMeters}m` : 'not recorded'}`,
        lineString(line),
      ),
    ];
  });

  const buildingMarks = (buildings ?? []).filter(hasRecordedLocation).map((b) =>
    placemark(`${x(b.name)} (${x(b.id)})`, `Building | Kind: ${x(b.kind)} | Address: ${x(shown(b.address))} | Units: ${b.units.length}`, point(b.lat, b.lng)),
  );
  const outlineMarks = (buildings ?? [])
    .filter((b) => (b.footprint?.length ?? 0) >= 3)
    .map((b) => placemark(`${x(b.name)} outline (${x(b.id)})`, 'Building outline as drawn', polygon(b.footprint!)));

  const customerMarks = customers.filter(hasRecordedLocation).map((c) =>
    placemark(
      `${x(c.name)} (${x(c.id)})`,
      `Plan: ${x(c.plan)} | Status: ${x(c.status)} | FAT: ${x(c.terminalBoxId)} port ${c.splitterOutputPort}`,
      point(c.lat, c.lng),
    ),
  );

  const folders = [
    folder('Equipment', equipmentMarks),
    folder('Cables', cableMarks),
    ...(ducts ? [folder('Ducts', ductMarks)] : []),
    ...(spans ? [folder('Spans', spanMarks)] : []),
    ...(buildings ? [folder('Buildings', buildingMarks), ...(outlineMarks.length ? [folder('Building outlines', outlineMarks)] : [])] : []),
    folder('Customers', customerMarks),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>FiberGIS Network Export</name>
    <description>Exported from FiberGIS</description>${folders.join('')}
  </Document>
</kml>
`;
}
