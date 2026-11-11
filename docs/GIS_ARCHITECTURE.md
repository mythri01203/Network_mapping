# GIS architecture

This document covers how FiberGIS stores places and shapes, draws them, and lets people work with the map. It describes the code as of Phase 1 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 10 November 2026.

## Coordinates and geometry

| Topic | Rule | Where |
|---|---|---|
| Coordinate system | WGS84 degrees, stored as `[lat, lng]`. The map shows Web Mercator (Leaflet's default). There is no projected CRS and no CRS field | `packages/shared/src/model/schemas.ts` (`latLngSchema`) |
| "Not recorded" | `0, 0` means no recorded place. It is never drawn and never counted in an extent | `hasRecordedLocation` in `domain/defaults.ts` |
| Rough place | A field capture with no good GPS fix has `officeMustPlace: true` (or `locationMethod: 'not_placed'`). It is drawn as a dashed amber "?" pin and left out of "show whole network" | `hasPlacedPosition` in `domain/outsidePlant.ts`; `unplacedMarkerIcon` in `features/map/markerIcons.ts` |
| Points | Equipment, customers, faults, slack loops | records |
| Lines | Cables and ducts (`coordinates`). A cable route may be empty ("not drawn yet"); one point is refused by the server (Phase 0B) | `domain/fiberRules.ts` (`cable_one_point`) |
| Polygons | Zone boundaries only (`boundaryCoords`, 3 or more points; empty means not drawn) | `features/map/layers/ZoneLayer.tsx` |
| Lengths | Great-circle (`polylineLengthMeters`). Drawn, sheath and optical lengths are kept separate | `domain/geo.ts` |
| Areas | Spherical polygon area (`polygonAreaSqMeters`). Always labelled as worked out from the drawing | `domain/geo.ts` |
| Screen scale | `metersPerPixel(lat, zoom)`, used by the scale bar and the snap distance | `domain/geo.ts` |

## Map stack

- **Leaflet 1.9**, driven by the app's own hooks and layer components rather than react-leaflet. The map instance lives in `features/map/leaflet/useLeafletMap.ts`.
- **Base maps:** Google streets, Google satellite and OpenStreetMap (`leaflet/tileProviders.ts`). The Google tiles are used directly. Choosing a licensed provider is an open decision for the owner.
- **Drawing order (panes, bottom to top):**

| Pane | z-index | What it holds |
|---|---|---|
| halo | 390 | Selection and trace halos |
| structures | 395 | Spans, ducts, zones |
| overlay | 400 | Cables |
| route | 420 | Field route |
| sketch | 450 | Drawing and measuring previews; never takes a tap |
| labels | 550 | Name labels; never takes a tap |
| markers | 600 | Pins |

- **Pin order:** where pins overlap, the order chosen in the layer panel decides which is on top (`equipmentOrder`). The selected pin is always on top.
- **Only what is in view is drawn.** Cables and pins outside the view (plus a margin) are skipped. Pins cluster below zoom 16 once there are 300 or more (`leaflet/clustering.ts`). The selected and traced items are always drawn.

## Layers

A layer is worked out from **recorded attributes**, never from a guess:

| Layer group | Decided by | Code |
|---|---|---|
| Cable role (feeder, distribution, drop, coaxial) | Cable type | `cableLayerKey` |
| Cable install method (aerial, underground) | The cable's recorded `installationType`. Only when that is not recorded does an older type name ("Aerial Fiber", "Underground Fiber") say it. A cable with neither is in no install layer | `cableInstallLayer` |
| Equipment kind | Type and category | `equipmentLayerKey` |
| Other equipment | Any type not known above (custom catalogue items), so it can still be hidden | `equipmentLayerOf` |
| Spans, ducts, slack loops, zones, customers, faults | Their own collections | `useLayerShown` |

A cable is hidden when any of its layers is switched off, and it is drawn at the faintest of their opacities.

Per-layer settings, kept in `stores/mapStore.ts`:

| Setting | Meaning |
|---|---|
| `layers` | On or off |
| `layerOpacity` | 20–100% |
| `layerMinZoom` | Drawn only from this zoom in (scale visibility). Absent: always |
| `layerLabels` | Name labels per equipment layer. Poles and manholes are off by default |
| `labelMinZoom` | Labels appear from this zoom (default 17) |
| `equipmentOrder` | Pin order where pins overlap |
| `savedViews` | Named sets of the above plus a place on the map |

**Where these are kept.** All of these are saved in the browser on this device. Saved views carry the account id, so each person on a shared device sees only their own.

They are not on the server. Putting them in the network collections would send everyone's views to all users and into backups. A per-user server table would need a database change, which needs the owner's approval first.

**Layer panel.** The panel (`features/map/AdvancedLayersDrawer.tsx`):
- shows a count per layer, worked out from the records on the device;
- names layers plainly, with no made-up specifications;
- includes a legend drawn from the same styles the map uses (`theme/network.ts`, `markerIcons.ts`).

## Map tools

| Tool | Behaviour | Code |
|---|---|---|
| Scale bar | A round length (1, 2 or 5 × 10ⁿ) from the centre latitude and zoom | `features/map/MapStatus.tsx`, `mapScale.ts` |
| Pointer position | WGS84 degrees to 6 places, on screens with a mouse | `MapStatus.tsx` |
| Show whole network | Fits every placed pin, drawn route, customer with a recorded place, duct and zone boundary. Leaves out 0,0 and pins the office must place. Says so when nothing is placed | `features/map/mapExtent.ts` |
| Show a route | "Show on map" for a cable or duct fits its whole route; points are centred | `app/mapFocus.ts` (`boundsFor`), `app/views.ts` |
| Full screen | The whole page, so forms and dialogs still show | `MapControls.tsx` |
| Print | Prints only the map, its scale bar and a caption: the date, "Positions are as recorded in FiberGIS. Not a survey drawing." | `GISMap.tsx` (`printMap`), print styles in `index.css` |
| Measure | Distance; with 3 or more points also the area of the closed shape | `sketch/SketchTools.tsx` |
| Zone boundary | Opened from the Zones screen: tap round the zone, Finish. It never snaps to pins and never places poles. Only the boundary is saved; the coverage typed for the zone is kept, and the drawn area is shown beside it as "worked out from the drawing" | `sketch/SketchTools.tsx`, `features/zones/ZoneManagementView.tsx` |

## Snapping

- **What it does.** While drawing a cable or duct, or measuring, a point lands on the nearest visible pin within the snap distance.
- **Snap distance.** It is 24 screen pixels on the ground, capped at 30 m (`snapRadiusMeters`). Zoomed out, a fixed 30 m would cover several poles. Zoomed in, it shrinks to what a finger can hit.
- **What it shows.** A green ring and the pin's name appear before the point is placed.
- **It never connects anything.** The cable form proposes the ends a line touches, and a person confirms them.
- **Exceptions.** Placing new equipment and drawing zone boundaries do not snap.

## Known limits (later phases)

| Limit | Phase |
|---|---|
| Vertex editing, split, merge and reverse of routes: built in Phase 5, see [FIBRE_CABLE_ENGINEERING.md](FIBRE_CABLE_ENGINEERING.md). Split and merge of ducts are not built | Phase 5 |
| No server-side area queries, paging or spatial index; the whole network is loaded into the browser | Phase 24 |
| PNG export of the map needs a new library (owner approval) | — |
| Saved views per user on the server need a new table (owner approval) | — |
| Licensed tile provider instead of direct Google tiles | Owner decision |
| No multi-select, box select or context menu | Phase 16 |
