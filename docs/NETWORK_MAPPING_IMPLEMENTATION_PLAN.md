# Network mapping implementation plan

**Date:** 10 November 2026
**Status:** proposed. Nothing in this plan has been started.
**Based on:** [NETWORK_MAPPING_AUDIT.md](NETWORK_MAPPING_AUDIT.md) and [NETWORK_MAPPING_FEATURE_MATRIX.md](NETWORK_MAPPING_FEATURE_MATRIX.md).

The plan follows the 25 phases (0 to 24) in Module 34 of the master prompt, with one change: **Phase 0B, data-integrity hardening,** is added before Phase 1. The reason is that the risks in audit section 6 would corrupt everything built on top of them. One example is cable ends that can be orphaned through the API. Another is cores that can be handed out twice.

## Rules for every phase

1. **Approval.** Each phase starts only after you approve that phase. Approving one phase does not approve the next.
2. **Separate approvals.** Each of these needs its own approval: a new database table or column, a new dependency, a commit, a push, a deployment.
3. **No replacing working features.** A working feature is only replaced when the phase says so and you have agreed.
4. **The FiberGIS project rules apply.** Never invent a value. Never link things because they are near each other. Show gaps honestly. Errors are only for impossible or broken data; everything else is a warning with a logged override. Thresholds live in settings, not in code. Field screens follow the easy-field rules.
5. **Storage.** New record types are added as new collections in the existing `records` table. That needs no SQL change, but it is still listed under "Database" so you can see it. Real SQL changes (new tables, columns, indexes) are marked **SQL: approval**.
6. **Server first.** Every new rule is enforced on the server (`changeSetGuard`) and not only in the browser.
7. **Done means.** A phase is finished only when these all pass: typecheck, lint, the unit tests, the server tests, and a browser walkthrough of its workflow on a test server (port 5055, temporary database). The real database is never used for testing.

### Completion report (written at the end of every phase)
- What was built, with file links.
- Tests added, and the full test results.
- The walkthrough result, with screenshots kept in the scratchpad.
- Database changes.
- Known gaps left, and risks found.
- Documents written or updated.
- Confirmation that nothing outside the scope was changed.

**Complexity scale:** S is up to 2 days, M is 3 to 5 days, L is 1 to 2 weeks, XL is more than 2 weeks.

---

## Phase 0: Repository and requirements audit (DONE)
| Item | Detail |
|---|---|
| Scope | Read-only audit of all 36 modules |
| Result | The three `NETWORK_MAPPING_*` documents |
| Code changed | None |

## Phase 0B: Data-integrity hardening (S to M, P0) — DONE 10 November 2026
The table below is the plan as approved. What was built, and where it changed from the plan, is in the completion report after it.

| Item | Detail |
|---|---|
| Scope | Close the verified risks in audit section 6 before any new feature |
| Prerequisites | Your approval |
| Backend | Server rules in `fiberRules.ts`, `connectionRules.ts`, `linkGuard.ts` (listed below) |
| Restore | `restoreCheck.ts` / `linkGuard.ts` `replacementGuard` checks fiber, connection and RF rules, not only outside plant |
| Frontend | Remove or redirect the older Allocate button (`BottomInfoPanel.tsx:298`) |
| Frontend | `DocumentManagerModal.tsx`: link by the chosen record, not by id prefix |
| Frontend | `EquipmentInventoryView.tsx`: show "Not recorded" in place of invented dates and port use, and escape CSV quotes |
| Frontend | Customer wizard: no preselected drop fiber |
| Frontend | Stop the straight-line fallback in the cable wizard; ask the person to draw a route instead |
| Shared | `assignCore` refuses Reserved cores that have no assignment, unless the person confirms with a reason |
| Shared | `cableSchema.coordinates` requires at least 2 points, with a migration note for old records |
| Shared | `records.ts` zones: no invented square or area |
| Database | None. Existing bad records are reported, never changed silently |
| API | Same endpoints; new error codes |
| UI | Plain error text that says what to do next |

**Server rules added in this phase:**
1. A cable end must point to existing equipment. Deleting equipment that cables still use is refused.
2. A cable needs at least 2 points.
3. A damaged core cannot be assigned or spliced without an override reason.
4. A customer's path fields must name existing records.

**Business rules:** no silent repair of existing data. A one-off read-only report lists existing records that break the new rules, so you can decide what happens to them.

**Tests:**
- A server test for each new rule: refused, and allowed with an override.
- A restore that contains bad links is refused.
- A document link survives on a pole.
- A CSV row with quotes stays intact.

**Acceptance:** every item in audit section 6 marked "verified" either has a server rule or has a written reason for leaving it.

**Risks:**
- Older records may now fail validation on edit. Mitigation: warn on old records, and block only new writes.

**Files affected:**
- `packages/shared/src/model/schemas.ts`
- `packages/shared/src/domain/fiberRules.ts`, `fiberCommands.ts`, `connectionRules.ts`, `restoreCheck.ts`, `records.ts`
- `apps/server/src/lib/linkGuard.ts`
- About 6 web files

### Phase 0B completion report

**Built**

New server rules in [fiberRules.ts](../packages/shared/src/domain/fiberRules.ts). They run on every write and restore, and in the browser's fiber and connection commands. Only problems a change *adds* are refused, so older records never block other work.

| Rule | Code | What it refuses |
|---|---|---|
| Cable ends | `cable_end_missing` | A cable start or end naming equipment (or a customer) that is not on record. So deleting equipment that cables still end at is refused, even straight through the API |
| One-point route | `cable_one_point` | A route of exactly one point. An empty route ("not drawn yet") is still allowed, because provisioning makes a drop with no route when the house location is unknown |
| Customer path | `customer_missing_ref` | A customer naming an OLT, box, splitter, or feeder, distribution or drop cable that is not on record |

Browser changes:

| Area | Change |
|---|---|
| Fibers ([fiberCommands.ts](../packages/shared/src/domain/fiberCommands.ts), [CoreSection.tsx](../apps/web/src/features/fiber/CoreSection.tsx)) | A fiber marked Reserved (or In Use) with no record of what for is not given away. The Fibers screen now says so and offers Release; before, it showed an assign form that could only fail |
| Bottom panel ([BottomInfoPanel.tsx](../apps/web/src/features/map/BottomInfoPanel.tsx)) | The older Allocate button is removed. It set In Use with no record and guessed the far-end equipment. The panel points to Fibers, which records the use |
| Documents ([DocumentManagerModal.tsx](../apps/web/src/features/documents/DocumentManagerModal.tsx)) | Linked to the record with that id, whatever its kind. An id that is not on record is refused in plain words |
| Inventory ([EquipmentInventoryView.tsx](../apps/web/src/features/inventory/EquipmentInventoryView.tsx)) | "Not recorded" instead of the made-up date and port use. CSV export now uses the shared safe writer (quotes escaped, formula cells guarded) |
| Customer wizard ([CustomerWizardModal.tsx](../apps/web/src/features/customers/CustomerWizardModal.tsx)) | The person chooses fiber 1 or 2 of the new drop; nothing is preselected |
| Cable wizard ([CableWizardModal.tsx](../apps/web/src/features/cables/CableWizardModal.tsx)) | With no drawn route, the straight line is announced before saving and noted in the cable's remarks |
| Zones ([records.ts](../packages/shared/src/domain/records.ts), [ZoneManagementView.tsx](../apps/web/src/features/zones/ZoneManagementView.tsx)) | No made-up square boundary, 2.5 km² area, or 1 feeder and 4 FATs. "Locate" says when no boundary is drawn |

**Changed from the plan, with reasons**

| Planned | Done instead | Why |
|---|---|---|
| Restore checks fiber, connection and RF rules | Nothing to build | It already does (`routes/network.ts:127`). The audit finding came from an out-of-date comment on the unused `replacementGuard` |
| A cable needs at least 2 points | Exactly 1 point is refused | An empty route is an honest "not drawn yet" that provisioning relies on |
| A damaged core needs an override to be assigned or spliced | Left as is: the browser refuses, the server warns | Project rule: block only physical impossibilities. A core marked damaged may have been repaired since |
| Cable wizard: no straight-line fallback | Fallback kept, announced and noted | "Draw a straight cable" is a working, labelled flow elsewhere; the fault was that this one was silent |
| A one-off report of existing records that break the new rules | Not needed | The data-quality report already lists them: `cable-end-missing`, `customer-link-missing`, `cable-no-route` |

**Database:** no schema or SQL change. A read-only check of a copy of the real database found 0 stored records that break the new rules, because it currently holds no network records.

**Tests**
- New:
  - 4 server tests (cable ends, one-point route, customer path, delete through the API).
  - 3 shared tests (held Reserved fiber, zone with no made-up values, zone keeps a drawn boundary).
- Updated:
  - 3 server tests that relied on writes the app itself refuses.
  - 1 shared fixture whose cables ended at ids that were not on record.
- Results:

  | Suite | Passed |
  |---|---|
  | Shared | 374 |
  | Server | 98 |
  | Web | 237 |

  Typecheck clean. Lint: no new errors; the files keep the errors they already had in the last commit.

**Walkthroughs** (temporary server on port 5055, temporary database)

| Walkthrough | Desktop | Phone |
|---|---|---|
| Main | 57/57 | 54/54 |
| Customer | 50/50 | 50/50 |
| Fiber | 44/44 | Not run |
| New Phase 0B screens | 14/14 | 14/14 |

No browser errors and no sideways scrolling. Screenshots are in the session scratchpad (`p0b-*.png`).

**Left open:** found while doing this phase, outside its scope.
- The inventory still shows `GPON` when an OLT has no technology recorded.
- The documents screen says "Download Started" and "Upload File", but stores metadata only.
- Zone counts are typed in, not counted from records (Phase 18).
- The comment on the unused `replacementGuard` is out of date.

## Phase 1: GIS foundation and layer management (L, P1) — DONE 10 November 2026
The table below is the plan as approved. The completion report after it says what was built and what changed.

| Item | Detail |
|---|---|
| Scope | M1 and M2 gaps that are not route editing (route editing is Phase 5) |
| Prerequisites | 0B |
| Frontend | Scale bar; cursor coordinates; fullscreen; fit to bounds; "reset" fits the real network extent; zone polygons drawn and editable; area measure; map print and PNG export |
| Frontend | Snap radius scales with zoom, and snapping is shown before it is accepted |
| Frontend | Layer show/hide, order, opacity, label rules and scale visibility per layer |
| Frontend | Layers built from attributes (`installationType`, cable function, status) instead of type text |
| Backend | Layer presets and saved views per user (a new `userViews` collection) |
| Database | New collection: userViews |
| API | Generic CRUD, limited to the owning user |
| UI | Legend with symbols and status; captures waiting for "office must place" get a distinct pin |
| Business rules | Snapping never sets a connection. A pin with no GPS fix is never drawn as a placed pin |
| Tests | Layer filter by attribute; snap radius by zoom; extent fit; owner-only access to user views |
| Acceptance | Workflow A walkthrough. Every M1 and M2 "MISSING" item is either built or deferred with a reason |
| Risks | The Google tile terms (audit M1). Ask you to choose a tile provider before this phase |
| Files | `features/map/*`, `stores/mapStore.ts`, `layerFilters.ts`, `shared/model/schemas.ts` |
| Docs | GIS_ARCHITECTURE.md |

### Phase 1 completion report

The full description is in [GIS_ARCHITECTURE.md](GIS_ARCHITECTURE.md).

**Built**

| Area | What it does now |
|---|---|
| Map controls | A scale bar on every screen. Pointer coordinates on screens with a mouse. **Show whole network** fits everything placed: no more fixed Bangalore point, and no 0,0 or unplaced pins stretching the view. Full screen covers the whole page, so dialogs still show. **Print map** prints the map alone with a dated caption: "Positions are as recorded in FiberGIS. Not a survey drawing." |
| Show on map | A cable or duct is fitted whole on screen, instead of being centred on its middle point |
| Snapping | Snaps within about 24 px on screen, capped at the old 30 m. A ring and the pin's name show before the point lands. Snapping still never connects anything |
| Layers from attributes | The Aerial and Underground switches follow the cable's recorded installation type. An aerial feeder is now hidden by "Aerial". Custom equipment types have an "Other equipment" layer, so they can be hidden |
| Layer panel ([AdvancedLayersDrawer.tsx](../apps/web/src/features/map/AdvancedLayersDrawer.tsx)) | Counts from the records. Show or hide, opacity, "show from zoom", name labels per equipment layer, label zoom, and the order pins stack in. Plain layer names: the made-up "96F Trunk", "24F ADSS", "1F/2F", "RG-11/RG-6" and "1:8 / 1:16" are gone. A legend drawn from the map's own styles. Saved views |
| Zones | Boundaries are drawn on the map as dashed shapes with their names. "Draw boundary on map" and "Redraw boundary" on the Zones screen. The drawn area is shown as "worked out from the drawing", beside the coverage typed in, which is kept. "Locate" fits the boundary |
| Measuring | With 3 or more points, the area of the closed shape is shown too |
| Unplaced captures | A capture with no good GPS fix is a dashed amber "?" pin, "Position not confirmed: the office must place this". A pin at 0,0 ("not recorded") is not drawn |
| OLT pin tooltip | Says "technology not recorded" instead of assuming GPON |

**Fixed along the way:** a bug that was already in the app before this phase. The layer panel opened behind the top bar and the map buttons: its header and Close button were covered, and the buttons sat on top of the panel. It now opens above them.

**Changed from the plan, with reasons**

| Planned | Done instead | Why |
|---|---|---|
| Saved views in a new server collection, owner-only | Saved views on the device, kept apart per signed-in account | A network collection would send every user's views to all users and into network backups and restores. A per-user server table needs a database change, which needs your approval first |
| Map PNG export | Not built | It needs a new library, which needs your approval |
| Choose a tile provider before this phase | Tiles left exactly as they were | Your decision is still open |
| Layer order for every layer | Order for equipment pins | Lines are drawn in fixed panes beneath pins, so their order rarely matters. Pin overlap is where order is seen |

**Database:** no change. Zone boundaries use the existing `boundaryCoords` field.

**Tests**
- New:
  - Shared: area, bounds and pixel scale.
  - Web: install-method layers, the "other" layer, zoom limits, snap distance, network extent, scale bar, route fitting, pin order, saved views, the zone boundary tool.
- Results:

  | Suite | Passed |
  |---|---|
  | Shared | 377 |
  | Server | 98 |
  | Web | 248 |

  Typecheck clean. No new lint errors.

**Walkthroughs** (temporary server on port 5055, temporary database)

| Walkthrough | Desktop | Phone |
|---|---|---|
| New Phase 1 | 24/24 | 20/20 (print and full screen are desktop only) |
| Main | 57/57 | 54/54 |
| Routes | 52/52 | 52/52 |
| Customer | 50/50 | 50/50 |
| Fiber | 44/44 | Not run |
| Phase 0B | 14/14 | Not run |

One customer run on desktop stopped early when the browser connection dropped during a long back-to-back run ("detached frame", 13 checks passed). It passed 50/50 when run again on its own. No browser errors and no sideways scrolling in any run. Screenshots are in the session scratchpad (`p1-*.png`).

**Left open**
- Lines (cables, spans, ducts) keep a fixed drawing order.
- Map PNG export (needs a library).
- Saved views on the server (needs a table).
- Licensed tiles (your decision).
- Fault and customer pins use their own toggles, but have no label settings.

## Phase 2: Equipment catalogue and asset inventory (L, P1) — DONE 10 November 2026
The table below is the plan as approved. The completion report after it says what was built and what changed.

| Item | Detail |
|---|---|
| Scope | M3 and the inventory half of M4 |
| Prerequisites | 1 |
| Shared | Product-model catalogue schema: manufacturer, model, product code, category and type, specs, port template, capacity, connectors, mounting, power, environment, datasheet document, image, lifecycle, custom attributes |
| Shared | `catalogModelId` on equipment. Specs are inherited from the model and can be overridden per asset, with the override marked |
| Backend | Seed the built-in models as records, marked as samples, never as real stock |
| Database | The `catalog` collection gets a new schema version. A migration step maps the old entries |
| API | Generic CRUD; `catalog` writes need the configure permission (Phase 23 defines it; until then admin only) |
| Frontend | Catalogue manager; a general asset edit form; inventory tables with sort and paging |
| UI | "Not recorded" for every missing value |
| Business rules | A model never fills in a serial number, owner or position |
| Tests | Model inheritance; override marking; migration of old catalogue entries; placing a custom item uses its port count |
| Acceptance | A FAT's make and serial can be edited; a custom model places with its own ports |
| Risks | Migration of the existing `catalog` records. Do a dry run first |
| Files | `features/catalog/*`, `features/inventory/*`, `shared/model/schemas.ts`, `shared/domain/equipment.ts` |
| Docs | EQUIPMENT_CATALOGUE.md, ASSET_MANAGEMENT.md |

### Phase 2 completion report

The full descriptions are in [EQUIPMENT_CATALOGUE.md](EQUIPMENT_CATALOGUE.md) and [ASSET_MANAGEMENT.md](ASSET_MANAGEMENT.md).

**Built**

| Area | What it does now |
|---|---|
| Product models | A catalogue entry can hold manufacturer, model, product code, port count, connector, lifecycle, spec lines, where the specs came from, and a linked datasheet. Every new field is optional; blank means not recorded |
| Catalogue rules ([catalog.ts](../packages/shared/src/domain/catalog.ts)) | Make and model come both or neither. No second entry for the same make and model. No spec listed twice. Valid port count |
| Server rules | An item must not name a model that is not on record. A model that items still use cannot be deleted. Restores report these too |
| Who may change it | Engineers and the administrator, the same people who change settings. The browser says so before trying; the server refuses it |
| Placing ([placement.ts](../apps/web/src/features/map/placement.ts)) | Every picker (catalogue dialog, toolbox, toolbar, drag onto the map) uses one template. The kind and port count, plus for a model its make, model and link. **No item takes the catalogue name any more** (each gets its own, such as "FAT-02"), and no product description is copied into notes. A custom entry's port count is now used when placing; before, it was dropped |
| Catalogue dialog ([ComponentCatalogModal.tsx](../apps/web/src/features/catalog/ComponentCatalogModal.tsx)) | "Place on map" and "Product models and kinds": add, change and remove entries, each showing how many items use it |
| Edit details ([AssetSections.tsx](../apps/web/src/features/inspector/AssetSections.tsx)) | A general edit form for every item: name, catalogue model, make, model, serial, tag, status, install date, area, street, notes. A FAT's make and serial can now be changed. Choosing a model fills in the make and model in the form before saving, never the serial |
| Specs on an item | Lines from the model, lines changed for this item (with the model's value beside them), and lines for this item only. Change, set back, or add |
| Equipment list | Search by make, model, serial and tag (the box said "model" before but did not search it). A make and model column. Sort by name, kind, make and model, status or install date, with "not recorded" last. 50 per page |
| Nothing made up when creating | A new item no longer gets the placing day as its install date, or "Created via GIS visual mapping toolbar" as notes |

**Changed from the plan, with reasons**

| Planned | Done instead | Why |
|---|---|---|
| Seed the built-in models as sample records | Built-in kinds stay in code, read-only | Seeding would write into the real database at start-up, and they are generic kinds (no make or model), not products |
| `catalog` gets a new schema version and a migration | All new fields optional; no migration | Older entries are valid as they are, so nothing needs moving |
| Catalogue changes by administrator only | Engineers and the administrator | It matches who may change settings (engineers already may), as Phase 23 will formalise |

**Database:** no SQL change. New optional JSON fields on `catalog` and `equipment` records.

**Tests**
- New:
  - Shared catalogue tests: validation, placement template, effective specs, server rules, restore, roles.
  - 2 server tests: engineer allowed and office refused; missing model and deleting a model in use refused.
  - Web tests: equipment list search, sort and pages; placement template.
- Updated:
  - The equipment test now expects no made-up install date.
  - The placement test now expects no catalogue name.
- Results:

  | Suite | Passed |
  |---|---|
  | Shared | 387 |
  | Server | 100 |
  | Web | 251 |

  Typecheck clean. No new lint errors.

**Walkthroughs** (temporary server on port 5055, temporary database)

| Walkthrough | Desktop | Phone |
|---|---|---|
| New Phase 2 | 15/15 | 15/15 |
| Main | 57/57 | 54/54 |
| Phase 1 | 24/24 | Not run |
| Customer | 50/50 | Not run |
| Fiber | 44/44 | Not run |
| Phase 0B | 14/14 | Not run |
| Routes | 52/52 | Not run |
| Field capture | Not run | 36/36 |

One field capture run stopped after the first pole: the browser's fake camera did not restart, and the app fell back to "Open camera". The camera code has not changed since the last commit, and the rerun passed 36/36. No browser errors and no sideways scrolling. Screenshots are in the session scratchpad (`p2-*.png`).

**Left open**
- Items keep the port count they were placed with; changing a model does not change existing items.
- New items still get a typical port count by kind when no model or port count is given (`defaultPortCount`). It is a guess, but port records depend on it, so it is left for Phase 10.
- The inspector's slack loop and splice joint sections show fixed example specs ("30 mm (G.652D)"). They should come from the model instead (Phase 3).
- Uploading datasheet files (documents hold metadata only).

## Phase 3: Equipment placement and inspector (M, P1) — DONE 10 November 2026
| Item | Detail |
|---|---|
| Scope | Placement half of M4 |
| Prerequisites | 2 |
| Frontend | Place by typed coordinates; place at an existing structure; duplicate with a new id; copy settings |
| Frontend | Bulk placement along a drawn line, with spacing confirmed by the person |
| UI | Inspector tabs: Details, Specs, Connectivity, Customers, Documents, Maintenance, History |
| Backend | Server duplicate warning for points (distance and type from OSP settings), returned to the client and logged when overridden |
| Database | Optional warranty, maintenance and condition fields on equipment (JSON fields, no SQL change) |
| Business rules | Duplicate is a warning with an override reason, never a block |
| Tests | Server duplicate warning; typed coordinate validation; History tab shows only real entries |
| Acceptance | Workflow A passes, including refresh and persistence |
| Files | `features/inspector/*`, `features/map/EquipmentToolbox.tsx`, `server/lib/linkGuard.ts` |

### Phase 3 completion report

**Built**

| Area | What it does now |
|---|---|
| Placement modes | Type a position (decimal degrees; India lat/lng swap, outside-India and low-precision warnings; never swapped silently). At a pole or chamber (takes its exact position, audited `PLACED_AT_STRUCTURE`). Place a copy (copies kind, make, model, catalogue model, spec changes, status, ports; never id, name, serial, tag, photos, connections, install date, place, owner, readings). Copy settings from another item, with a before/after preview. Along a line, at a spacing the person types (preview, up to 200, each through "same one?"). |
| One path | Every mode goes through `placeEquipmentChecked` |
| Inspector tabs | Details, Specs, Connectivity, Customers, Documents, Maintenance, History, with counts. Every earlier section kept. History shows only real audit entries and the record's own history. Customers shows only records that name the item |
| New fields | `warrantyUntil`, `condition` (good, fair, poor; absent = not recorded), `maintenance` log (day, who, what, next check). The day of the work is asked for, never assumed |
| Server duplicate warning | A new point of the same kind within the operator's duplicate radius is logged and returned as `warnings` on `/changes`. It is never refused |
| Fixed example specs | Removed from the slack loop and splice joint sections; values come from the model or say "Not recorded" |

**Changed from the plan:** the server warning covers `/changes` only, and the browser does not show it yet (it already asks "same one?"). Owner, material and height are not copied by "Place a copy" (they are facts about each pole).

**Files:** new `shared/domain/assetPlacement.ts`, `server/lib/placementWarnings.ts`, `web/features/map/placementModes.ts`, `PlacementDialogs.tsx`, `placementDialogStore.ts`, `web/features/inspector/AssetTabs.tsx`, `assetTabData.ts`, and their tests.

**Tests:** 19 shared, 4 server, 14 web.

## Phase 4: OSP infrastructure (L, P1) — DONE 10 November 2026
| Item | Detail |
|---|---|
| Scope | M5 gaps |
| Prerequisites | 3 |
| Shared | Span geometry (optional polyline), condition, inspections |
| Shared | Duct capacity and fill ratio; blocked or damaged ways; microducts |
| Shared | Editable duct depth and owner; polygon building footprints; chamber entries and exits |
| Shared | Moving a pole also offers to move cable vertices and slack loops at that pole. The person confirms each one |
| Database | New collection: inspections. Extra JSON fields on spans, ducts and buildings |
| API | Generic CRUD |
| Frontend | Inspection form (phone friendly); underground trace (duct to duct) |
| Business rules | Fill ratio limits are settings with a source. Nothing moves without being shown first |
| Tests | Fill-ratio warning; blocked way refused for a new cable; pole move preview |
| Acceptance | Workflow C passes |
| Files | `shared/domain/outsidePlant.ts`, `features/inspector/osp/*`, `features/ducts/*`, `OspLayer.tsx` |
| Docs | OSP_ENGINEERING.md |

### Phase 4 completion report

The full description is in [OSP_ENGINEERING.md](OSP_ENGINEERING.md).

**Built**

| Area | What it does now |
|---|---|
| Spans | Optional drawn line (bends, sag); ends always follow the poles. Condition. Length measured along the drawn line |
| Ducts | Inside diameter, entry notes, condition per duct, way and microduct. Fill worked out only from recorded diameters, with limits as settings and their source (NEC Chapter 9 Table 1, a starting point). **A new cable in a blocked way is refused** (browser and server); a damaged way or high fill is a warning with "Save anyway" |
| Buildings and chambers | Building outline (3 or more corners) besides the point. Chamber entries and exits |
| Moving a pole | Lists cable points, slack loops and duct ends at it, none ticked; only the ticked ones move, in the same undoable step |
| Inspections | New `inspections` collection: day, who, condition, findings, photos. Phone-friendly form. Technicians may add, and change or delete only their own |
| Underground trace | Duct to duct through recorded duct ends only, with gaps named, and shown on the map |

**Changed from the plan:** drawing span lines and outlines is in its own `OspDrawing.tsx` with a see-through tap layer. Pole and chamber inspections are added from the existing sections, so the inspector file was untouched.

**Tests:** 24 shared, 6 web, 3 server.

## Phase 5: Fibre cable engineering (L, P1) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M6 gaps |
| Prerequisites | 4 |
| Frontend | Route tools: move, add and remove a vertex; split; merge; extend; trim; reverse; duplicate. Each is one undo step |
| Frontend | Step-by-step cable wizard: type, cores and tubes, ends, route, ducts or poles, slack, check |
| Shared | Fibre standard, mode, sheath and diameter fields; install method separated from cable type |
| Shared | Splitting a cable keeps core identity and splices on both halves, or refuses with a reason |
| Backend | Duplicate-route warning (same ends, overlapping geometry) |
| Database | JSON fields on cables |
| Business rules | Drawn length is recomputed after an edit; sheath and optical lengths are never touched |
| Tests | Split and merge keep cores and links; reverse swaps the ends; duplicate warning |
| Acceptance | Workflow B passes, with geometry checked after a reload |
| Risks | Split and merge touch splices and assignments. This is the highest-risk edit in the plan, so it needs full test coverage first |
| Files | `features/map/sketch/*`, `features/cables/*`, `shared/domain/cables.ts`, `fiberCommands.ts` |
| Docs | FIBRE_CABLE_ENGINEERING.md |

### Phase 5 completion report

The full description is in [FIBRE_CABLE_ENGINEERING.md](FIBRE_CABLE_ENGINEERING.md).

**Built**

| Area | What it does now |
|---|---|
| Route tools | Tap-only, one undo step each: move, add or remove a point, extend, trim, turn round, and a new cable on the same route (ends proposed, then confirmed). The drawn length is recalculated; sheath and OTDR lengths, ends and fibre links are never changed. Drawing a connected end away asks first |
| Split | Every record that names the cable goes to the part where it actually sits. Anything ambiguous is refused with a reason. No joints are made up: the gap is named until a person records it |
| Join | Only cables that meet end to end with the same fibre count, layout and kind. Links are renamed and doubles folded; lengths go to remarks, never added together |
| Cable wizard | Seven steps: kind, fibres and tubes, ends, route, poles or duct, slack, check. Saved in one undo step. Every earlier safeguard kept. Route status now starts "Not recorded" |
| Build fields | Fibre standard, mode and sheath. Contradictions are refused (a G.65x standard recorded as multimode) |
| Duplicate route | A warning from the browser and the server, with corridor and overlap as settings. Never refused |

**Changed from the plan:** split and join for ducts are not built; ducts get the line tools and turn round.

**Tests:** 19 shared, 7 web, 4 server.

## Phase 6: Cable segmentation and infrastructure association (M to L, P2) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M7 |
| Prerequisites | 5 |
| Shared | `cableSegments`: a stretch of one cable with its own install method, duct or span, and length |
| Database | New collection: cableSegments |
| Frontend | Segment list on the cable; a corridor view (all cables in a duct or along a span) |
| Business rules | A physical cable is one record; segments describe it. Never split a cable into fake cables |
| Tests | Mixed aerial and underground cable; segment lengths add up to no more than the drawn length |
| Acceptance | A cable can be aerial for one stretch and in a duct for the next, and the traces still work |

### Phase 6 completion report

The full description is in [FIBRE_CABLE_ENGINEERING.md](FIBRE_CABLE_ENGINEERING.md), "Cable stretches".

**Built**

| Area | What it does now |
|---|---|
| Stretches | New `cableSegments` collection: a stretch of one cable between two structures on its line, or two distances along it, with its own install method, duct and way, or spans, and a measured length when recorded. A physical cable stays one record |
| Refused | A stretch off the line, overlapping another, with no length, naming a record that does not exist, or in a duct and on spans at once. Also an install method that contradicts its duct or spans |
| Warnings | Measured lengths adding up to more than the drawn length; a duct or span that does not list the cable |
| Split and join | Stretches go to the right part. A stretch across the split point is refused, because its length cannot be divided without inventing numbers |
| Screens | Stretch list and form on the cable (pick two structures in order along the line, or tap two points). A corridor view on each duct and span lists every cable in it |
| Layers | A mixed cable shows in the layer of each install method its stretches record |
| Traces | Unchanged; a test proves it |

**Tests:** 17 shared, 7 web, 3 server.

## Phase 7: Tube and core management (M, P1) — DONE 10 November 2026
| Item | Detail |
|---|---|
| Scope | M8 gaps |
| Prerequisites | 0B, 5 |
| Shared | Tube records, with tubes of different sizes allowed |
| Shared | Core statuses Faulty and Retired; mark faulty and repaired with a reason and evidence |
| Shared | Override process: who, why, when |
| Frontend | Core search (cable, tube, fiber, use); splice history per core; core cross-section diagram |
| Database | Tubes embedded in cable records (JSON) |
| Tests | Faulty core refused without an override; history kept after release |
| Acceptance | Workflow D passes |
| Docs | FIBRE_CORE_MANAGEMENT.md |

### Phase 7 completion report

The full description is in [FIBRE_CORE_MANAGEMENT.md](FIBRE_CORE_MANAGEMENT.md).

**Built**

| Area | What it does now |
|---|---|
| Tubes | Optional tube records, so tubes can be of different sizes. Sizes that do not add up are refused. Tube colour only when written on the drum sheet |
| New fiber states | Faulty and Retired, with reason, optional OTDR reference and photos, kept in the fiber's history. Repair restores the earlier state when recorded. A retired fiber is never given out |
| Override | A damaged or faulty fiber needs a written override reason to be given out. The reason is stored on the assignment and audited. The server warns when an override is missing (it never blocks, per the project rule) |
| Find a fiber | By number, tube, status, colour (only where the scheme is known) or use |
| Splice history per fiber | Both sides of each splice, including retired splices |
| Cross-section picture | Colours only when the scheme is known, otherwise numbered; each state has its own shape |

**Also updated:** customer connections, provisioning and both trace engines respect the new states. The bottom-panel fiber table fixes a garbled "â€”".

**Tests:** 23 shared, 5 web, 3 server.

## Phase 8: Splicing and closure management (M, P1) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M9 gaps |
| Prerequisites | 7 |
| Shared | Tray capacity check; cassettes and positions; pigtail termination; direction checked |
| Shared | "Entered by mistake" becomes a soft delete that keeps history |
| Frontend | Notes and photos in the splice form; a graphical splice diagram; a printable splice report (PDF) |
| Database | JSON fields on closures |
| Tests | Tray overflow; soft delete stays visible in history; direction mismatch is a warning |
| Acceptance | Workflow E passes |
| Docs | SPLICING_ENGINEERING.md |

### Phase 8 completion report

The full description is in [SPLICING_ENGINEERING.md](SPLICING_ENGINEERING.md).

**Built**

| Area | What it does now |
|---|---|
| Trays | Capacity per tray: over capacity is a warning. Cassette and position per splice: two in one position is refused |
| Pigtails | A fibre ending on a pigtail in a closure, with connector, label and what it connects to (text only, never a link) |
| Direction | Checked against the closure's recorded cable entries only; a mismatch is a warning |
| Entered by mistake | No longer deleted: the splice stays in history, struck out with the reason, and is ignored by traces and rules |
| Splice form | Cassette, position, loss in dB, meter, report reference, notes, photos |
| Picture and report | SVG splice picture (colours only when the scheme is known) and a printable PDF with the existing jspdf |

**Changed from the plan:** the soft delete reuses the existing out-of-service fields plus an `enteredInError` flag, so every existing check already skips it.

**Tests:** shared splicing tests, 1 web file, 2 server tests.

## Phase 9: ODF and patch management (M, P1) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M10 gaps |
| Prerequisites | 7 |
| Shared | Site and rack records; pigtails; patch cords as records; mark a port faulty or reserved |
| Shared | An ODF feeder marks its core used |
| Database | New collections: sites, racks (or JSON inside equipment; decided at the start of the phase) |
| Frontend | Rack elevation view |
| Tests | Feeder marks the core; faulty port refused for a new patch |
| Acceptance | Workflow F passes |
| Docs | ODF_PATCH_MANAGEMENT.md |

### Phase 9 completion report

The full description is in [ODF_PATCH_MANAGEMENT.md](ODF_PATCH_MANAGEMENT.md).

**Built**

| Area | What it does now |
|---|---|
| Sites and racks | New `sites` and `racks` collections. Equipment names its site, rack, unit and height; the older free text stays and is shown when nothing is linked. A site or rack in use cannot be deleted. Rack drawing with free units ("not known" when the rack height is not recorded) |
| Pigtails and patch cords | Recorded on the ODF port: connector, length, label. A mismatched plug is a warning |
| Faulty and reserved ports | Mark faulty, repaired, reserved, or end a reservation, with reasons kept in history. A faulty port needs a reason to be patched, and the server refuses it otherwise |
| Feeder fibre | The fibre behind an ODF port is now marked in use and released properly, following the same rules as giving out a fibre |

**Changed from the plan:** patch cords are kept on the port, not as separate records, so the link is never stored twice. "Faulty" is stored as the existing `damaged` value.

**Tests:** 25 shared, 3 server, 4 web.

## Phase 10: OLT and PON management (M, P1) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M11 gaps |
| Prerequisites | 9 |
| Shared | Chassis, shelf, slot and card model; any PON port count; ONT, service and capacity counts worked out from records |
| Shared | Replace `connectedCustomersCount` with a count from records, keeping the old field read-only |
| Frontend | The OLT setup screen no longer creates splitters as a side effect; it proposes them instead |
| Tests | Counts match the records after connecting, disconnecting and moving customers |
| Acceptance | An OLT with 12 PON ports can be recorded |
| Docs | OLT_PON_ENGINEERING.md |

### Phase 10 completion report

The full description is in [OLT_PON_ENGINEERING.md](OLT_PON_ENGINEERING.md).

**Built**

| Area | What it does now |
|---|---|
| Chassis | Optional shelves, slots and cards with model, kind, serial, port count and which PON ports each card holds. Refused when a card names a missing port, a port sits on two cards, or a card holds more ports than it has. The older rack, shelf and slot text is shown "(as written)" |
| Any port count | 1 to 1024, typed in. The 4/8/16/32 buttons and the silent default of 8 are gone; a new OLT says "Not recorded" until counted |
| Counts from records | Customers, ONTs and services per PON port are counted from the records and what the fibres reach. The old counter is now only a cache, set from that count after every connect, disconnect, move or relink |
| Splitters | The OLT setup screen proposes splitters; it never creates them. "Create splitter record" asks first |
| Capacity | "12 of 64 ONTs (52 free)", or "ONU limit not recorded" |

**Also fixed:**
- Moving a customer to another port never lowered the old port's count.
- The setup screen overwrote the OLT's notes.
- The setup screen used made-up loss figures and "PON-01" fallbacks.

**Tests:** 13 shared, 4 web.

## Phase 11: Splitter management (S, P2) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M12 gaps: architecture attribute (centralised, distributed, cascade level), splitter capacity report |
| Prerequisites | 10 |
| Tests | Architecture worked out from the cascade, shown as a suggestion only |
| Docs | SPLITTER_MANAGEMENT.md |

### Phase 11 completion report

The full description is in [SPLITTER_MANAGEMENT.md](SPLITTER_MANAGEMENT.md).

**Built**

| Area | What it does now |
|---|---|
| Level and arrangement | Worked out only from recorded links: cascades, fibres and splices, ODF patches up to the PON port. Shown as a suggestion with "How this was worked out". A person may record a different answer, with a reason; "centralised" at level 2 or more is refused as impossible |
| Split product | Multiplied along the recorded ratios (1:4 × 1:8 = 1:32, or "at least 1:N" when the fibre above is not recorded). Compared with the setting as a warning only; shown per PON tree |
| Capacity report | New `splitter-capacity` report. Each output is in use, free, faulty, reserved or not recorded; an output with no record is never counted as free |
| Faulty and reserved outputs | Marked with a reason and history. A new connection to a faulty output needs an override reason; the server refuses it otherwise |

**Also fixed:**
- Re-linking a cascade left the old output marked in use.
- A cascade onto an output already used was caught only later; it is now refused with a plain message.

**Tests:** 12 shared, 4 web, 2 server.

## Phase 12: Customer and FTTH mapping (M, P0/P1) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M13 gaps |
| Prerequisites | 0B, 11 |
| Shared | One source of truth for the customer path: the fibre links. Customer path fields are worked out from them or checked against them on the server |
| Backend | Personal data hidden by role (name, address, GPS, mobile) in API responses |
| Tests | Mismatched path refused; viewer and technician responses leave out personal data |
| Acceptance | Workflow G passes |
| Risks | Existing customers whose fields disagree. Report them first; never rewrite them silently |
| Docs | CUSTOMER_FTTH_MAPPING.md |

### Phase 12 completion report

The full description is in [CUSTOMER_FTTH_MAPPING.md](CUSTOMER_FTTH_MAPPING.md).

**Built**

| Area | What it does now |
|---|---|
| One source of truth | The customer's path is worked out from the fibre links only, through splices, splitters, cascades and ODF patches. Anything past a gap is left undecided |
| Server | Refuses a customer write, or a splitter-output owner, that contradicts the links (`customer_path_mismatch`, `splitter_owner_mismatch`). It accepts blank fields, and it accepts a stored disagreement written again unchanged. Link edits (splices and similar) are never refused because of a customer; those customers appear on the fix list |
| Check customer paths | Lists "Does not match" and "Not recorded" findings with the value from the links. A person ticks which to fix ("Fix chosen from the links", with confirmation and history). Unclear cases go to "Check on site" with no fix offered |
| Personal data by role | Read-only sees no name, address, house position or mobile. Field Technician sees name, address and mobile only for customers on their own jobs. GIS Engineer does not see mobiles. Applied to every route that returns customers: snapshot, area, catch-up, collections, revisions, audit, change requests, search, connections. A hidden value sent back is never stored over the real one |
| Customer wizard | Shows the path from the fibre links before saving. Phase 0B behaviour kept |

**Fixed during the wave-4 integration check:** the splitter-owner rule refused a valid case. An output names a customer whose own record is still blank, and the links lead that customer to that very output. The message contradicted itself ("…is recorded for Asha, but Asha's fibre leads to output 1" — the same output). Fixed in `customerPath.ts`, with a test.

**Tests:** 16 shared, 6 server, 2 web.

## Phase 13: Physical connectivity engine (XL, P1) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M15 |
| Prerequisites | 7 to 12 |
| Shared | One connection index over all link kinds, read-only at first (built from today's fields), with verification state, technician, evidence and date on each link |
| Shared | Connector type and direction checks |
| Database | New collection: linkVerifications (keeps today's fields unchanged) |
| API | Generic CRUD, plus a read endpoint for the index |
| Business rules | Unverified is a visible state, never hidden |
| Tests | The index matches every existing link kind; verifying a link records evidence |
| Acceptance | Every link can show who made it, when, and whether it was checked |
| Risks | Replacing the existing fields would be a rewrite. This plan builds an index over them instead, so nothing that works today is replaced |
| Docs | PHYSICAL_CONNECTIVITY.md |

### Phase 13 completion report

The full description is in [PHYSICAL_CONNECTIVITY.md](PHYSICAL_CONNECTIVITY.md).

**Built**

| Area | What it does now |
|---|---|
| Connection index | One read-only index over 22 existing link kinds. Each link has a stable id, two typed ends, a state, where it is recorded, and who and when only if the record holds them. No existing field or command was changed |
| Checks | New `linkVerifications` collection: method (OTDR, VFL, power reading, visual, continuity), result, day, technician and evidence. States are not checked, passed, failed, inconclusive, and changed since the check. A check of a link that has gone is kept and listed apart |
| Warnings | Connector type, splice direction, Cable TV direction, two feeds, loops, ends not on record |
| API | `GET /connections?element=` or `?cable=&core=`, scoped to the organisation and redacted for the role |
| Screens | A Connections panel on the inspector's Connectivity tab and in each cable fibre. "Record a check" asks before saving a check with no evidence |

**Tests:** 15 shared, 5 server, 5 web.

## Phase 14: Logical topology engine (M, P2) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M16 |
| Prerequisites | 13 |
| Shared | Logical layer: service, VLAN, PON binding |
| Frontend | Combined physical and logical view; replace the type-grouped "topology" view |
| Docs | NETWORK_TOPOLOGY.md |

### Phase 14 completion report

The full description is in [NETWORK_TOPOLOGY.md](NETWORK_TOPOLOGY.md).

**Built**

| Area | What it does now |
|---|---|
| Two layers, kept apart | Physical: the fibre links only. Logical: service → ONT → the PON port the ONT is registered on → OLT, with VLAN, S-VLAN and C-VLAN, profile, IP and circuit id. Neither is worked out from the other. When they disagree both values are shown and the place is named |
| Where it is stored | Optional fields on the existing `services` record. No new collection and no SQL change. VLAN ids outside 1 to 4094 are refused in the browser and on the server |
| Rules | Warnings only. "One VLAN per service on a PON port" is a setting, off by default, because many operators use one shared VLAN per port |
| Topology screen | Network tree from recorded links (the old picture with made-up port counts and losses is gone), "Physical and logical", and "Readings and lengths". A folding list that reads at 390 px |
| Personal data | Follows the Phase 12 role rules. A hidden name shows as "Customer CUST-7 (name hidden for your role)" |

**Known gap:** no OLT is read, so every logical value is typed by a person.

**Tests:** 15 shared, 5 web, 2 server.

## Phase 15: Network tracing and validation (L, P1) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M17 and M21 |
| Prerequisites | 13 |
| Shared | One trace engine on the connection index (retire the cable-level `trace.ts` path once results match) |
| Shared | All 12 trace types; the unverified state; trace from a closure, splice or ODF port |
| Shared | Geometry rules: self-intersection, extra vertices, gaps, outside service area, duplicate route |
| Backend | Stored findings with open, acknowledged and resolved states and history; the server map check uses the operator's settings |
| Frontend | Map highlight for every trace; a topology diagram; trace report download; findings list with zoom to item and fix text |
| Database | New collection: validationFindings |
| Tests | Both engines give the same result on the sample network before the old one is retired; each geometry rule |
| Acceptance | Workflows H and I pass |
| Docs | NETWORK_TRACE_GUIDE.md, NETWORK_VALIDATION.md |

### Phase 15 completion report

The full description is in [NETWORK_TRACE_GUIDE.md](NETWORK_TRACE_GUIDE.md) and [NETWORK_VALIDATION.md](NETWORK_VALIDATION.md).

**Built**

| Area | What it does now |
|---|---|
| One trace engine | `networkTrace.ts`, on the Phase 13 connection index. Follows only links that carry light. A gap stops the trace and says what is missing; two feeds on one fibre is a gap too. Tests prove it gives the same fibres, port and completeness as `fiberPath.ts`, and the same cables as `trace.ts` where fibres are recorded end to end |
| 12 trace types | Asset to asset, cable, fibre, port to port, OLT to ONT, customer to OLT, splitter to customers, upstream, downstream, physical route, logical service, fault impact. Each step has a state: checked good, not checked, check, planned, faulty, missing |
| Screens | "Network Trace" in the sidebar: steps, a tree diagram readable at 390 px, highlight on the map, PDF and CSV (no customer positions). Every inspector "Trace" button uses the new engine; the old cable-level route is kept as "Cables and loss estimate" |
| Geometry rules | Self-crossing line, points too close, cable end too far from its item, item outside every zone, duplicate routes. Warnings only, limits as settings with a source |
| Stored findings | New `validationFindings` collection. Open, acknowledged, resolved, each with who, when and a note; history only grows. A finding no longer found is marked so, never deleted. `POST /reports/validation-run` stores them. Customer names are replaced by their id |

**Fixed during the wave-5 integration check:** a trace step that no recorded check covered (the customer, the box, the OLT, notes, services) showed "Checked good". Nothing had been checked, so it now shows "Not checked". "Checked good" now needs a passed check on every recorded link of the step. Notes show no state. A test was added.

**Known gaps:**
- The new engine gives no loss figure; the loss budget stays on Route Trace (Phase 17).
- Cable TV links are not followed.
- The trace screen is English only.

**Tests:** 29 shared (one added in the integration check), 4 server, 6 web.

## Phase 16: Advanced search and attribute table (L, P2) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M18, M19, M20 |
| Prerequisites | 1, 24 (server paging) or a browser-only first step |
| Frontend | Multi-select, box and lasso select; context menu; select by attribute or area |
| Frontend | Search for serial, model, tag, pole number, port, core and ODF port |
| Frontend | Filter builder; saved filters; attribute table per layer with sort, paging, column control, bulk edit and map sync both ways |
| Backend | Search endpoint; bulk edit through `/changes` with every rule applied |
| Tests | Bulk edit refused as a whole when one record fails; CSV escaping |
| Acceptance | Workflow L for search and table at 50,000 records |

### Phase 16 completion report

**Built**

| Area | What it does now |
|---|---|
| Choosing several | Shift- or Ctrl-click on desktop; "Choose several (tap each)" on phones. Box, lasso and "tap the corners" area. Everything in a zone; by a value; invert; named selections on the device. "Select connected" follows recorded links only |
| Selection bar | Count in words, Zoom to, Table, More, Clear |
| Menu on an item | Right-click on desktop, "More" on phones: open, zoom, trace, select connected, copy id |
| Search | Ids, names, serial, model, make, tag, pole numbers, IP, fibres (`CBL-01/5`), PON ports, ODF adapters, splitters, closures, ducts, spans, zones. Hidden values for the role are never matched. `GET /search` with paging |
| Attribute table | 21 layers. Sort, quick filter, virtual scrolling, column choice. Filter builder with saved filters. Rows chosen in the table are chosen on the map, and the other way. Bulk edit of listed fields only, all-or-nothing through one `POST /changes`. CSV through the safe writer, with the export right |
| Old "Attribute table" tab | Renamed "Cores" |

**Measured at 50,000 records:**

| Operation | Time |
|---|---|
| Sort | 73 ms |
| Filter | 18 ms |
| Area select over 100,000 | 45 ms |
| Search over 100,000 | 66 ms |
| CSV | 106 ms |

**Known gap (found in the integration check):** on a phone the attribute table opens only from the selection bar ("Table"), because the bottom strip is hidden on phones.

**Tests:** 13 shared, 19 web, 5 server.

## Phase 17: Optical engineering (S to M, P2) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M22 gaps |
| Prerequisites | 15 |
| Shared | Flag defaulted inputs; show unknown splitters; no verdict when the optics class is defaulted, only "Estimated with default class" |
| Shared | Stored budget runs with a timestamp; the formula written out |
| Docs | OPTICAL_BUDGET_GUIDE.md |

### Phase 17 completion report

The full description is in [OPTICAL_BUDGET_GUIDE.md](OPTICAL_BUDGET_GUIDE.md).

**Built**

| Area | What it does now |
|---|---|
| Where each input came from | Every budget input has one of five labels: From the record, Drawn line on the map, Your setting, Default (not your network), Not recorded. This covers the optics class and its limits, launch power, fibre loss per wavelength, each cable's length and its basis (OTDR, sheath marks or drawn line), splitter, splice and connector losses, the margin and the ONT reading. Settings are named by id with their source |
| Unknown splitters | A splitter with no recorded loss shows "Unknown" and the panel says "No budget". Before, a ratio no record or setting gave was silently left out of the total |
| No verdict on an assumed class | With no optics class recorded, the result is "Estimated with default class" and no pass or fail. The map check's path-budget warning no longer fires on a guessed class. The trace now uses the class recorded on the PON port |
| Stored budget runs | New `opticalBudgetRuns` collection. A run keeps the time, who, the target (customer id only), OLT and PON port, the class and whether it was recorded, every input with its origin, the result per direction with the sum written out, and a note. The server never lets a run be changed or deleted, and refuses a pass or fail on an assumed class. Engineers, network admins, planners and the administrator may store runs |
| Route Trace panel | "Optical budget", labelled "Estimated, not measured": the answer in one line, down and up totals, "N inputs are not from your records", every input with its source, how it was worked out, "Store this budget run" and the stored runs. One column at phone width |
| One calculation | `lossEngine.calculateOpticalLossBudget`, fed by the fibre path trace. The new code only labels, writes out and stores |

**Fixed during the wave-6 integration check:** undo in the browser tried to remove a stored budget run (and to roll back a map check decision), which the server refuses. Undo now leaves both alone: storing one adds no undo step, and undo and redo keep them as they are. A test was added.

**Known gaps:**
- The panel works for customer paths only, and no report lists all stored runs.
- `ranBy` is the name the browser sends; the server's audit trail records the real account.
- No loss values for 1577 or 1270 nm.
- The 3D view's own loss figure (the other session's work) does not yet say whether its class was assumed.

**Tests:** 10 shared, 3 server, 4 web, plus 1 web undo test from the integration check.

## Phase 18: Network planning and capacity (L, P2) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M23 |
| Prerequisites | 13, 4 |
| Shared | ODF, duct, pole and OLT utilisation; spare and shortage; planned against built; expansion scenarios (planned records kept apart from built ones) |
| Docs | CAPACITY_PLANNING.md |

### Phase 18 completion report

The full description is in [CAPACITY_PLANNING.md](CAPACITY_PLANNING.md).

**Built**

| Area | What it does now |
|---|---|
| Capacity per element | One line per splitter, PON port, OLT card, ODF, cable, duct, pole and rack: capacity, used, held for planned, reserved, faulty, free, not recorded. States are room left, nearly full, full, over capacity, not known. Positions nobody recorded are never counted as free |
| Planned apart from built | Planned equipment, cables and waiting customers go in "held for planned", never in "used". Rejected captures are left out |
| Pole allowance | New optional fields on the pole. Without them the pole shows "Not recorded" |
| Warning levels | Settings with a source (80%, and 75% for duct ways). Reports say which values were used |
| Zones and demand | Spare and shortage per drawn zone. Waiting customers per box against free outputs |
| What-if plans | New `planningScenarios` collection: more customers, a new splitter, a new cable. The result is worked out on top of the records and never stored on them. Tests show the real figures are the same with and without a plan |
| Reports and screen | Seven capacity reports (box and ids only, no names). The Capacity dashboard was rewritten; the made-up labels "Lease Reserved" and "Attenuation Damaged" are gone |

**Known gaps:** no forecast or cost figures, because the records hold no demand growth or cost. Pole load counts cables only.

**Tests:** 17 shared, 2 web, 2 server.

## Phase 19: Field survey and offline mapping (L, P1) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M25 gaps |
| Prerequisites | 4, 24 for change requests (or a simple review queue first) |
| Shared | Survey records go in as `Proposed` and wait in a review queue; the office accepts or rejects them |
| Shared | Inspection checklists; barcode scanning (zxing already reads barcodes; no new dependency) |
| Frontend | Sync history log; office offline edits move from localStorage to IndexedDB |
| Tests | A capture stays out of production until accepted; offline queue survives a reload |
| Acceptance | Phone walkthrough at phone width |
| Docs | FIELD_MAPPING_GUIDE.md (extends FIELD_WORKER_GUIDE.md) |

### Phase 19 completion report

The full description is in [FIELD_MAPPING_GUIDE.md](FIELD_MAPPING_GUIDE.md).

**Built**

| Area | What it does now |
|---|---|
| Review queue | Field captures arrive as "awaiting review", never Active. Operations → Field captures lists each with photo, who and when, GPS accuracy and "same one?" hints. Accept (who and when recorded; an item with no GPS fix needs placing or a logged reason). Reject (reason required, record kept). Reopen. Technicians cannot decide. A dashed violet pin with a clock marks waiting items |
| Checklists | Pole, chamber, span, duct and box checklists as editable settings. The inspection form asks OK, Problem or Could not check; only answered items are stored |
| Barcodes | The scanner reads QR and common 1D barcodes with the bundled decoder (no new library) |
| Offline office copy | Moved from localStorage to IndexedDB (no 5 MB limit). Changes made together are written together. A one-time move from localStorage removes the old copy only after IndexedDB has it. "Storage full" is shown honestly and nothing is dropped. Falls back to localStorage if IndexedDB cannot open |
| Sync history | What was sent, refused (with reason) or in conflict, kept on the device for 30 days. Shown on the phone and in the office |

**Changed from the plan:**
- Danger reports and light readings are not held for review, because the office must see them at once.
- The office roles that edit network items decide on captures; this is not the change-request "approve" right.

**Tests:** 14 shared, 15 web, 2 server.

## Phase 20: Monitoring and fault impact integration (M, P3) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M27, M28 gaps |
| Prerequisites | 13 |
| Shared | OLT and PON level status; affected ports, cores and equipment listed in the impact result |
| Frontend | Correct the Reports page wording |
| Notes | A vendor or SNMP adapter needs a real OLT and your approval (see MONITORING_ADAPTERS.md) |

### Phase 20 completion report

The adapter contract is in [MONITORING_ADAPTERS.md](MONITORING_ADAPTERS.md).

**Built**

| Area | What it does now |
|---|---|
| Device status | New `deviceStatuses` collection: OLT, card, PON port and uplink rows pushed by a device. "Live" only with a recent real reading; otherwise "Stale" or "No live connection". Readings go only to the organisation whose token sent them |
| Alarms | Device alarms, kept apart from faults people report |
| Fault impact | Can also list the equipment, ports and fibres downstream, following recorded links only |
| Reports | `liveMonitoringReport` replaces the old report that said monitoring and Cable TV were "not built" |
| NOC screen | "OLT and PON ports" in Live status: alarms, loss of signal and customers affected per port. Names are hidden for roles that should not see them |

**Known gap:** no vendor adapter is built, because that needs a real OLT.

**Tests:** 20 shared, 3 web, 2 server.

## Phase 21: Import/export and data migration (L, P2) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M26 |
| Prerequisites | 15 (validation) |
| Shared | GeoJSON, CSV and Shapefile import through the existing preview pipeline, with field mapping, a CRS check and a line duplicate check |
| Shared | Import history and rollback by `importId` |
| Frontend | Excel and KMZ export; ducts, spans and buildings in KML |
| Database | New collection: imports |
| Risks | Shapefile and Excel need new dependencies, which need approval |
| Acceptance | Workflow K passes |

### Phase 21 completion report

The full description is in [IMPORT_EXPORT_GUIDE.md](IMPORT_EXPORT_GUIDE.md).

**Built**

| Area | What it does now |
|---|---|
| New file types | GeoJSON, CSV and Shapefile (in a .zip), on the KML preview steps: file, columns, groups, check |
| Columns | The person picks the columns for name, notes, kind of item, core count and (for CSV) position. A column is pre-picked only when its title is exactly right. The choices are shown before going on and kept with the import. Other columns are kept as written |
| Coordinate check | Numbers outside the possible range, or swapped, are flagged and left out. A file in another map system is converted only when the system is known (tested with UTM 43N); otherwise it is refused, naming the system. A Shapefile with no `.prj` needs a tick saying the positions are WGS 84 |
| Duplicate lines | A line that runs along an existing cable or duct is held back, like a duplicate point, unless "Import anyway" is ticked |
| Cable ends | Ends near a box (ducts: near a chamber) list up to three candidates. Every end starts as "Leave it unconnected"; nothing is joined by nearness |
| Import history and undo | New `imports` collection: who, when, file, counts, settings and accepted warnings, and every record made or changed. Undo of a whole import goes through the normal server checks, and is refused in plain words when an item was changed since, is used by something else, was already undone, has unsent changes, or the account lacks the delete right |
| Export | KML now has ducts, spans and buildings. KMZ (fflate). Excel: an "About this file" sheet, then one sheet per record type. All need the export right and use the data the role may see |

**Decided during the build:**
- Planners may import but not undo, because undo needs the delete right on equipment, cables and ducts.
- Undo needs the office server online.
- The end-proposal distance is the existing map-check limit (50 m), so a confirmed end never raises that warning.

**Known gaps:**
- No Shapefile export, and no Excel import (save the sheet as CSV first).
- Slack loops are not in the KML.
- Tried only with files made in tests and the walkthrough, not a real operator's file.

**Tests:** 16 shared, 5 server, 17 web.

## Phase 22: Reports and analytics (M, P2) — DONE 11 November 2026
| Item | Detail |
|---|---|
| Scope | M30: the 9 missing reports, Excel output and a generated PDF |
| Prerequisites | 15, 18, 21 |
| Business rules | Every number comes from records; TEST data is excluded unless chosen |

### Phase 22 completion report

**Built**

| Area | What it does now |
|---|---|
| Ten new reports | Cable inventory, cables not connected, records not linked to anything, outside plant summary, pole attachments, duct occupancy, splicing, ODF ports, customer paths, and the stored map check findings |
| Change history | From the server's audit events (newest 2,000), loaded on request. It shows the names of the changed fields, never their values |
| Data-truth rules | A gap says "Not recorded" or "Not known", never 0 or free. Links are only the recorded ones. A loss or length is "measured" only from a meter or a person; the map distance is "drawn, not measured". Customers by id only. TEST records are left out unless ticked |
| Sources on every report | "Made from", "Settings used" and "Filters" on screen, in print and in every file |
| Saving | Excel (the rows plus an "About this report" sheet), PDF (A4 landscape, the facts at the top, a footer on each page), a picture (up to 200 rows), and every report in one Excel file. All behind the export right |
| Reports screen | Reports in groups. At phone width a "Choose a report" list replaces the cards |

**Fixed during the wave-6 integration check:** "Save map file (GeoJSON)" on the Reports screen was not behind the export right. It is now.

**Not on disk:** `docs/REPORTS_GUIDE.md`. The helper's write was refused, and its text is kept for the owner to decide on.

**Known gaps:**
- No chart; the picture is of the table.
- Cable reports ignore the Area filter, because cables have no area field.
- No combined PDF of all reports.

**Tests:** 16 shared, 4 web.

## Phase 23: Security and administration (L, P0/P1) — DONE (23a 10 November, 23b 11 November 2026)
| Item | Detail |
|---|---|
| Scope | M29, M31, M24 |
| Prerequisites | none (can start earlier if you prefer) |
| Backend | 8 roles mapped onto the existing 5, keeping existing users working |
| Backend | Action permissions: view, create, edit, move, delete, connect, disconnect, allocate, deallocate, approve, export, configure |
| Backend | Audit entries written by the server for every write, with before and after |
| Backend | Record revisions; change requests with review, approval and verification |
| Shared | Editable lists (types, statuses, ratios), naming and id rules, custom attributes |
| Database | SQL: approval for a `revisions` table |
| Notes | Tenant isolation is only needed if more than one ISP will use one server. Please confirm |
| Tests | Every action for every role (Workflow J); an API write without a browser still leaves an audit entry |
| Docs | SECURITY_AND_PERMISSIONS.md |

### Phase 23a completion report

The full description is in [SECURITY_AND_PERMISSIONS.md](SECURITY_AND_PERMISSIONS.md).

**Built**

| Area | What it does now |
|---|---|
| Eight roles | Super Admin (`admin`), Network Admin (new), GIS Engineer (`engineer`), Network Planner (`office`), Field Technician, NOC Operator (new), Supervisor (new), Read-only. Stored names unchanged, so nobody loses access; an unknown role reads as Read-only |
| Action permissions | View, create, edit, move, delete, connect, disconnect, allocate, deallocate, approve, export, configure. Worked out from what a change does (a position change is a move, a link is a connect, a core assignment is an allocate), enforced on the server and checked in the browser |
| Server-written audit | New `audit_events` table, written in the same transaction for every write through every route, with who, when, what and a field diff. Append-only (triggers refuse changes). A direct API write is never untraced |
| Record revisions | New `record_revisions` table. List versions of a record, view one, compare two. Retention settings `REVISION_KEEP_DAYS` and `REVISION_KEEP_PER_RECORD` |
| Change requests | New `change_requests` table: requested, approved or rejected, applied, verified, closed. Nobody approves their own request. Apply runs the normal guarded write, and is refused if a record changed since |
| Editable lists | Equipment types, statuses, cable types, connectors and splitter ratios as settings over the built-in values. Built-ins can be renamed or hidden, never removed. Naming rules and custom field definitions |
| Migration | `user_version` 1 → 2, new tables only, safe to run twice |

**Changed from the plan:**
- Fixed lists that drive engineering rules (splitter ratios, statuses, cable types) can be renamed or hidden, but not extended.
- The export right gates the save-to-file buttons and the server's export routes, not `GET /network`, which the app needs.
- Field Technician and Read-only no longer see CSV and KML export buttons.
- Tenant isolation is Phase 23b, in wave 3.

**Tests:** 20 server (every role × every action), 20 shared, 2 web.

### Phase 23b completion report: several ISPs on one server

The full description is in [SECURITY_AND_PERMISSIONS.md](SECURITY_AND_PERMISSIONS.md), "Organisations".

**Built**

| Area | What it does now |
|---|---|
| One file per organisation | Each organisation has its own database file and its own photos, voice, backups and scheduled backups. No existing table changed |
| Control database | New `control.db` lists organisations and which organisation each login name belongs to. It holds no network data, passwords or sessions |
| Users and sessions | They stay in each organisation's own database |
| Every request | Resolves the session's organisation and reaches only that organisation's data. With none it is refused; it never falls back to another |
| Upgrade | The existing database becomes the first organisation, "My organisation", in place. Nothing is moved, copied or renamed. Existing logins and push tokens keep working |
| Setup mode | Unchanged for a fresh single-organisation install |
| Platform admin | An administrator of the first organisation can list, add (with a first administrator and a temporary password shown once), rename, and switch organisations off and on. They never see another organisation's data |
| Switching off | Blocks logins, ends sessions and refuses push tokens; the data is kept |

**Isolation tests:** 14 server tests cover every route family from a second organisation against the first: network, changes, area, records, audit, revisions, change requests, photos, backup, restore, reset, monitoring, voice and accounts.

**On the owner's computer:** the running development server picked this up and created `apps/server/data/control.db`, which lists the existing `fibergis.db` in place as "My organisation". `fibergis.db` was not changed.

## Phase 24: Performance and production readiness (XL, P1 for scale) — DONE 11 November 2026 (24a server, 24b browser)
| Item | Detail |
|---|---|
| Scope | M32, M33, M35 |
| Prerequisites | can run alongside other phases from Phase 1 onward |
| Backend | Paging; map-area queries; a spatial index; incremental sync (changes since a revision) instead of full snapshots; targeted link checks instead of whole-collection scans; scheduled backups |
| Database | SQL: approval for spatial index columns or an R-tree table |
| Frontend | Load by map area; cluster index updated incrementally |
| Tests | Workflow L at 100,000 records, against a measured budget agreed with you |
| Tests | Browser end-to-end tests for Workflows A to L kept in the repo |
| Docs | DATABASE_SCHEMA.md, API_DOCUMENTATION.md, NETWORK_MAPPING_TEST_PLAN.md, CHANGELOG.md; DEPLOYMENT_GUIDE.md updated |

---

### Phase 24a completion report

The full description is in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) and [API_DOCUMENTATION.md](API_DOCUMENTATION.md).

**Built**

| Area | What it does now |
|---|---|
| Paging | `limit`, `cursor`, `ids`, `bbox` and `changedSince` on `GET /<collection>`; no query string means the same answer as before |
| Map-area queries | `GET /network/area?bbox=`, using an SQLite R-tree, then an exact test |
| Catch-up sync | `GET /changes?since=N` returns only what changed, or tells the device to reload. The browser uses it and falls back to the full load |
| Targeted checks | The link, catalogue and alarm checks read only the records a change can affect. 600 random change sets prove the answers are identical to before |
| Scheduled backups | `BACKUP_EVERY_HOURS` (off by default), `BACKUP_KEEP` |
| Benchmark | `npm run benchmark -w @fibergis/server` |

**Migration:** `user_version` 2 → 3, new tables only (`record_bounds`, `record_bounds_rtree`, `change_log`).

**Measured on 100,117 records**

| Operation | Time |
|---|---|
| Full snapshot (130.6 MB) | 2.5 s |
| Area query, 500 m box | 5 ms |
| Catch-up, 20 writes behind | 0.5 ms |
| Span saved | 1,303 ms before → 1 ms now |
| Pole edit | 3.6 s (the whole-network fiber check remains; later work) |

**Tests:** 17 server, 2 equivalence, 5 web sync.

### Phase 24b completion report

The full description is in [NETWORK_MAPPING_TEST_PLAN.md](NETWORK_MAPPING_TEST_PLAN.md), with [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) and [API_DOCUMENTATION.md](API_DOCUMENTATION.md) updated and a new root CHANGELOG.md.

**Built**

| Area | What it does now |
|---|---|
| Load by map area | From 30,000 records (one constant, `AREA_MODE_MIN_RECORDS`), equipment, cables, customers, spans, ducts, slack loops and buildings load only for the area in view; everything else loads whole. Linked records one step away are fetched too. Panning only adds. Changes made anywhere still arrive. Small networks and older servers load whole, as before |
| Telling people | A "Part loaded" chip says lists, counts, checks and reports use only what is loaded, and offers "Load the whole network on this device". It shows offline too. Search also asks the server while part loaded |
| Cluster index | Rebuilt only when a pin is added, removed or moved |
| Plain pole edits | A change of name, notes, photos and similar fields skips the whole-network fibre check. 600 random change sets give the same answer with and without the shortcut |
| Kept browser tests | `e2e/`: Workflows A to L, port 5056 only, puppeteer-core from `E2E_PUPPETEER_DIR` (no new dependency) |

**Measured at 100,117 records (desktop, busy machine)**

| Operation | By map area | Whole network |
|---|---|---|
| First load | 2.0 s | 23.9 s |
| Browser memory | 57 MB | 914 MB |
| Pan to a new place | 2.0 s | — |
| Search outside the loaded area | 3.1 s | 0.7 s |
| Zoom out to groups | 1.1 s | 6.5 s |
| Pole rename (server) | 3.3 ms (was 5.1 s) | — |
| Pole move (server) | 5.3 to 7.3 s | — |

**Proposed budget, for the owner to agree:** first load 4 s, memory 200 MB, pan 3 s, search 5 s, zoom out 2 s, plain edit 100 ms, move 1 s, catch-up 2 s. Everything is met except the move.

**Known gaps:**
- Moving an item still takes 5 to 7 s (the whole-network fibre check).
- The server's search takes 2 to 4 s at 100,000 records.
- A deep trace on a part-loaded network can stop at a record that is not loaded.
- In field capture, QR lookup and the next-name counter see only what is loaded.
- The offline capture and Cable TV walks are not in `e2e/` yet.

**Tests:** 8 server, 15 web, plus Workflow L.

## Order and dependencies

```
0 → 0B → 1 → 2 → 3 → 4 → 5 → 6
                    ↘ 7 → 8
                      7 → 9 → 10 → 11 → 12 → 13 → 14
                                              13 → 15 → 16, 17, 21 → 22
                                              13 → 18, 20
4 → 19            23 (any time after 0B)      24 (alongside, from 1)
```

## Suggested first approvals
1. **Phase 0B** (small, and protects everything after it). Approved and done on 10 November.
2. **The tile provider decision for Phase 1** (Google tiles used directly, or a licensed provider).
3. **Whether tenant isolation is needed** (Phase 23).

---

## Integration checks after each wave

The phases run in waves of parallel work, as approved on 10 November 2026. After each wave, all of its phases are checked together on a temporary server (port 5055, temporary database); the real database is never used.

### Wave 1: Phases 3, 4, 7 and 23a (10 November 2026)

**Tests**

| Suite | Passed |
|---|---|
| Shared | 473 |
| Server | 130 |
| Web | 278 |

Typecheck clean.

**Walkthroughs**

| Walkthrough | Desktop | Phone |
|---|---|---|
| Main | 57/57 | 54/54 |
| Customer | 50/50 | Not run |
| Fiber | 44/44 | Not run |
| Routes | 52/52 | Not run |
| Phase 0B | 14/14 | Not run |
| Phase 1 | 24/24 | Not run |
| Phase 2 | 15/15 | Not run |
| Field capture | Not run | 36/36 |
| New wave-1 | 11/11 | 11/11 |

The new wave-1 walkthrough covers: inspector tabs and history, a maintenance record, placing by typed position, a pole inspection, a fiber marked faulty and held back without an override reason, the server audit trail, and the Lists and rules screen.

**Walkthrough scripts updated:** they now open the inspector tab that holds a section, as a person would, because Phase 3 moved sections onto tabs.

### Wave 2: Phases 5, 8, 9 and 24a (11 November 2026)

**Tests**

| Suite | Passed |
|---|---|
| Shared | 529 |
| Server | 158 |
| Web | 299 |

Typecheck clean. One web test hit a 3.5-hour timer while the computer slept; it passed when run again.

**Walkthroughs**

| Walkthrough | Desktop | Phone |
|---|---|---|
| Main | 57/57 | 54/54 |
| Customer | 50/50 | Not run |
| Fiber | 44/44 | Not run |
| Routes | 52/52 | Not run |
| Phase 0B | 14/14 | Not run |
| Phase 1 | 24/24 | Not run |
| Phase 2 | 15/15 | Not run |
| Wave 1 | 11/11 | Not run |
| Field capture | Not run | 36/36 |
| New wave-2 | 9/9 | 9/9 |

Field capture first stopped on the known fake-camera hiccup; the rerun passed.

The new wave-2 walkthrough covers: turning a cable round, the route editor, a splice struck out as a mistake and kept in history, an ODF port marked faulty, a site and rack saved, a map-area query and catch-up sync.

**Walkthrough scripts updated:** for the step-by-step cable wizard (ends on step 3, save on the last step) and the renamed splice controls.

### Wave 3: Phases 6, 10, 19 and 23b (11 November 2026)

**Tests**

| Suite | Passed |
|---|---|
| Shared | 573 |
| Server | 177 |
| Web | 328 |

Typecheck clean.

**Walkthroughs**

| Walkthrough | Desktop | Phone |
|---|---|---|
| Main | 57/57 | 54/54 |
| Customer | 50/50 | Not run |
| Fiber | 44/44 | Not run |
| Routes | 52/52 | Not run |
| Phase 0B | 14/14 | Not run |
| Phase 1 | 24/24 | Not run |
| Phase 2 | 15/15 | Not run |
| Wave 1 | 11/11 | Not run |
| Wave 2 | 9/9 | Not run |
| Field capture | Not run | 36/36 |
| New wave-3 | 12/12 | 12/12 |

The new wave-3 walkthrough covers:
- A field capture waits for review, and the office accepts it.
- An OLT saved with 12 PON ports, with the count asked and no splitters made.
- A cable stretch from pole to pole, with no extra cable created.
- A second organisation, whose administrator must change the temporary password first and then cannot see the first organisation's network.

**Walkthrough script updated:** the OLT step now checks that the port count is asked, since the 4/8/16 buttons are gone by design.

### Wave 4: Phases 11, 12, 13 and 16 (11 November 2026)

**Tests**

| Suite | Passed |
|---|---|
| Shared | 628, plus the new customer-path test |
| Server | 195 |
| Web | 358 |

Typecheck clean.

**Walkthroughs**

| Walkthrough | Desktop | Phone |
|---|---|---|
| Main | 57/57 | 54/54 |
| Customer | 50/50 | 50/50 |
| Fiber | 60/60 | Not run |
| Routes | 52/52 | Not run |
| Phase 0B | 14/14 | Not run |
| Phase 1 | 24/24 | Not run |
| Phase 2 | 15/15 | Not run |
| Wave 1 | 11/11 | Not run |
| Wave 2 | 12/12 | Not run |
| Wave 3 | 12/12 | Not run |
| Field capture | Not run | 36/36 |
| New wave-4 | 14/14 | 11/11 (table checked on desktop) |

The new wave-4 walkthrough covers:
- A splitter output marked faulty.
- The Connections panel and a recorded check, which asks first when there is no evidence.
- A customer path fixed from the links on the Check customer paths screen.
- Search by serial number.
- The attribute table, with rows chosen into the map selection.
- A Read-only account that gets the network without customer names, addresses or mobiles.

**Two fixes made during this check:**
1. **The Phase 12 splitter-owner rule** refused a valid case (see the Phase 12 report).
2. **The Customer Directory header** had a fixed height. On a phone its buttons spilled over the page, and "Check customer paths" sat under the top bar. It now wraps.

**Walkthrough scripts updated:**
- Search now picks the first match, because results are grouped by kind with equipment first.
- The customer wizard heading is now "Path from the fibre links".

### Wave 5: Phases 14, 15, 18 and 20 (11 November 2026)

**Tests**

| Suite | Passed |
|---|---|
| Shared | 710 (709, plus the new trace test) |
| Server | 205 |
| Web | 374 at the check; 397 after the other session added its tests (all pass) |

Typecheck clean. Build clean.

**Walkthroughs**

| Walkthrough | Desktop | Phone |
|---|---|---|
| Main | 57/57 | 54/54 |
| Customer | 50/50 | 50/50 |
| Fiber | 60/60 | Not run |
| Routes | 52/52 | Not run |
| Faults | 50/50 | Not run |
| Accounts and roles | 24/24 | Not run |
| Cable TV | 27/27 | Not run |
| Live status | 50/50 | Not run |
| Phase 0B | 15/15 | Not run |
| Phase 1 | 24/24 | Not run |
| Phase 2 | 17/17 | Not run |
| Wave 1 | 14/14 | Not run |
| Wave 2 | 12/12 | Not run |
| Wave 3 | 14/14 | Not run |
| Wave 4 | 14/14 | 11/11 |
| Field capture | Not run | 36/36 |
| New wave-5 | 24/24 | 24/24 |

No browser errors in any run. The customer walkthrough now opens the tree and turns on "Show services and VLANs" before reading the services, because Phase 14 folds the tree and shows services only on request.

**Another session was working in the same folder during this check.** From 13:26 that session added a 3D view (\`apps/web/src/features/view3d/\`, the \`three\` library) and edited \`App.tsx\`, \`LeftSidebar.tsx\`, \`TopNavBar.tsx\`, \`MapModeSwitch.tsx\` and \`views.ts\`. Its tests are why the web suite now has 397 tests (52 files). Wave 5 did not touch those files, apart from the Phase 15 sidebar entry, which was already there.

The new wave-5 walkthrough covers:
- A customer traced to the OLT: "Not complete", the gap shown as its own step, the diagram drawn, and no step saying "Checked good".
- Map check: findings stored on the server with no customer names. Saving a decision needs a note, and the decision is stored with it.
- Capacity: totals from records, the waiting customer counted as demand without a name, and a plan for three more homes on Splitter 1. The plan is stored on its own; the real splitter is unchanged.
- Live status: the OLT and PON ports screen says there is no live connection.
- Topology: the network tree from recorded links, the splitter no PON port reaches listed apart, and the Physical and logical tab.

**One fix made during this check:** trace steps no check covered showed "Checked good" (see the Phase 15 report).

**Walkthrough scripts updated:** the Capacity screen is closed with its own Close button. Like several older screens, it does not close on Escape.

### Wave 6: Phases 17, 21, 22 and 24b (11 November 2026)

With this wave every phase of the plan (0, 0B and 1 to 24) is built.

**Tests**

| Suite | Passed |
|---|---|
| Shared | 752 |
| Server | 221 (two tests timed out on the first run while the machine was busy; both files and then the whole suite passed on a re-run) |
| Web | 442 (441, plus the new undo test) |

Typecheck clean. Build clean. The Excel, Shapefile and picture libraries each load only when used; none is in the first download.

**Walkthroughs**

| Walkthrough | Desktop | Phone |
|---|---|---|
| Main | 57/57 | 54/54 |
| Customer | 50/50 | 50/50 |
| Fiber | 60/60 | Not run |
| Routes | 52/52 | Not run |
| Faults | 50/50 | Not run |
| Accounts and roles | 24/24 | Not run |
| Cable TV | 27/27 | Not run |
| Live status | 50/50 | Not run |
| Phase 0B | 15/15 | Not run |
| Phase 1 | 24/24 | Not run |
| Phase 2 | 17/17 | Not run |
| Wave 1 | 14/14 | Not run |
| Wave 2 | 12/12 | Not run |
| Wave 3 | 14/14 | Not run |
| Wave 4 | 14/14 | 11/11 |
| Wave 5 | 24/24 | 24/24 |
| Field capture | Not run | 36/36 |
| New wave-6 (import, export, reports) | 31/31 | 31/31 |
| New wave-6 fiber with optical budget | 72/72 | Not run |

No browser errors in any run, and no sideways scrolling at phone width.

The new wave-6 walkthroughs cover:
- **Import:** a GeoJSON file with two poles and a street line is imported step by step: columns, groups, check. The line end 3 m from Box 1 is offered but left unconnected, and the import is kept in its own history record. Undo then removes exactly those three items, leaves the rest of the network as it was, and keeps the record marked undone.
- **Saving the network:** KMZ and Excel files are saved and checked as real zip and .xlsx files.
- **Reports:** a report shows what it is made from and is saved as Excel and as PDF.
- **Optical budget:** on a fibre path recorded end to end, the panel says "Estimated, not measured" and lists the inputs not from the records. A stored run reaches the server, stays after undo, and redo puts the network back exactly.

**Two fixes made during this check:**
- "Save map file (GeoJSON)" on the Reports screen is now behind the export right (Phase 22 report).
- Undo no longer tries to remove a stored budget run or roll back a map check decision (Phase 17 report).

**Walkthrough scripts updated:** steps 11 and 12 of the routes walkthrough now go through the step-by-step import screen from Phase 21, with its new wording. The kept e2e walk `C-osp-routes` needs the same change; it was written before Phase 21 finished.

**Phase 24b deviations:** small edits to `TopNavBar.tsx` (the search note), `SyncStatus.tsx` and `CaptureApp.tsx` (loading the place where the worker stands).

**Another session** ("network-mapping-03", the 3D view) was working in the same folder during this wave. Wave 6 did not change its files.
