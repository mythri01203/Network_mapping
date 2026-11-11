# Network mapping feature matrix

**Date:** 10 November 2026. This is a read-only audit: no code was changed.

This document covers all 36 modules of `FiberGIS_Ultimate_Network_Mapping_Master_Prompt.md`. The evidence and the risks are in [NETWORK_MAPPING_AUDIT.md](NETWORK_MAPPING_AUDIT.md), and the work plan is in [NETWORK_MAPPING_IMPLEMENTATION_PLAN.md](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md).

## Key

**Paths:**

| Short form | Full path |
|---|---|
| `web/` | `apps/web/src/` |
| `shared/` | `packages/shared/src/` |
| `server/` | `apps/server/src/` |

**API:**
- "Generic CRUD" means `GET/PUT/DELETE /api/v1/:collection/:id` plus `POST /changes`. Both run the schema, access and link checks.
- "Snapshot" means the data arrives with `GET /network`.

**Database:** "records: x" means collection `x`, stored as JSON in the `records` table.

**Status:**

| Status | Meaning |
|---|---|
| DONE | Built and working |
| PARTIAL | Some parts are built |
| UI-ONLY | A screen exists, but nothing is saved or enforced |
| BACKEND-ONLY | The server supports it, but no screen uses it |
| DEFECTIVE | Built, but gives wrong results |
| MISSING | Not built |

**Priority:**

| Priority | Meaning |
|---|---|
| P0 | Data-integrity risk; fix before building more |
| P1 | Core engineering truth |
| P2 | Important for daily work |
| P3 | Enterprise or scale |

## Summary

| # | Module | Status | Priority | Depends on |
|---|---|---|---|---|
| 1 | GIS workspace | PARTIAL | P1 | – |
| 2 | Layer management | PARTIAL / UI-ONLY | P2 | 1 |
| 3 | Equipment catalogue | PARTIAL (weak) | P1 | 29 |
| 4 | Asset inventory and placement | PARTIAL | P1 | 3 |
| 5 | OSP engineering | PARTIAL | P1 | 4 |
| 6 | Fibre cables | PARTIAL | P1 | 1, 5 |
| 7 | Cable segments and corridors | MISSING | P2 | 6 |
| 8 | Tubes and cores | PARTIAL | P0/P1 | 6 |
| 9 | Splicing | PARTIAL | P1 | 8 |
| 10 | ODF and patch | PARTIAL | P1 | 8 |
| 11 | OLT and active | PARTIAL | P1 | 10 |
| 12 | Splitters | DONE (mostly) | P2 | 11 |
| 13 | Customers and FTTH | DONE / PARTIAL | P0/P1 | 12 |
| 14 | HFC and CATV | DONE (mostly) | P3 | – |
| 15 | Physical connectivity engine | PARTIAL | P1 | 8–13 |
| 16 | Logical topology | PARTIAL | P2 | 15 |
| 17 | Trace | PARTIAL | P1 | 15 |
| 18 | Map interactions | PARTIAL / MISSING | P2 | 1 |
| 19 | Search and filters | PARTIAL | P2 | 32 |
| 20 | Attribute table | PARTIAL / mislabelled | P2 | 19, 32 |
| 21 | Validation | PARTIAL | P0/P1 | 15 |
| 22 | Optical budget | DONE / PARTIAL | P2 | 17 |
| 23 | Capacity planning | PARTIAL | P2 | 15 |
| 24 | Change and version management | PARTIAL | P1 | 31 |
| 25 | Survey and field mapping | DONE / PARTIAL | P1 | 24 |
| 26 | Import, export, migration | PARTIAL | P2 | 21 |
| 27 | Monitoring | DONE / PARTIAL | P3 | 11 |
| 28 | Fault impact | DONE (mostly) | P3 | 15 |
| 29 | Administration and configuration | PARTIAL | P2 | – |
| 30 | Reports | PARTIAL (9 of 18) | P2 | 21, 23 |
| 31 | Security and audit | PARTIAL | P0/P1 | – |
| 32 | Performance and reliability | PARTIAL | P1 (scale) | – |
| 33 | Workflow tests A to L | PARTIAL | P1 | all |
| 34 | Implementation phases | This plan | – | – |
| 35 | Project documentation | PARTIAL (6 of 27) | P2 | each phase |
| 36 | Initial audit response | DONE (this audit) | – | – |

---

## Module detail

### M1 GIS workspace: PARTIAL, P1
| Feature | Status |
|---|---|
| Basemaps (Google streets and hybrid, OSM) | PARTIAL: no terrain or custom layer; direct Google tile URLs may breach Google's terms |
| Zoom, pan, GPS position with accuracy | DONE |
| Distance measure | DONE (snaps to equipment within 30 m without saying so) |
| Reset extent | PARTIAL: fixed Bangalore point |
| Zoom to item | PARTIAL: centre only, no `fitBounds` |
| Legend | UI-ONLY, minimal |
| Symbols, status styling, tooltips, halos, clustering | DONE |
| Labels | PARTIAL: equipment only, zoom 17 and above |
| Undo and redo | PARTIAL: browser only, cleared by remote changes |
| Fullscreen, scale bar, north arrow, cursor coordinates, area measure, print, map export | MISSING |
| Vertex edit, split, merge, context menu | MISSING |
| Polygons (zones) drawn on the map | MISSING |
| CRS | PARTIAL: WGS84 assumed, no CRS field |

- **Frontend:** `web/features/map/GISMap.tsx`, `MapControls.tsx`, `leaflet/*`, `sketch/SketchTools.tsx`, `web/stores/mapStore.ts`, `web/app/mapFocus.ts`
- **Backend:** none (geometry is validated by the shared schemas)
- **API:** Snapshot
- **Database:** geometry is stored as JSON arrays inside the records
- **Missing:** the items marked MISSING above

### M2 Layer management: PARTIAL / UI-ONLY, P2
| Feature | Status |
|---|---|
| Groups, show/hide, opacity | UI-ONLY (saved in localStorage) |
| Filter | PARTIAL: network mode and OLT technology |
| Reorder, style, label rules, scale visibility | MISSING |
| Saved views, presets, counts, metadata, permissions | MISSING |
| Layers based on attributes | DEFECTIVE: the layer is guessed from the type text, so custom types cannot be hidden, and the Aerial/Underground toggles ignore `installationType` |

- **Frontend:** `web/features/map/AdvancedLayersDrawer.tsx`, `layerFilters.ts`, `web/stores/mapStore.ts`
- **Backend / API / Database:** none
- **Missing:** layer settings saved on the server for each user; layers built from attributes

### M3 Equipment master catalogue: PARTIAL (weak), P1
| Feature | Status |
|---|---|
| Categories and types | PARTIAL: 5 categories, about 50 types (`shared/model/enums.ts:15-80`), RF kinds in `rfSchemas.ts`. No chassis, card, rack, UPS, pigtail, patch cord, FDB/FDH, riser or BDP types |
| Catalogue record | PARTIAL: `catalogComponentSchema` holds only id, type, category, name, description, defaultPorts, icon colour and custom flag |
| Built-in models | Hard-coded TypeScript (`web/features/catalog/componentCatalog.ts`) |
| Specs, port templates, connectors, power, environment, datasheet, lifecycle | MISSING |
| Custom item port count used when placing | DEFECTIVE: the modal passes only the type (`ComponentCatalogModal.tsx:57-62`) |

- **Frontend:** `web/features/catalog/*`
- **Backend:** generic
- **API:** Generic CRUD (`catalog`)
- **Database:** records: catalog
- **Missing:** a product-model schema, records seeded with the built-in models, editable lists

### M4 Asset inventory and placement: PARTIAL, P1
| Feature | Status |
|---|---|
| Place by click, drag from palette, phone GPS | DONE |
| Move, with cable ends following | DONE |
| Typed coordinates, address, duplicate, copy settings, bulk placement | MISSING |
| Core asset fields (id, type, make, model, serial, QR tag, position and accuracy, status, photos) | DONE |
| Barcode, address, zone link, contractor, warranty, maintenance, condition, history | MISSING |
| Link from a deployed asset to its catalogue model (`catalogModelId`) | MISSING |
| General edit form | MISSING: only OLT, pole and port editors exist |
| Inspector | PARTIAL: sections rather than tabs; no specs, documents, maintenance or asset history |
| Document link | DEFECTIVE: depends on the id prefix (`DocumentManagerModal.tsx:61-62`) |
| Inventory values | DEFECTIVE: invented date and port use (`EquipmentInventoryView.tsx:241-242,311`) |

- **Frontend:** `web/features/map/EquipmentToolbox.tsx`, `web/features/inspector/EquipmentInspector.tsx`, `web/features/inventory/*`, `web/features/documents/*`
- **Backend:** generic
- **API:** Generic CRUD (`equipment`, `documents`)
- **Database:** records: equipment, documents
- **Missing:** the items marked MISSING or DEFECTIVE above

### M5 OSP engineering: PARTIAL, P1
| Feature | Status |
|---|---|
| Pole details, cables on a pole, spans, right-of-way permissions | DONE |
| Span geometry, sag, clearance, condition, inspections | MISSING (spans are drawn straight) |
| Manholes and handholes | PARTIAL: points with "ducts at"; no internals or inspections |
| Ducts, subducts, ways, occupancy | DONE |
| Microducts, fill ratio, blocked state | MISSING |
| Editing duct depth and owner | MISSING |
| Buildings: entry, riser, floors, units | DONE |
| Building footprint polygon | MISSING (point only) |
| Underground trace | MISSING |
| Slack loops | DONE (but also duplicated as an equipment type) |

- **Frontend:** `web/features/inspector/osp/*`, `web/features/ducts/*`, `web/features/premises/*`, `web/features/map/leaflet/OspLayer.tsx`, `web/stores/ospActions.ts`
- **Backend:** `server/lib/linkGuard.ts` (outside-plant rules)
- **API:** Generic CRUD
- **Database:** records: spans, attachments, ducts, slackLoops, permissions, buildings
- **Missing:** the items marked MISSING above

### M6 Fibre cables: PARTIAL, P1
| Feature | Status |
|---|---|
| Draw, snap, live length, poles added along the route | DONE |
| Drawn, sheath and optical length kept separate, with mismatch flags | DONE |
| Fibre count, tube layout, colour scheme, status, route status, ends, ports | DONE |
| Cable in a duct or on a span | DONE |
| Cable types | PARTIAL: 7 types; type and install method are mixed in the labels |
| Fibre standard, mode, sheath, diameter | MISSING |
| Step-by-step wizard | PARTIAL: one form |
| Vertex edit, split, merge, extend, trim, reverse, duplicate | MISSING |
| Duplicate-route check | MISSING |
| At least two points required | DEFECTIVE: no `.min(2)` (`schemas.ts:482`) |
| Wizard default route | DEFECTIVE: a straight line when no route was drawn |

- **Frontend:** `web/features/cables/*`, `web/features/map/sketch/SketchTools.tsx`, `web/features/inspector/osp/CableSections.tsx`
- **Backend:** generic, plus the fibre rules
- **API:** Generic CRUD (`cables`)
- **Database:** records: cables
- **Missing:** the items marked MISSING or DEFECTIVE above

### M7 Cable segments and corridors: MISSING, P2
| Feature | Status |
|---|---|
| Segment entity | MISSING |
| Many cables per duct or span | DONE (attachments, cableIds) |
| Mixed install methods along one cable | MISSING |
| Duplicate physical cable check | MISSING |

- **Files:** none yet
- **Database:** a new `cableSegments` collection would be needed (needs approval)

### M8 Tubes and cores: PARTIAL, P0/P1
| Feature | Status |
|---|---|
| Tubes worked out from `fibersPerTube` and `tubeCount` | PARTIAL: no tube records, no tubes of different sizes |
| Colour kept separate from status | DONE |
| Core id | DONE (`cableId#coreNumber`) |
| Reserve, assign, release with stated use and history | DONE |
| Older Allocate button | DEFECTIVE: sets In Use without an assignment record |
| Reserved core with no assignment can be given away | DEFECTIVE |
| Damaged core assigned through the API | DEFECTIVE: the server only warns |
| Mark faulty or repaired, override process, core search, splice history per core | MISSING |
| Core diagram | PARTIAL: chip grid |

- **Frontend:** `web/features/fiber/CoreSection.tsx`, `web/features/map/BottomInfoPanel.tsx`
- **Backend:** `shared/domain/fiberRules.ts`, `shared/domain/fiberCommands.ts`, `server/lib/linkGuard.ts`
- **API:** Generic CRUD plus `/changes`
- **Database:** cores are embedded in records: cables
- **Missing:** the items marked MISSING or DEFECTIVE above

### M9 Splicing: PARTIAL, P1
| Feature | Status |
|---|---|
| Closures (3 fixed types), trays (one in use cannot be removed) | DONE |
| Tray capacity checked | MISSING |
| Recording a splice: loss, loss source, technician, date, OTDR reference, server rules | DONE |
| Notes and photos in the form | MISSING (they exist in the schema only) |
| Cassettes, positions, pigtails, printable report | MISSING |
| Splice diagram | PARTIAL: a list |
| Deleting a splice entered by mistake | DEFECTIVE: hard delete, history lost |

- **Frontend:** `web/features/splicing/SplicingModal.tsx`, `SpliceModal.tsx`
- **Backend:** `shared/domain/fiberCommands.ts`, `shared/domain/splices.ts`, `fiberRules.ts`
- **API:** Generic CRUD
- **Database:** records: closures
- **Missing:** the items marked MISSING or DEFECTIVE above

### M10 ODF and patch: PARTIAL, P1
| Feature | Status |
|---|---|
| Panels and ports (1–288), feeder core, patch to PON, port history, server rules | DONE |
| Site and rack | PARTIAL: plain text |
| Pigtails | MISSING |
| Mark a port faulty or reserved | MISSING (the values exist, no screen) |
| Feeder marks the core as used | MISSING |

- **Frontend:** `web/features/fiber/PlantSections.tsx`
- **Backend:** `shared/domain/fiberCommands.ts`, `fiberRules.ts`
- **API:** Generic CRUD
- **Database:** embedded in records: equipment
- **Missing:** the items marked MISSING above

### M11 OLT and active network: PARTIAL, P1
| Feature | Status |
|---|---|
| Make, model, serial, IP, firmware, site, technology | DONE |
| PON ports: technology, `maxOnu`, feeder core, vendor address | DONE |
| Chassis, shelf, slot and card as records | MISSING (plain text) |
| PON port counts | DEFECTIVE: only 4, 8, 16 or 32 allowed (`OltConfigModal.tsx:146,661`) |
| Connected count | DEFECTIVE: a running counter that can drift |
| Service count and capacity from records | MISSING |
| OLT setup screen creates splitters as a side effect | DEFECTIVE (`OltConfigModal.tsx:356`) |

- **Frontend:** `web/features/equipment/OltConfigModal.tsx`, `web/features/olt-rack/*`, `web/features/fiber/PlantSections.tsx`
- **Backend:** `shared/domain/oltConfig.ts`
- **API:** Generic CRUD
- **Database:** records: equipment
- **Missing:** the items marked MISSING or DEFECTIVE above

### M12 Splitters: DONE (mostly), P2
| Feature | Status |
|---|---|
| PLC and FBT, ratio, coupler, make, loss and source, loss per output, status, history | DONE |
| Cascades, parent and children | DONE |
| Server checks: overflow, duplicate port, two feeds on one output, two customers | DONE |
| Architecture attribute (centralised or distributed) | MISSING |

- **Frontend:** `web/features/fiber/PlantSections.tsx`
- **Backend:** `fiberCommands.ts`, `fiberRules.ts`, `provisioning.ts`
- **API:** Generic CRUD
- **Database:** records: splitters

### M13 Customers and FTTH: DONE / PARTIAL, P0/P1
| Feature | Status |
|---|---|
| ONT (server refuses a duplicate serial), services, building units | DONE |
| Trace, ONT swap, disconnect, move, history | DONE |
| Server checks that path fields agree with the fibres | MISSING |
| Path fields naming missing records | DEFECTIVE: the server accepts them |
| Drop fibre 1 preselected by default | DEFECTIVE |
| Personal data hidden by role | PARTIAL: mobile only |

- **Frontend:** `web/features/customers/*`
- **Backend:** `shared/domain/connectionCommands.ts`, `connectionRules.ts`, `server/auth/access.ts`
- **API:** Generic CRUD
- **Database:** records: customers, onts, services
- **Missing:** the items marked MISSING, DEFECTIVE or PARTIAL above

### M14 HFC and CATV: DONE (mostly), P3
| Feature | Status |
|---|---|
| RF elements and links, with server rules for direction, ports, feeds and loops | DONE |
| RF tree, upstream trace | DONE |
| RF levels with unit, origin and offset; meter photo required | DONE |
| Kept separate from PON | DONE |
| RF elements drawn on the map | MISSING |
| Drop element | PARTIAL |

- **Frontend:** `web/features/cable-tv/*`
- **Backend:** `shared/domain/rf*.ts`, `server/lib/linkGuard.ts`
- **API:** Generic CRUD
- **Database:** records: rfElements, rfLinks, rfLevels
- **Tests:** `server/test/phase6.test.ts`

### M15 Physical connectivity engine: PARTIAL, P1
| Feature | Status |
|---|---|
| Create, edit and disconnect each kind of link | DONE (separate commands per kind) |
| Duplicate prevention on the server | DONE |
| Incompatibility checks | PARTIAL: optics class only; no connector or direction checks |
| One connection entity | MISSING: links are spread over about 8 kinds of field |
| Verification, technician and evidence on every link | MISSING |

- **Files:** `shared/domain/connectionCommands.ts`, `connectionRules.ts`, `fiberCommands.ts`, `fiberRules.ts`
- **Database:** embedded in many collections
- **Missing:** the items marked MISSING above

### M16 Logical topology: PARTIAL, P2
| Feature | Status |
|---|---|
| Service tree worked out from physical links | DONE (`shared/domain/serviceTopology.ts`, `web/features/topology/*`) |
| Logical layer (VLAN, service binding), combined view | MISSING |
| Older "topology" view | DEFECTIVE: groups by type, not by links (`NetworkTopologyView.tsx:16`) |

### M17 Network trace: PARTIAL, P1
| Requested trace | Status |
|---|---|
| 1 Asset to asset | PARTIAL: equipment to OLT only |
| 2 Cable to cable | PARTIAL: cable to OLT |
| 3 Core to core | PARTIAL: core to PON |
| 4 Port to port | MISSING |
| 5 OLT to ONT | PARTIAL: PON tree, counts only |
| 6 Customer to OLT | DONE |
| 7 Splitter to customer | PARTIAL (inside the PON tree) |
| 8 Upstream | DONE |
| 9 Downstream | PARTIAL |
| 10 Physical route | PARTIAL: cable level |
| 11 Logical service | DONE (service topology) |
| 12 Fault impact | DONE |

| Result feature | Status |
|---|---|
| Ordered steps, gaps, ok/warning/broken | DONE |
| "Unverified link" state | MISSING |
| Map highlight | PARTIAL: cable-level trace only |
| Topology diagram | PARTIAL: text tree |
| Downloadable report | MISSING |
| Two engines that can disagree | DEFECTIVE (`trace.ts` against `fiberPath.ts`) |

- **Files:** `shared/domain/trace.ts`, `fiberPath.ts`, `opticalPathTrace.ts`, `web/features/trace/*`

### M18 Map interactions: PARTIAL / MISSING, P2
| Feature | Status |
|---|---|
| Hover tooltip, click to open the inspector | DONE |
| Clear selection | DONE |
| Right-click menu | MISSING |
| Multi-select, box or lasso | MISSING |
| Select by attribute or area; invert; save a selection | MISSING |
| Select connected | PARTIAL: trace highlight only |

- **Files:** `web/features/map/leaflet/featureClick.ts`, `web/features/inspector/PropertiesPanel.tsx`

### M19 Search and filters: PARTIAL, P2
| Feature | Status |
|---|---|
| Global search for ids and names of equipment, cables, customers and faults | PARTIAL: in the browser (`web/app/shell/TopNavBar.tsx:125-180`) |
| Search by serial, model, QR tag, pole number, port, core, ODF port, splitter, closure, duct, span, zone | MISSING (QR only in the capture app) |
| Inventory filters | PARTIAL |
| Advanced builder, saved filters, history, suggestions, address geocoding | MISSING |
| Server search API | MISSING |

### M20 Attribute table: PARTIAL / mislabelled, P2
| Feature | Status |
|---|---|
| "Attribute table" | DEFECTIVE name: it shows only the selected cable's cores (`BottomInfoPanel.tsx`) |
| Inventory tables | PARTIAL: no sort, paging, virtual scrolling, column control, multi-select or bulk edit |
| CSV export | DEFECTIVE: no quote escaping in the inventory (`EquipmentInventoryView.tsx:82`) |
| Validation on save | DONE (server) |
| Synced with the map | PARTIAL: one way ("Locate on map") |

### M21 Validation: PARTIAL, P0/P1
| Feature | Status |
|---|---|
| Coordinate range, swapped lat/lng | DONE |
| Cable with at least two points | DEFECTIVE |
| Self-intersection, unnecessary vertices, gaps, outside service area, duplicate route | MISSING |
| Duplicate points, stacked pins, repeated span | DONE (map check) |
| Ends not snapped or missing, broken path, missing customer link | DONE (warnings) |
| Core, splitter and PON conflicts | DONE (server) |
| Location, explanation and fix text in the UI | MISSING |
| Storing findings, resolving them, keeping their history | MISSING |
| Operator limit settings used on the server | DEFECTIVE: `DEFAULT_LIMITS` |

- **Files:** `.claude/skills/fibergis-map-check/scripts/check_network.mjs`, `server/lib/mapCheck.ts`, `server/routes/reports.ts`, `web/features/reports/ReportsModal.tsx`

### M22 Optical budget: DONE / PARTIAL, P2
| Feature | Status |
|---|---|
| Fibre, splitter, splice and connector parts; dB and dB/km; editable limits; estimate against reading | DONE |
| Length basis and loss source shown | DONE / PARTIAL: a settings default is not flagged |
| Missing inputs | PARTIAL: verdict given with a defaulted optics class; unknown splitters left out silently |
| Timestamp, stored history | MISSING |

- **Files:** `shared/domain/lossEngine.ts`, `fiberPath.ts`, `opticalSettings.ts`, `web/features/trace/FiberTraceModal.tsx`

### M23 Capacity planning: PARTIAL, P2
| Feature | Status |
|---|---|
| Core, splitter and PON port use | DONE (`shared/domain/reports.ts`, `CapacityDashboardModal.tsx`) |
| OLT use | PARTIAL: per port |
| ODF and pole use | MISSING |
| Duct use | UI-ONLY |
| Spare and shortage, expansion, alternative routes, forecasting, demand, investment | MISSING |
| Planned against built | PARTIAL: the statuses exist, no report |

### M24 Change and version management: PARTIAL, P1
| Feature | Status |
|---|---|
| History arrays on many records | PARTIAL (each record type does it differently) |
| Audit log | PARTIAL: free text, written by the browser, no before and after |
| Version column | PARTIAL: catches conflicts, keeps no old versions |
| Change request, review, approval, verification, closure | MISSING |
| Before and after comparison | MISSING (sync conflicts only) |

- **Files:** `server/db/sqliteRepository.ts`, `server/auth/access.ts:96`, `web/features/operations/*`

### M25 Survey and field mapping: DONE / PARTIAL, P1
| Feature | Status |
|---|---|
| GPS samples, accuracy, method; pole, box, drop, light and hazard capture; QR; photos; offline queue; conflicts | DONE |
| Route recording | DONE |
| Barcode, inspection checklists, manhole and duct survey forms, sync history | MISSING |
| Survey kept separate from production, with review | MISSING (records go in as `Active`, `fieldCapture.ts`) |

- **Files:** `web/features/capture/*`, `shared/domain/fieldCapture.ts`, `server/routes/photos.ts`

### M26 Import, export and migration: PARTIAL, P2
| Feature | Status |
|---|---|
| KML/KMZ import with preview, geometry checks, skip report, one undo step, provenance | DONE |
| CSV, Excel, Shapefile, GeoJSON import | MISSING |
| Field mapping, CRS handling, line duplicate check, import history, rollback by `importId` | MISSING |
| Export: KML, GeoJSON, CSV, JSON/zip backup | DONE / PARTIAL: ducts, spans and buildings are not in the KML |
| Export: Excel, Shapefile, KMZ | MISSING |
| Bulk import API | MISSING |

- **Files:** `shared/domain/kmlImport.ts`, `web/lib/kmlImport.ts`, `web/lib/kml.ts`, `web/features/import/KmlImportModal.tsx`

### M27 Monitoring: DONE / PARTIAL, P3
| Feature | Status |
|---|---|
| ONU status, Rx, history, alarms, device and received times, live/stale/test, retention | DONE |
| OLT, PON and interface health | MISSING |
| Vendor or SNMP adapter | MISSING (push and file import only) |
| Reports page wording | DEFECTIVE: says "not built" |

- **Files:** `server/routes/monitoring.ts`, `shared/domain/monitoring*.ts`, `web/features/monitoring/*`, [MONITORING_ADAPTERS.md](MONITORING_ADAPTERS.md)

### M28 Fault impact: DONE (mostly), P3
| Feature | Status |
|---|---|
| Impact from recorded links, suspicions with confidence, no claims of a cut, recommended checks | DONE |
| Affected ports, cores and equipment listed downstream | PARTIAL |

- **Files:** `shared/domain/faultImpact.ts`, `faultCorrelation.ts`, `web/features/faults/*`

### M29 Administration and configuration: PARTIAL, P2
| Feature | Status |
|---|---|
| Optical, outside-plant, fault, monitoring and RF settings with a source; colour schemes; settings permissions | DONE |
| Editable types, statuses, cable types, connection types, ratios, icons, layer settings | MISSING (`enums.ts`) |
| Naming and id rules, custom attributes | MISSING |
| Settings audit written by the server | MISSING |

- **Files:** `web/features/settings/*`, `shared/domain/*Settings.ts`

### M30 Reports: PARTIAL (9 of 18), P2
| Status | Reports |
|---|---|
| DONE | Equipment inventory, cable length, core use, splitter/PON, data quality (counts) |
| PARTIAL | Pole attachment, customer path, validation, capacity |
| MISSING | Cable inventory, OSP, duct occupancy, splicing, ODF port, orphan, disconnected cable, planned against built, change history; Excel; generated PDF |

- **Files:** `shared/domain/reports.ts`, `web/features/reports/*`

### M31 Security and audit: PARTIAL, P0/P1
| Feature | Status |
|---|---|
| Rules enforced on the server | DONE (when login is on) |
| Roles | PARTIAL: 5 of 8 (no Super Admin and Network Admin split, GIS Engineer, Planner, NOC, Supervisor) |
| Permissions | PARTIAL: create, update and delete per collection, plus system actions; no move, connect, disconnect, allocate, deallocate, approve, export or configure |
| Audit trail | PARTIAL: written by the browser |
| Tenant isolation | MISSING |

- **Files:** `server/auth/access.ts`, `shared/domain/access.ts`, `server/routes/auth.ts`

### M32 Performance and reliability: PARTIAL, P1 for scale
| Feature | Status |
|---|---|
| Timeouts, retries, logging, health check, manual backup | DONE |
| Viewport culling and clustering | DONE (browser only) |
| Spatial index, area queries, paging, simplification, vector tiles, background jobs, incremental sync, scheduled backup | MISSING |
| Whole network in browser memory | YES (against the prompt) |

- **Files:** `server/routes/network.ts`, `server/db/sqliteRepository.ts`, `server/lib/linkGuard.ts`, `web/stores/networkStore.ts`, `web/api/syncEngine.ts`

### M33 Workflow tests: PARTIAL, P1
Tests are unit and API tests. Browser walkthroughs were run as scratch scripts and are not kept in the repo.

| Workflow | Coverage today |
|---|---|
| A Basic equipment | Unit tests plus earlier walkthroughs; no persistence test in the repo |
| B Cable mapping | Unit tests; no route editing to test |
| C OSP | `outsidePlant`, `ospActions` |
| D Core management | `fiberCommands` / `fiberRules` tests |
| E Splicing | `splices` |
| F ODF | PARTIAL: no rack or pigtail to test |
| G FTTH | `oltToCustomer`, `provisioning`, `connections` |
| H Topology | `fiberPath`, `opticalPathTrace` |
| I Validation | Server guard tests; no geometry rule tests |
| J Security | `security`, `phase9`, `access` |
| K Import/export | `kmlImport`, `kml` |
| L Performance | MISSING |

### M34 Implementation phases
See [NETWORK_MAPPING_IMPLEMENTATION_PLAN.md](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md).

### M35 Project documentation: PARTIAL, P2
| Status | Documents |
|---|---|
| Exist now | NETWORK_MAPPING_AUDIT, NETWORK_MAPPING_FEATURE_MATRIX, NETWORK_MAPPING_IMPLEMENTATION_PLAN (this audit), DEPLOYMENT_GUIDE |
| Partly covered | FIELD_MAPPING_GUIDE (by FIELD_WORKER_GUIDE), SECURITY_AND_PERMISSIONS (by AUDIT_REPORT §12) |
| Missing | GIS_ARCHITECTURE, EQUIPMENT_CATALOGUE, ASSET_MANAGEMENT, OSP_ENGINEERING, FIBRE_CABLE_ENGINEERING, FIBRE_CORE_MANAGEMENT, SPLICING_ENGINEERING, ODF_PATCH_MANAGEMENT, OLT_PON_ENGINEERING, SPLITTER_MANAGEMENT, CUSTOMER_FTTH_MAPPING, PHYSICAL_CONNECTIVITY, NETWORK_TOPOLOGY, NETWORK_TRACE_GUIDE, NETWORK_VALIDATION, OPTICAL_BUDGET_GUIDE, CAPACITY_PLANNING, DATABASE_SCHEMA, API_DOCUMENTATION, NETWORK_MAPPING_TEST_PLAN, CHANGELOG |

Each missing document is written in the phase that builds its subject (see the plan).

### M36 Initial audit response
Done: [NETWORK_MAPPING_AUDIT.md](NETWORK_MAPPING_AUDIT.md).
