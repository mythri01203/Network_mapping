# FiberGIS repository audit

**Date:** 7 November 2026. **Scope:** whole repository, against `FiberGIS_Final_Master_Prompt.md` section 31.
**Method:** code read in full by module, the most serious claims re-checked by hand, plus the browser test run of the same week. No app code was changed for this audit.

**Updated after Phase 1 (same date).** Phase 1 of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) has been built on branch `feature/easy-mapping` (not yet committed). Section 7 now shows each defect's status; fixed items say what changed.

**Updated after Phase 2 (same date).** The phone capture flow (`/capture`) has been built on the same branch, not committed, and checked only by scripts in desktop Chrome at phone size with a fake camera and simulated GPS. Nothing was tried on a real phone or with field workers. Sections 9 and 7 (#15) are updated.

Status words: **Works** (built, saved, used end to end), **Partial** (see the note), **Missing**.

## Summary

FiberGIS is a working map and network inventory with a solid base: tested domain logic, offline sync, audit log, good equipment art. Three things stop it being a reliable engineering record today:

1. **It could show invented data as fact.** Fixed in Phase 1: the trace reports missing links instead of filling them, readings carry their origin, and fake fallbacks and "Live" labels are gone. Some example screens remain, labelled "Example values, not your network".
2. **Connections are recorded at cable level only.** A trace does not follow actual fibers through splices, so "connected" on screen does not prove light reaches the customer.
3. **It is hard for field staff.** No Telugu or Kannada, small buttons and text, heavy jargon, long forms.

Fix 1 and 2 before adding features: new modules built on untrustworthy data inherit the problem.

## 1. Architecture and stack

npm monorepo with three packages.

| Part | Technology |
|---|---|
| `apps/web` | React 18, Vite 6, Leaflet 1.9, zustand 5, react-router 7, Tailwind 4, jsPDF; since Phase 2 zxing-wasm 3.1.6 (QR) and Noto Sans Telugu and Kannada 5.3.0 (self-hosted fonts) |
| `apps/server` | Fastify 5, `node:sqlite`, Node 22.13 or newer |
| `packages/shared` | zod 4 schemas, pure domain commands |
| Quality | Vitest 4 (449 tests pass after Phase 2; 397 after Phase 1; 326 before), TypeScript (0 errors), ESLint (42 errors, 6 warnings, unchanged by Phase 2; 43 and 7 before Phase 1) |

Map tiles use undocumented Google URLs ([tileProviders.ts:14](../apps/web/src/features/map/leaflet/tileProviders.ts#L14)) plus OpenStreetMap. Check the licence terms before commercial use.

## 2. Database

SQLite with one generic table, `records(collection, id, position, data JSON, updated_at)`. Fourteen collections: equipment, cables, splitters, closures, customers, faults, workOrders, auditLogs, zones, documents, catalog, gpsRoutes, agentTrips, and `settings` (operator overrides, added in Phase 1).

- **Links between records are not enforced on the server.** Only each record's own shape is checked. Rules live in client commands, and `updateCustomer` bypasses them.
- Spatial queries and indexes: **Missing**. The whole network is loaded into the browser.

## 3. Existing network features

| Area | Status | Notes |
|---|---|---|
| Map layers, opacity | Works | 18 toggles |
| Search | Partial | Not closures or splitters |
| Place equipment, draw cable | Partial | Tapping a pin while drawing now joins it at any zoom (tested in Phase 1). Pins move only after "Move this item", and cable ends follow. A saved route's middle points still cannot be edited |
| Snapping | Works | 30 m |
| Export | Works | KML, GeoJSON, CSV, PDF (PDF limited to 20 rows and two reports) |
| Import | Missing | JSON restore only; no KML import, which Indian ISPs commonly hold |
| Clustering, viewport loading | Missing | All markers always drawn |
| Equipment and ports | Partial | Port panel enrichment is invented (see section 7) |
| Cables, capacities | Works | 2 to 288 cores |
| Core colors | Partial | One fixed order, 12 per tube. Tube color is stored only as a number |
| Core status | Works | Separate from color |
| Core allocation | Partial | Only the drop's core 1 is marked; feeder and distribution cores are not; no release |
| Splice records | Partial | Do not check the core exists. Core maximum hard-coded to 96 |
| Closures, trays | Partial | Closures cannot be created in the app; tray choice is discarded |
| ODF | Partial | Generic ports; no panels or patch records |
| OLT | Partial | Text fields, no card model. XGS-PON and 10G-EPON are kept since Phase 1 |
| PON to feeder link | Works | Explicit, one per port |
| Splitters | Partial | Two parallel models. Placing one on the map creates no port records; with no ratio recorded, the trace now reports it as a gap instead of counting 0.5 dB |
| ONT and customer | Partial | Port assignment works. No disconnect or delete |
| Trace | Partial | Follows cable ends by draw direction; ignores splices. Since Phase 1 it reports every missing link, never falls back to the first OLT or ODF, and gives no pass on an incomplete path |

## 4. Outside plant

| Item | Status |
|---|---|
| Poles, manholes, building entry | Partial: map points only, no type-specific details |
| Duct | Partial: stored as a point, not a line |
| Pole attachments, aerial spans, sub-ducts, risers, crossings | Missing |
| Right-of-way and permissions | Missing: only a "Lease Agreement" document category |
| Inspections | Partial: a work order type |

## 5. Cable TV (HFC)

**Partial, mostly mock.** Equipment types and coax cable exist. The Cable TV page and node panel show hard-coded values with no sample label. `rfLevelDbf` is never read. Cable TV customers still pass through a PON splitter form. There is no RF loss model. HFC and PON are separated only by a display filter.

## 6. Monitoring and integrations

**Missing.** There is no SNMP, TR-069 or vendor API code. Readings come from sample data or estimates; since Phase 1 screens say "No live connection" and label each reading Estimated, Measured, Sample data or Not recorded. GPS tracking (Ride Navigation, Agent Tracking) and OSRM routing are real.

## 7. Defects that make data silently wrong

Most serious first. All confirmed by reading the code unless marked. Status after Phase 1: **Fixed**, **Partly fixed** or **Open**.

| # | Problem | Status after Phase 1 |
|---|---|---|
| 1 | Main trace invented results: first OLT in the list, first ODF with "Tray 1, Port 12", every mid-route splitter 1:4 at 7.2 dB, fixed 85 m drop, badged "AI Link Budget Diagnostics" | **Fixed.** `opticalPathTrace.ts` uses only linked records, names each missing link in `warnings` and a gap in the chain, and shows no pass on a gap. Badge reads "Estimated link budget". Still cable level only: cores are not followed through splices |
| 2 | Estimated power saved in the measured field and labelled "Measured Rx"; with no OLT it saved 0 dBm | **Fixed.** `rxSource` and `rxMeasuredAt` added; an estimate is stored only as `calculated` with the launch used; no estimate stores nothing. Older records show Estimated, an old 0 dBm shows Not recorded |
| 3 | Fallback readings shown when none exist (-19.4 dBm; "Live Telemetry (Just Now)") | **Fixed.** Not recorded and No live connection shown instead |
| 4 | Two loss calculations disagreed; thresholds differed by screen | **Fixed.** One set of values in `opticalSettings.ts`, editable in Administration, used by trace, loss engine, provisioning, help and screens. Worked examples are tests |
| 5 | Dragging a pin moved the equipment but not its cables, and dragging was always on | **Fixed.** Pins are fixed; "Move this item" moves one pin and its cable ends as one undoable step |
| 6 | Nearness used as connection: ODF within 250 m added to traces, 30 m snap fills cable ends, nearest parent defaulted | **Partly fixed.** ODF by distance removed; snapped ends are only proposed until the person taps "Yes, connect". `SpliceModal.tsx` still preselects the nearest parent |
| 7 | Invented values saved as fact: manufacturer, owner, serial number, IP, offset location, "Underground" default on an aerial cable | **Fixed.** Blank facts stay blank and show "Not recorded" |
| 8 | "Drop Pole Here" used the map center while saying "current location" | **Fixed.** Uses real GPS with accuracy, or saves nothing and says so |
| 9 | Splice form's customer path always fails; its equipment path writes wrong IDs | **Open** |
| 10 | Technician screen showed "Photo Uploaded" after a failed upload | **Fixed.** Takes a real photo; reports failure when nothing was saved |
| 11 | One rejected record blocked all later uploads; storage-full errors were swallowed | **Fixed.** Refused records are reported by name with a next action while the rest are sent; storage failures show "Not saved on phone" and a message |
| 12 | Activating a customer succeeded with no OLT link, showed "Customer Connected", and rated the saved 0 dBm as Pass | **Fixed.** A warning names the consequence and must be accepted; the notice says "Customer Saved, Not Linked"; 0 dBm rates as too much light, never Pass |
| 13 | A customer added before the cable was never linked afterwards | **Fixed.** Shows "Not linked"; "Link to OLT" appears once a cable reaches the box |
| 14 | Customer location defaulted to about 45 m from the box | **Fixed.** Starts empty, with Use my GPS and Pick on map; nothing fake is saved |
| 15 | Two offline phones can create the same sequential ID; with last-write-wins, one record could silently replace the other | **Fixed for field capture** (Phase 2): random 50-bit IDs made when a capture starts, and a repeated save changes nothing. The engineer screens still make sequential IDs (`POLE-07`), so two offline engineers can still collide |
| 17 | Phone use failed at 360 px | **Fixed for the map screen** (tested at 360 x 740 by script, not on a real phone) |
| 18 | At the default zoom a cable could not join by tapping beside a pin, and saved with a blank end | **Fixed.** Tapping the pin joins at any zoom; a blank end needs an explicit "Save without connecting" |
| 19 | The OLT pop-up moves the map about 190 px, and a box's card can hide a customer's pin (tested) | **Open** |
| 16 | The saved network has customers pointing to house wires that do not exist: 24 in the data checked by `fibergis-map-check` | **Open** (data, not code). Traces now name each such gap |

Marked as read from code but not run: the splicing screen crash when no closures exist.

## 8. Security

- **No login.** The role is a menu choice stored in the browser, and the audit log's "user" is that choice.
- `/reset` and `/restore` can overwrite the whole network and are unauthenticated.
- No rate limits. CORS allow-list and default host `127.0.0.1` are sound.
- `npm audit --omit=dev` reports 5 vulnerabilities: 1 critical, 1 high, 3 moderate. Not yet reviewed in detail.

Do not expose the server beyond a trusted network until login exists.

## 9. Ease of use for field staff

**Phase 2 added a separate phone flow at `/capture`** (big picture tiles, camera first, automatic GPS, picture questions, dBm pad, danger report, sync chip, Telugu and Kannada drafts, offline shell). See the Phase 2 table in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Its Telugu and Kannada words are unreviewed drafts ([LANGUAGE_REVIEW.md](LANGUAGE_REVIEW.md)), no audio is recorded, and it has not been tried by a worker or on a real phone. The points below describe the engineer screens, which were left as they were.

- **Language:** engineer screens English only. The capture flow has its own small translation layer.
- **Touch:** default buttons are 28 and 32 px against a 48 px target. Since Phase 1, below 768 px the map toolbar, top bar, menu, map controls and dialog buttons are 48 px. About 570 uses of 10 and 11 px text remain.
- **Modes:** a simple mode exists and uses good labels ("Main Road Line", "House Wire"), but that panel starts closed and other screens return to jargon.
- **Worst screens:** splice form ("Upstream Parent Node"), splicing matrix, seven-tab OLT setup, customer form (typed coordinates, "CPE", "provision FTTH lead").
- **Steps today:** pole 2 to 3 taps for the first, then one tap per pole: since Phase 1 the pole tool stays on and numbers each pole. Cable 6 or more, plus one tap to confirm the ends. Customer takes a few more taps than before because location and serial are no longer silently filled in.
- **Offline:** data is cached and queued. Since Phase 2 a service worker (production builds, https or localhost only) lets the app open with no signal after one visit; map tiles still need a connection. The fake "Simulate offline draft" toggle was replaced in Phase 1 by the real sync state.
- **Good to keep:** equipment illustrations, knowledge base beginner view, plain labels.

## 10. Reusable assets

Pure domain commands and their tests, sync engine, undo and audit store, `EquipmentIllustration` art, knowledge base, GPS tracking stores, OSRM proxy, KML and GeoJSON exporters.

## 11. Repository housekeeping

- `network mapping/` inside the project root is an old, git-ignored copy of a build. Safe to review and remove; left in place.
- Agent Tracking and the custom equipment type fix are still uncommitted.

## Not verified

Behaviour on real phones, real GPS on a ride or a street, a real camera scanning a printed QR tag, https deployment, sunlight readability, PDF and CSV contents, and the backup restore screen were not run. The JSON backup does not include field photos (they are files beside the database). Parts of `OperationsHubView.tsx`, `BikerModePanel.tsx` and `AgentTrackingView.tsx` were not fully read.

Items 8 to 12 of section 31 (changes, libraries, risks, plan) are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
