/**
 * The parts of shpjs 6.2.0 the Shapefile import uses (the package has no types of its own).
 * `parseShp` reads the .shp; with a .prj text it converts to WGS 84 through proj4, and when proj4
 * cannot read the .prj it silently keeps the raw numbers, which the import checks for.
 */
declare module 'shpjs' {
  export interface ShpGeometry {
    type: string;
    coordinates?: unknown;
    bbox?: number[];
  }
  export function parseShp(shp: ArrayBuffer | ArrayBufferView, prj?: string | false): (ShpGeometry | null)[];
  export function parseDbf(dbf: ArrayBuffer | ArrayBufferView, cpg?: string): Record<string, unknown>[];
}
