# Network mapping master audit

**Date:** 10 November 2026
**Scope:** the whole repository, checked against `FiberGIS_Ultimate_Network_Mapping_Master_Prompt.md`, Modules 1 to 36.
**Method:** read-only. The code was read file by file. Nothing was built, run, migrated or changed for this audit, and no source file was modified. The only files written are the three documents below.

Companion documents:
- [NETWORK_MAPPING_FEATURE_MATRIX.md](NETWORK_MAPPING_FEATURE_MATRIX.md): status of each module, with files, API, database, missing work, priority and dependencies.
- [NETWORK_MAPPING_IMPLEMENTATION_PLAN.md](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md): the phase-by-phase roadmap.

Earlier audits remain valid where they agree with this one: [AUDIT_REPORT.md](AUDIT_REPORT.md) (7 Nov) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (phases 1 to 9, all built). One statement in `AUDIT_REPORT.md` is now out of date: clustering and drawing only what is in view do exist (see 2.1).

**Status words used throughout**

| Word | Meaning |
|---|---|
| DONE | Works end to end: screen, shared rule, server check, saved data |
| PARTIAL | Some of it works; what is missing is listed |
| UI-ONLY | A screen exists, but nothing is saved or enforced behind it |
| BACKEND-ONLY | The server supports it, but no screen uses it |
| DEFECTIVE | Exists, but gives a wrong result in a stated case |
| MISSING | Nothing in the code |

**Working tree note.** The voice and learning assistant files (Stages 1 and 2) are present and uncommitted on `main`. This audit did not touch them.

---

## 1. Current architecture

| Layer | What is there | Where |
|---|---|---|
| Repository | npm workspaces monorepo: `apps/web`, `apps/server`, `packages/shared`. 61 test files | root `package.json` |
| Frontend | React 18.3, TypeScript, Vite 6, Tailwind 4, zustand 5 stores, react-router 7. Two apps share one build: the office app and the phone capture app (`features/capture/CaptureApp.tsx`) | `apps/web/src` |
| GIS library | Leaflet 1.9, driven by the app's own layer components rather than react-leaflet. Supercluster for clustering. Tiles: Google streets, Google hybrid, OpenStreetMap | `apps/web/src/features/map/leaflet/*` |
| Map rendering | Panes in a fixed order. Cables, pins and customers are drawn only inside the current view. Pins cluster below zoom 16 once there are 300 or more. Spans, ducts and slack loops are always drawn | `GISMap.tsx`, `CableLayer.tsx`, `EquipmentLayer.tsx`, `OspLayer.tsx`, `clustering.ts` |
| Shared domain | zod schemas for every record, plus pure commands and rules (fiber, connections, outside plant, RF, monitoring, faults, provisioning, traces, loss, reports, access). The browser and the server run the same rules | `packages/shared/src/model`, `packages/shared/src/domain` |
| Backend | Fastify 5 with cookie, cors, helmet, rate-limit and static plugins; zod 4; pino logs with secrets redacted | `apps/server/src` |
| Database | SQLite through `node:sqlite`. One `records` table holds each record as JSON, keyed by collection and id, with a `version` column. Extra tables: `users`, `sessions`, `monitoring_tokens`, `voice_clips`. `PRAGMA user_version` is 1. There is no spatial index. Geometry is stored as `[lat, lng]` arrays in WGS84 | `apps/server/src/db/sqliteRepository.ts` |
| Collections | 30: equipment, cables, splitters, closures, customers, faults, workOrders, auditLogs, zones, documents, catalog, gpsRoutes, agentTrips, settings, spans, attachments, ducts, slackLoops, permissions, onts, services, buildings, alarms, syncConflicts, rfElements, rfLinks, rfLevels, monitoringSources, onuReadings, onuStatuses | `packages/shared/src/model/collections` |
| API | REST under `/api/v1`. Generic `GET/PUT/DELETE /:collection/:id` with `If-Match` versions. `POST /changes` applies one atomic change set after schema, access and link checks. `GET /network` returns every collection with a revision number. Also `/auth/*`, `/users`, `/backup`, `/restore`, `/reset`, `/monitoring/*`, `/photos/:id`, `/reports/data-quality`, `/routing/route` (OSRM), `/voice/*`, `/health` | `apps/server/src/routes/*` |
| Write path on the server | (1) zod schema for the collection, (2) role rules (`checkChangeAccess`), (3) record version if sent, (4) domain rules in `changeSetGuard`: outside plant, fiber, connections, faults, RF, monitoring. Only errors block a write; warnings pass | `routes/collections.ts`, `auth/access.ts`, `lib/linkGuard.ts` |
| Sync | The browser loads the whole network. It polls every 30 s and downloads the full snapshot again when the revision changes. Offline office edits are queued in localStorage. Field captures are queued in IndexedDB. Timeout 15 s, retries back off from 2 s to 30 s, version conflicts go to `syncConflicts` | `apps/web/src/stores/networkStore.ts`, `apps/web/src/api/syncEngine.ts` |
| Auth | Sessions in cookies, 5 roles (admin, engineer, office, technician, viewer). Setup mode with every rule off, allowed only from loopback before the first user exists. Login rate limiter | `apps/server/src/auth/*`, `packages/shared/src/domain/access.ts` |
| Deployment | One Node process serves the API and the built web app. HTTPS through a reverse proxy, which phones need for camera and GPS. Offline app shell from a service worker. Manual backups (JSON or zip), with a safety copy taken before any restore or reset | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) |

---

## 2. Existing network mapping features (verified)

"Verified" means the code path was read from the screen to the saved record and the server check. Browser walkthroughs for phases 1 to 9 ran earlier (7 and 8 November); they were not rerun for this audit. The last full test run (9 November, including the uncommitted voice work) passed: web 237, server 94, shared 372.

### 2.1 Map and GIS
- **DONE:** pan and zoom; GPS position with an accuracy circle and a warning above 80 m; distance measure; status styling; tooltips; selection halos; clustering; drawing only what is in view; KML/KMZ import of points and lines (polygons are skipped and reported); KML export; GeoJSON export of equipment and cables.
- **PARTIAL:**
  - Search covers names and ids only, in the browser.
  - Zoom to an item centres on one point; nothing fits the item's bounds.
  - "Reset view" flies to a fixed Bangalore point.
  - Labels appear only on equipment, from zoom 17.
  - Snap uses a fixed 30 m radius at every zoom.
  - Undo is browser-only, keeps 50 steps, and is cleared when another user's change arrives.
- **MISSING:** fullscreen, scale bar, north arrow, cursor coordinates, area measure, print or map export, context menu, multi-select, box or lasso select, layer reorder or styling, saved views, address search, editing cable vertices, split and merge. Zone polygons are never drawn.

### 2.2 Equipment and outside plant
- **DONE:**
  - Placing equipment by click, by dragging from the palette, or by phone GPS.
  - Dragging equipment, with the ends of connected cables following.
  - Pole details, cables on a pole, and spans with a status and a basis.
  - Attachments linking cables to spans.
  - Ducts with ways, subducts and occupancy, plus a server link guard.
  - Slack loops.
  - Buildings with entry equipment, a riser, floor boxes and units.
  - Right-of-way permissions.
  - A "same one?" duplicate warning when placing (browser only).
- **PARTIAL:**
  - No general edit form for equipment: a FAT's make or serial cannot be changed after placement.
  - The catalogue is a TypeScript list plus custom items holding only a type, name and port count.
  - Span lines are always straight.
  - Depth and owner of a duct cannot be edited.
  - A building footprint is a point.

### 2.3 Cables
- **DONE:**
  - Drawing a cable, then confirming its proposed end connections.
  - Three separate lengths: drawn length, sheath marks and OTDR length, with mismatch warnings.
  - Tube and fiber layout with a colour scheme (absent means unknown).
  - Cables in ducts and on spans.
- **PARTIAL:** the cable form is a single screen, not a stepwise wizard, and there are 7 cable types and 5 install methods.
- **MISSING:** route editing, a cable segment entity, and a duplicate-route check.

### 2.4 Fiber, splicing, ODF, OLT, splitters
- **DONE:**
  - Assigning and releasing cores, with a stated use and history; the server refuses two assignments on one core.
  - Closures with trays; splices with loss, its source, the technician and an OTDR reference.
  - ODF panels and ports from 1 to 288; ODF feeder cores; patches to PON ports. The server refuses two patches, a patch to a missing PON and a patch plus a direct feed.
  - OLT setup: make, model, serial, IP, firmware, PON ports with technology, `maxOnu` and feeder core.
  - PLC and FBT splitters with cascades and loss per output. The server refuses overflow, duplicate ports and two customers on one output.
- **PARTIAL:**
  - Tubes are not records.
  - No cassettes, splice positions or pigtails.
  - Racks and sites are plain text.
  - OLT cards are plain text.
  - PON port counts are limited to 4, 8, 16 or 32.

### 2.5 Customers and services
- **DONE:**
  - Customer, ONT (the server refuses a duplicate serial), service and building unit links.
  - Fiber-by-fiber customer trace.
  - ONT swap history; disconnect releases everything and keeps history; moving a customer keeps history.
- **PARTIAL:** the customer's path is stored twice, once as fields on the customer and once as fiber links, and the server does not check that they agree.

### 2.6 Traces, validation, optical budget
- **DONE:**
  - 9 trace kinds: customer to PON, core to PON, PON tree, service topology, equipment to OLT, cable to OLT, building units, fault impact and the cable TV RF tree.
  - A gap in a trace is shown as a gap, never filled in.
  - About 130 map-check rules with error, warning and note levels.
  - A loss budget with fiber, splitter, splice and connector parts, a stated length basis, editable limits, and the difference between estimate and reading.
- **PARTIAL:**
  - Only the cable-level trace highlights on the map.
  - The data-quality page shows counts and up to 5 ids, with no location and no fix text.
  - A budget verdict is still given when an optics class has defaulted.

### 2.7 Cable TV / HFC
- **DONE:** headend, CMTS, transmitter, EDFA, node, amplifier, tap, RF splitter, modem and STB as RF elements.
- **DONE:** RF links with server rules for direction, light into an RF port, two feeds, a reused port and loops.
- **DONE:** RF tree and upstream trace; RF levels with unit, origin and test-point offset; a meter photo is required from technicians.
- **PARTIAL:** RF elements are not drawn on the map; they sit on an equipment pin.

### 2.8 Field survey, monitoring, faults
- **DONE:**
  - Phone capture of poles, boxes, drops, light readings and hazards, with GPS samples, accuracy and method, QR scanning, photos and an offline queue.
  - "Office must place this" when there is no GPS fix.
  - Bike route recording.
  - Monitoring of ONU status and Rx from file import, push and test sources, with device time, received time, live/stale/test labels and alarms.
  - Fault impact following recorded links only, ranked suspicions with confidence, and recommended checks.
- **PARTIAL:** survey records go straight into production as `Active`, with no review step.

### 2.9 Admin, security, reports
- **DONE:**
  - Optical, outside plant, fault, monitoring and RF settings, each with a source.
  - Custom fiber colour orders.
  - Role checks on the server.
  - Safe CSV export that guards against formula injection.
  - Backup and restore with a safety copy.
- **PARTIAL:**
  - 5 of the 8 requested roles.
  - The audit log is written by the browser.
  - 9 of the 18 requested reports.
  - No Excel export and no generated PDF.

---

## 3. Full feature coverage matrix

See [NETWORK_MAPPING_FEATURE_MATRIX.md](NETWORK_MAPPING_FEATURE_MATRIX.md). Summary:

| Status | Modules |
|---|---|
| Mostly DONE | 12 Splitters, 13 Customers, 14 HFC/CATV, 22 Optical budget, 27 Monitoring, 28 Fault impact |
| PARTIAL | 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 15, 16, 17, 19, 20, 21, 23, 24, 25, 26, 29, 30, 31, 32, 33, 35 |
| MISSING (no real entity) | 7 Cable segments, 18 Multi-select and context menu |
| Process modules | 34 is the plan; 36 is this audit |

---

## 4. Missing features

Grouped by kind. Each line names its module.

### 4.1 Missing
- **GIS workspace (M1):** scale bar, north arrow, cursor coordinates, fullscreen, area measure, print layout, map export, drawing zone polygons, vertex edit, split, merge, extend, trim, reverse, duplicate.
- **Interactions (M2, M18):** layer reorder, styling, label rules, saved views and presets, layer counts and metadata; multi-select, box and lasso select, select by attribute or area, context menu.
- **Catalogue and assets (M3, M4):** a product model catalogue (manufacturer, model, specs, port templates, lifecycle, datasheets); a `catalogModelId` on deployed assets; a general asset edit form; warranty, maintenance and condition fields; a per-asset history tab.
- **Cables and segments (M6, M7):** fibre standard, mode, sheath, diameter; a cable segment entity; mixed install methods along one cable.
- **Tubes and cores (M8):** a tube entity; tubes of different sizes; marking a core faulty or repaired; an override with a reason; core search; splice history per core.
- **Splicing and ODF (M9, M10):** cassettes, splice positions, pigtail termination, a printable splice report; rack and site entities; marking an ODF port faulty.
- **OLT (M11):** chassis, shelf, slot and card entities.
- **Connectivity (M15):** a single connection model with verification, technician and evidence on every link.
- **Topology and trace (M16, M17):** a logical service layer (VLAN, service binding); trace from a closure, splice or ODF port; a trace between two chosen points; a trace report download; an "unverified link" state.
- **Validation (M21):** self-intersection, extra vertices, gaps, assets outside the service area, duplicate cable routes; a resolution workflow with stored findings.
- **Capacity (M23):** ODF, duct and pole utilisation reports; spare and shortage; expansion and forecasting.
- **Change management (M24):** change requests with review, approval and verification; stored record revisions; before/after comparison.
- **Survey (M25):** barcodes; inspection checklists; a review queue between survey and production.
- **Import (M26):** CSV, Excel, Shapefile and GeoJSON import; field mapping; rollback by `importId`; import history.
- **Monitoring (M27):** OLT and PON level status; a vendor or SNMP adapter.
- **Admin (M29):** editable lists of equipment types, cable types, statuses, connection types and splitter ratios; naming and id rules; custom attributes.
- **Reports (M30):** cable inventory, OSP, duct occupancy, splicing, ODF port, orphan, disconnected cable, planned vs existing, change history; Excel; generated PDF.
- **Security (M31):** Super Admin, Network Admin, GIS Engineer, Network Planner, NOC Operator and Supervisor roles; move, connect, disconnect, allocate, deallocate, approve, export and configure permissions; tenant isolation.
- **Performance (M32):** server paging; queries by map area; a spatial index; incremental sync; scheduled backups.
- **Tests (M33):** browser end-to-end tests in the repo, plus capacity, change and validation workflow tests.
- **Docs (M35):** 21 of the 27 listed documents.

### 4.2 Partial
Search scope (M19); inventory tables without sort, paging or bulk edit (M20); the single-screen cable form (M6); span geometry (M5); building footprint (M5); OLT port counts (M11); customer path stored twice (M13); map highlight for fiber traces (M17); budget with defaulted inputs (M22); the audit log (M24, M31); per-record history (M24); the catalogue (M3).

### 4.3 Defective
| Defect | Evidence |
|---|---|
| Documents attached to a pole, manhole, ODF or `DROP-` cable lose their link without warning | `apps/web/src/features/documents/DocumentManagerModal.tsx:61-62` links only ids starting with `OLT`, `FAT` or `CBL` |
| Inventory shows an invented install date and invented port use | `apps/web/src/features/inventory/EquipmentInventoryView.tsx:311` (`'2026-01-15'`), `:241-242` (FAT 5/8, FDT 24/48) |
| A new zone gets an invented square boundary and 2.5 km² | `packages/shared/src/domain/records.ts:36-51` |
| Inventory CSV breaks on a name containing `"` | `EquipmentInventoryView.tsx:82` |
| The "Aerial" and "Underground" layer toggles filter by cable type, not by install method | `apps/web/src/features/map/layerFilters.ts:7` |
| The Reports page says monitoring and cable TV are "not built" | `packages/shared/src/domain/reports.ts:328` (`liveReport`) |
| An older Allocate button marks a core In Use with no assignment record | `apps/web/src/features/map/BottomInfoPanel.tsx:298` → `cables.ts:251` |
| "Search model" in Inventory does not search model or serial | `EquipmentInventoryView.tsx:32-39` |

### 4.4 UI-only
- Layer settings are kept in the browser only.
- The "Attribute table" shows only the selected cable's cores.
- Duct use per duct appears in the inspector, with no report.

### 4.5 Backend-only
- Single-record `PUT /api/v1/:collection/:id`. It is checked, but no bulk import endpoint uses it.

---

## 5. Technical gaps

### Architecture
- **The whole network lives in the browser.** `GET /network` returns every collection, and each revision change downloads all of it again. Fine for a town; it will not scale to a city.
- **Connections are fields scattered over about 8 record types**, not one connection model: splices, ODF rear and patch, PON feeder core, splitter input and outputs, customer drop and core, cable ends, logical ports, core `connectedTo*`. Each kind has its own commands and rules, so verification and history cannot be shared.
- **Two trace engines can disagree.** `trace.ts` follows cable ends and the customer's fields; `fiberPath.ts` follows fiber links. The map highlight uses the first.

### Database
- **JSON records in one table, no spatial index.** Queries by map area are impossible without reading everything.
- **Old versions are overwritten.** The `version` column catches conflicts but keeps no history.
- **Hard-coded lists** in `enums.ts` (types, statuses, ratios), where the prompt wants them editable.
- Any new table or column needs your approval first (standing rule).

### API
- **No paging and no map-area query.** `GET /:collection` returns everything.
- **No bulk import endpoint.**
- **Most writes read whole collections.** `/changes` touching links, fiber, faults or RF reads up to 13 whole collections inside the write transaction.
- **A plain upsert without `expect` overwrites the whole record.** Older clients get last-write-wins.

### GIS
- **Accepted bad geometry:** cable `coordinates` has no `.min(2)` (`schemas.ts:482`). Equipment may sit at 0,0.
- **No editing of a route** after it is drawn.
- **No polygons on the map.**
- **Fixed snap radius.** Snapping is an aid, not a link, but at low zoom it can still land a vertex on the wrong pole.
- **Unplaced captures look placed.** The main map draws captures waiting for "office must place" like real pins.

### Performance
- **The client cluster index is rebuilt on every equipment change.**
- **Traces repeat linear scans at every hop** (about 41 `.find`/`.filter` calls in `trace.ts`).
- **Offline office edits rewrite whole collections into localStorage** (about 5 MB limit; a failed write is reported).
- **No scheduled backups.** No background job runner.

### Security
- **5 roles, not 8, and no action-level permissions.** CSV export is not permission-gated.
- **The audit log is written by the browser.** A direct API write that adds no audit entry leaves no trail.
- **Customer name, address and GPS are visible to every role.** Only the mobile number is hidden, and only from Viewer.
- **No tenant isolation.**
- *Corrected 10 Nov:* an earlier draft said a restore skips the fiber, connection and RF rules. It does not. The restore route checks all of them (`apps/server/src/routes/network.ts:127`, `newRestoreProblems`). The comment on the unused `replacementGuard` in `linkGuard.ts` is out of date.

### Business logic
- **Survey to production with no review.** Captures go straight in as `Active`.
- **The server map check ignores the operator's own limit settings** and uses `DEFAULT_LIMITS`.
- **Damaged cores are only warned on the server.** A damaged core can be assigned or spliced through the API.
- **A splice "entered by mistake" is hard-deleted.** Only the audit line remains.
- **Optical budget results are never stored** with a timestamp.

---

## 6. Data integrity risks

All verified in code unless marked *assumed*.

### 6.1 Duplicate assets
1. **Duplicate checks run only in the browser.** The "same one?" check is advisory (`ospActions.ts:78-110`, `outsidePlant.ts:140`). The REST and `/changes` APIs accept a second pole in the same place.
2. **Re-importing a KML file adds everything again.** Each import makes fresh random ids, so the id-clash guard (`kmlImport.ts:365-367`) never fires. Points within range are held back, but cables and ducts are added again.
3. **Palette placements share one name.** Every non-pole item placed from a palette template gets the same catalogue name (`EquipmentToolbox.tsx:263`).
4. **No duplicate check for cables.** `createCable` checks only the id (`cables.ts:41`). There is no geometry or endpoint duplicate check.
5. **Slack loops exist twice:** as the equipment type "Fiber Slack Loop" and as the `slackLoops` collection.

### 6.2 Lost geometry
1. **Moving a pole moves only cable ends.** Cable vertices that pass through it, duct geometry and slack-loop positions stay put (`equipment.ts:113-163`). The drawn length is recomputed by design (`schemas.ts:503-507`), so no recorded length is lost.
2. **A straight line is drawn when nothing was drawn.** This happens in the cable wizard and "Connect what feeds this" (`CableWizardModal.tsx:117-125`). The line looks like a real route.
3. **The server accepts a cable with 0 or 1 points.**
4. **KML import drops altitude and polygons** by design. The skip report says so.

### 6.3 Invalid connections
1. **The API can assign or splice a damaged core.** It is refused in the browser and only warned on the server (`fiberRules.ts:162`).
2. **Splice direction is assumed, never checked.**
3. **A cable not recorded at a closure** can be spliced there, with only a warning.
4. *Corrected:* a restore cannot bring bad fiber, connection or RF links back without the person accepting the listed problems (see 5, Security).

### 6.4 Conflicting core allocations
1. **The older Allocate button** (`BottomInfoPanel.tsx:298` → `allocateCore`, `cables.ts:251`) marks a core In Use with no assignment record. A later `assignCore` cannot see the conflict.
2. **Reserved cores can be handed out again.** `assignCore` does not refuse a core marked Reserved without an assignment (cores reserved in the cable wizard).
3. **Physical links never check the core's assignment.** An ODF feeder, splice or splitter input on a core proceeds regardless; `markServingCores` only notes the conflict (`provisioning.ts:571,594`).
4. **An ODF feeder does not mark its core used.**

### 6.5 Incorrect port assignments
1. **Three separate port status records** can disagree: `logicalPorts` (`PortManagerModal.tsx:86`), `ponPorts`, and ODF port status.
2. **`connectedCustomersCount` is a running counter.** It moves up and down (`connectionCommands.ts:500,714`) instead of being counted from records, so it can drift.
3. **PON counts are limited to 4, 8, 16 or 32** (`OltConfigModal.tsx:146,661`). Another real OLT cannot be recorded truthfully.
4. **The OLT setup screen creates splitter records** as a side effect (`OltConfigModal.tsx:356`).

### 6.6 Broken topology
1. **The two trace engines can disagree** (see 5).
2. **A remote change wipes undo history**, so a mistake cannot be undone once someone else saves.
3. **Last-write-wins** for clients that do not send versions.
4. **Hard-deleted splices** leave a gap with only an audit line.

### 6.7 Orphaned records
1. **Deleting equipment can orphan cable ends.** The server never checks `startEquipmentId` or `endEquipmentId` (no match in `apps/server/src`). A `DELETE /api/v1/equipment/:id` can leave cables pointing at nothing. The "connected cables block delete" rule is browser-only (`equipment.ts:208`).
2. **Documents silently lose their asset link** (4.3).
3. **Customer path fields can name a missing OLT, splitter or box.** The server accepts them.
4. *Assumed:* a corrupt localStorage collection falls back to the sample data (`networkStore.ts:235`). The reconcile logic suggests the server copy wins, but this was not traced to the end.

### 6.8 Inconsistent customer paths
1. **The path is stored twice** (customer fields and fiber links), and so is splitter output ownership (`splitter.outputPorts.connectedCustomerId`). A disagreement is only a trace warning (`fiberPath.ts:582-587`).
2. **The customer wizard still offers drop fiber 1 by default** (open since `AUDIT_REPORT.md` §12).
3. **Missing splitter losses are dropped silently.** The budget leaves out `unknownSplitters` from the total and never shows them.

---

### 6.9 Status after Phase 0B (10 November)
This audit describes the code before Phase 0B. Phase 0B, approved on 10 November, closed these risks:
- 6.7.1: equipment that cables end at can no longer be deleted.
- 6.4.1 and 6.4.2: the older Allocate button is gone, and a held core must be released before it is reused.
- The broken items in 6.2.2, 6.2.3, 6.7.2, 6.7.3 and 6.8.2.

What changed, and what was left on purpose, is in the Phase 0B completion report in [NETWORK_MAPPING_IMPLEMENTATION_PLAN.md](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md).

---

## 7. Implementation roadmap

See [NETWORK_MAPPING_IMPLEMENTATION_PLAN.md](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md). It follows the 25 phases of Module 34 (0 to 24), with one justified change: a short **Phase 0B, data-integrity hardening**, runs before Phase 1, because the risks in section 6 would corrupt the new features built on top of them.

---

## 8. Approval gate

No source code was changed during the audit. Nothing in the plan starts until you approve it, one phase at a time. (Phase 0B was approved afterwards and is done; see 6.9.) Any new database table or column, new dependency, commit, push or deployment needs its own approval.

NETWORK MAPPING MASTER AUDIT COMPLETED. No source code files have been modified. All identified gaps and implementation phases are documented. Waiting for explicit user approval before implementation.
