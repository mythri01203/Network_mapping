# FiberGIS repository audit

**Date:** 7 November 2026. **Scope:** whole repository, against `FiberGIS_Final_Master_Prompt.md` section 31.
**Method:** code read in full by module, the most serious claims re-checked by hand, plus the browser test run of the same week. No app code was changed for this audit.

**Updated after Phase 1 (same date).** Phase 1 of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) has been built on branch `feature/easy-mapping` (not yet committed). Section 7 now shows each defect's status; fixed items say what changed.

**Updated after Phase 3 (same date).** Poles and routes (spans, attachments, ducts, slack loops, permissions, separate lengths, duplicate check, KML and KMZ import, server link checks) have been built on the same branch, not committed, and checked by unit tests and by scripts in desktop Chrome at 1500 and 360 px with sample files. No engineer has used it and no real operator KML has been imported. Sections 1 to 4 are updated.

**Updated after Phase 4 (same date).** The fiber path (per-cable colour scheme and tube size, core assignment, closures with trays, splices with history, ODF panels and patches, PON port details, one splitter model, core-level trace and validators on client and server) has been built on the same branch, not committed, and checked by unit tests and by a script in desktop Chrome at 1500 and 360 px on a test server. No splicer or engineer has used it. Sections 1, 2, 3 and 7 are updated.

**Updated after Phase 5 (same date).** Customers and connections (ONT records apart from customers, ONT swap and move, disconnect and move with history, services, buildings with entry, riser, floor boxes and units, the logical service tree, reconciliation of readings and lengths, and server checks for the new records) have been built on the same branch, not committed, and checked by unit tests and by a script in desktop Chrome at 1500 and 360 px on a test server. No office user has used them. Sections 1 to 4 are updated.

**Updated after Phase 8 (8 November 2026).** Faults and field operations (alarms with a lifecycle and clearly labelled TEST events, suspected causes from recorded paths with evidence and confidence, who is affected by any element, work orders with photos, materials, notes and a check before closing, the technician's job screens at `/jobs`, per-record version checks with a "Someone else changed this" choice that keeps both versions, and server checks for the new records) have been built on the same branch, not committed, and checked by unit tests and by a script in desktop Chrome at 1500 and 360 px on a test server with a fake camera. No technician or office user has used them. Phases 6 and 7 are not started (blocked). Sections 1 to 3, 6, 7 and 9 are updated.

**Updated after Phase 2 (same date).** The phone capture flow (`/capture`) has been built on the same branch, not committed, and checked only by scripts in desktop Chrome at phone size with a fake camera and simulated GPS. Nothing was tried on a real phone or with field workers. Sections 9 and 7 (#15) are updated.

Status words: **Works** (built, saved, used end to end), **Partial** (see the note), **Missing**.

## Summary

FiberGIS is a working map and network inventory with a solid base: tested domain logic, offline sync, audit log, good equipment art. Three things stop it being a reliable engineering record today:

1. **It could show invented data as fact.** Fixed in Phase 1: the trace reports missing links instead of filling them, readings carry their origin, and fake fallbacks and "Live" labels are gone. Some example screens remain, labelled "Example values, not your network".
2. **Connections are recorded at cable level only.** Fixed in Phase 4 where the fibers are recorded: a customer trace follows the actual fiber through splitter ports, splices, the ODF port and patch to the PON port, and names the exact missing link otherwise. Older data, recorded at cable level only, now shows as incomplete until its fibers are recorded.
3. **It is hard for field staff.** No Telugu or Kannada, small buttons and text, heavy jargon, long forms.

Fix 1 and 2 before adding features: new modules built on untrustworthy data inherit the problem.

## 1. Architecture and stack

npm monorepo with three packages.

| Part | Technology |
|---|---|
| `apps/web` | React 18, Vite 6, Leaflet 1.9, zustand 5, react-router 7, Tailwind 4, jsPDF; since Phase 2 zxing-wasm 3.1.6 (QR) and Noto Sans Telugu and Kannada 5.3.0 (self-hosted fonts); since Phase 3 @tmcw/togeojson 7.1.3 (KML) and fflate 0.8.3 (KMZ unzip), both pinned and without dependencies |
| `apps/server` | Fastify 5, `node:sqlite`, Node 22.13 or newer |
| `packages/shared` | zod 4 schemas, pure domain commands |
| Quality | Vitest 4 (579 tests pass after Phase 8: shared 308, server 48, web 223; 542 after Phase 5; 519 after Phase 4; 490 after Phase 3; 449 after Phase 2; 397 after Phase 1; 326 before), TypeScript (0 errors), ESLint (33 errors, 6 warnings after Phase 8; 37 and 6 after Phases 4 and 5; 40 and 6 after Phase 3; 42 and 6 after Phase 2; 43 and 7 before Phase 1) |

Map tiles use undocumented Google URLs ([tileProviders.ts:14](../apps/web/src/features/map/leaflet/tileProviders.ts#L14)) plus OpenStreetMap. Check the licence terms before commercial use.

## 2. Database

SQLite with one generic table, `records(collection, id, position, data JSON, updated_at, version)`. Collections: equipment, cables, splitters, closures, customers, faults, workOrders, auditLogs, zones, documents, catalog, gpsRoutes, agentTrips, `settings` (operator overrides, added in Phase 1), since Phase 3 `spans`, `attachments`, `ducts`, `slackLoops` and `permissions`, since Phase 5 `onts`, `services` and `buildings`, and since Phase 8 `alarms` and `syncConflicts` (24 in all). Phase 8 added the only table change so far: a `version` column (existing rows start at 0), which the server uses to refuse a stale edit. It is added by itself when the server starts, changes no record, and leaves the schema number at 1 so an older server can still open the database. Phases 3 and 5 added only optional fields and new collections, so no table change or migration was needed; older customers keep their ONT serial in their own record until a person makes an ONT record for it.

- **Links between records: partly enforced on the server since Phase 3.** Spans, attachments, duct occupancy, slack loops and permissions must point to existing records, and a pole or cable they name cannot be deleted while they remain (HTTP 409 with a plain message; nothing written). Since Phase 4 fiber links are checked on the server too: splices, splitter inputs and outputs, ODF ports and patches, PON ports and core assignments must not add two feeds or two continuations on one fiber, a fiber that does not exist, two active assignments, a splitter output beyond its ratio, an impossible splitter loss, a second patch on one PON port, or optics that do not fit the port (HTTP 409). Since Phase 5, ONTs, services and buildings, and a customer's ONT, building and unit, must name existing records; one serial per live ONT and one customer on a one-customer ONT are enforced; a pin or cable that a building or live ONT names cannot be deleted (HTTP 409). Since Phase 8, alarms, faults and work orders are checked too: no device alarm while no OLT is connected, TEST labelled TEST, no TEST and real mix, links that exist, and nothing verified or closed without a check (HTTP 409). Since Phase 8 an edit that started from an older version of a record is refused with `version_conflict` and the current record, so offline edits no longer silently overwrite each other; clients that send no version keep last-write-wins. Cable ends and the customer's own path fields are still checked only by each record's own shape, and `updateCustomer` bypasses them. A restore is not checked against the connection rules either. A restore is not checked against the fiber rules, so older backups still load.
- Spatial queries and indexes: **Missing**. The whole network is loaded into the browser.

## 3. Existing network features

| Area | Status | Notes |
|---|---|---|
| Map layers, opacity | Works | 18 toggles |
| Search | Partial | Not closures or splitters |
| Place equipment, draw cable | Partial | Tapping a pin while drawing now joins it at any zoom (tested in Phase 1). Pins move only after "Move this item", and cable ends follow. A saved route's middle points still cannot be edited |
| Snapping | Works | 30 m |
| Export | Works | KML, GeoJSON, CSV, PDF (PDF limited to 20 rows and two reports). KML export does not include spans, ducts or slack loops yet |
| Import | Partial | JSON restore, and since Phase 3 KML and KMZ import with preview, a person's choice per folder and style, reasons for every skipped feature, and nothing connected. Tried only with sample files made for the test |
| Clustering, viewport loading | Missing | All markers always drawn |
| Equipment and ports | Partial | Port panel enrichment is invented (see section 7) |
| Cables, capacities | Works | 2 to 288 cores |
| Core colors | Works (Phase 4) | Scheme, tube colours and fibers per tube recorded per cable; TIA-598, IEC 60304 and operator schemes as data. Unknown scheme shows no colour. Not checked against a real drum sheet |
| Core status | Works | Separate badge and mark; never recolours the fiber |
| Core allocation | Works (Phase 4) | Assign or reserve with use, source, destination and dates; release keeps history; counts worked out. Customer setup marks the drop fiber, and the feeder and street fibers when the fiber path is recorded |
| Splice records | Works (Phase 4) | Tray, type, loss with origin, OTDR ref, history on re-splice; both fibers must exist; one feed and one continuation per fiber, checked network-wide and on the server. No photo or OTDR file import |
| Closures, trays | Works (Phase 4) | Set up from a pin, with trays, cables in and out, photos (sent straight to the office, no offline queue), condition, seal and dates |
| ODF | Works (Phase 4) | Panels, adapters, feeder fiber behind each and patch cord to a PON port in front, with history. Separate from splices |
| OLT | Partial | Per PON port: vendor address as written, the vendor's own levels, optics class, vendor budget, ONU limit (Phase 4). No card or chassis records beyond text, no vendor import |
| PON to feeder link | Works | Explicit, one per port |
| Splitters | Works (Phase 4) | One model with port records, input on an exact fiber or a cascade parent, outputs on exact fibers with history, couplers with a loss per output. A pin placed without a ratio has no splitter until "Add splitter". The OLT setup screen's own splitter list is still separate |
| ONT and customer | Works (Phase 5) | ONT records apart from customers (serial as entered, the OLT's address for the ONU as written, one customer or shared), swap and move with history; disconnect and move release the fiber, output and box port with a reason and keep the old connection; a used output or fiber is refused, in the browser and on the server. Customers are still never deleted, and there is no customer import |
| Services | Works (Phase 5) | Internet, IPTV, TV on the 1550 nm overlay, phone; plan only as written; ended services kept as history |
| Buildings and MDUs | Partial (Phase 5) | Entry point, riser cable, floor boxes and units, and each unit's path with the missing link named. Footprint is a point |
| Logical view | Works (Phase 5) | Topology, service tree built from recorded links only; gaps named; customers not reached listed apart. A list, not a drawing |
| Reconciliation | Works (Phase 5) | Predicted against measured Rx (a value with the port's recorded Tx, otherwise a range) and drawn against sheath against OTDR length, as next actions, with limits in settings. Only as good as the recorded losses and defaults |
| Faults and alarms | Works (Phase 8), not accepted | Alarms from people, the field or TEST only (no device alarms: "No live connection"); suspected causes from recorded paths with evidence, confidence and missing links named; full lifecycle with history; closes only with a check. No maintenance windows, suppression or escalation |
| Who is affected | Works (Phase 8) | Any cable, fiber, closure, splitter, box, PON port, OLT, pole or span, from recorded paths and attachments; incomplete paths listed apart as "may be affected" |
| Work orders | Works (Phase 8), not accepted | From a fault or on their own, random ids, steps, before and after photos, materials as entered, notes, check, history; technician screens at `/jobs`; closes only with a check |
| Trace | Works for customers (Phase 4) | Fiber by fiber through splices, splitters, ODF and patch, per direction and wavelength, four verdicts, the exact gap named. Equipment and cable targets are still traced at cable level |

## 4. Outside plant

| Item | Status |
|---|---|
| Poles, manholes, building entry | Partial (Phase 3): poles have material, height, owner as written, owner's painted number, our number and QR tag, blank shown as "Not recorded"; manholes and handholes list their ducts. Manhole cover and inside details are not recorded |
| Duct | Works (Phase 3): a line between chosen structures with status, basis, count, diameter, depth seen and permitted, sub-ducts and occupancy. The old "Duct" point type still exists |
| Aerial spans | Works (Phase 3): between two existing structures, with status and basis. "Next pole" only proposes one, drawn dashed, until the office confirms |
| Pole attachments | Works (Phase 3): explicit records of a cable on a pole or span, saved only when a person confirms. Answers "which poles support this route" and "which cables are on this pole" |
| Slack loops | Works (Phase 3): a point on a cable at a chosen pole or chamber, length entered or from cable marks |
| Separate lengths | Works (Phase 3): drawn, sheath (marks) and optical (OTDR) kept apart, with plain notes when they disagree beyond the settings |
| Duplicate check before creating | Works (Phase 3) on the engineer map and in KML import; never blocks |
| Risers, road crossings, clearances | Partial: since Phase 5 a building records its riser cable and floor boxes. Road-crossing clearances are still missing (a span can be marked as a road crossing) |
| Right-of-way and permissions | Partial (Phase 3): per-pole permission records with authority, kind, permit number, dates and rent as typed. No rate table, no expiry reminder (the map check flags an end date that has passed) |
| Inspections | Partial: a work order type |

## 5. Cable TV (HFC)

**Partial, mostly mock.** Equipment types and coax cable exist. The Cable TV page and node panel show hard-coded values with no sample label. `rfLevelDbf` is never read. Cable TV customers still pass through a PON splitter form. There is no RF loss model. HFC and PON are separated only by a display filter.

## 6. Monitoring and integrations

**Missing.** There is no SNMP, TR-069 or vendor API code. Readings come from sample data or estimates; since Phase 1 screens say "No live connection" and label each reading Estimated, Measured, Sample data or Not recorded. Since Phase 8 alarms exist, but only typed by people, reported from the field, or clearly labelled TEST; the `device_adapter` source for Phase 7 is refused in the browser and on the server, so no device alarm can be stored or shown as real. GPS tracking (Ride Navigation, Agent Tracking, Bike Mode) and OSRM routing are real.

## 7. Defects that make data silently wrong

Most serious first. All confirmed by reading the code unless marked. Status after Phase 1: **Fixed**, **Partly fixed** or **Open**.

| # | Problem | Status after Phase 1 |
|---|---|---|
| 1 | Main trace invented results: first OLT in the list, first ODF with "Tray 1, Port 12", every mid-route splitter 1:4 at 7.2 dB, fixed 85 m drop, badged "AI Link Budget Diagnostics" | **Fixed.** `opticalPathTrace.ts` uses only linked records, names each missing link in `warnings` and a gap in the chain, and shows no pass on a gap. Badge reads "Estimated link budget". Still cable level only: cores are not followed through splices |
| 2 | Estimated power saved in the measured field and labelled "Measured Rx"; with no OLT it saved 0 dBm | **Fixed.** `rxSource` and `rxMeasuredAt` added; an estimate is stored only as `calculated` with the launch used; no estimate stores nothing. Older records show Estimated, an old 0 dBm shows Not recorded |
| 3 | Fallback readings shown when none exist (-19.4 dBm; "Live Telemetry (Just Now)") | **Fixed.** Not recorded and No live connection shown instead |
| 4 | Two loss calculations disagreed; thresholds differed by screen | **Fixed.** One set of values in `opticalSettings.ts`, editable in Administration, used by trace, loss engine, provisioning, help and screens. Worked examples are tests |
| 5 | Dragging a pin moved the equipment but not its cables, and dragging was always on | **Fixed.** Pins are fixed; "Move this item" moves one pin and its cable ends as one undoable step |
| 6 | Nearness used as connection: ODF within 250 m added to traces, 30 m snap fills cable ends, nearest parent defaulted | **Fixed.** ODF by distance removed; snapped ends are only proposed until the person taps "Yes, connect". Phase 3's pole suggestions and duct ends are lists a person chooses from. Phase 4: the connect screen (was "Splice (Upstream)") starts empty and lists only real ports, and a new splitter's input is no longer taken from the first cable ending at the box |
| 7 | Invented values saved as fact: manufacturer, owner, serial number, IP, offset location, "Underground" default on an aerial cable | **Fixed.** Blank facts stay blank and show "Not recorded" |
| 8 | "Drop Pole Here" used the map center while saying "current location" | **Fixed.** Uses real GPS with accuracy, or saves nothing and says so |
| 9 | Splice form's customer path always fails; its equipment path writes wrong IDs | **Fixed (Phase 4).** The connect screen links a customer only through a splitter output the person picks, with the box and splitter ids it belongs to; the cable ends only at equipment |
| 10 | Technician screen showed "Photo Uploaded" after a failed upload | **Fixed.** Takes a real photo; reports failure when nothing was saved. Since Phase 8 that screen is replaced: it opens the job flow at `/jobs`, whose photos go to the phone's IndexedDB and upload queue, and "Mark Done" is gone (a job closes only with a check) |
| 11 | One rejected record blocked all later uploads; storage-full errors were swallowed | **Fixed.** Refused records are reported by name with a next action while the rest are sent; storage failures show "Not saved on phone" and a message |
| 12 | Activating a customer succeeded with no OLT link, showed "Customer Connected", and rated the saved 0 dBm as Pass | **Fixed.** A warning names the consequence and must be accepted; the notice says "Customer Saved, Not Linked"; 0 dBm rates as too much light, never Pass |
| 13 | A customer added before the cable was never linked afterwards | **Fixed.** Shows "Not linked"; "Link to OLT" appears once a cable reaches the box |
| 14 | Customer location defaulted to about 45 m from the box | **Fixed.** Starts empty, with Use my GPS and Pick on map; nothing fake is saved |
| 15 | Two offline phones can create the same sequential ID; with last-write-wins, one record could silently replace the other | **Fixed for field capture** (Phase 2): random 50-bit IDs made when a capture starts, and a repeated save changes nothing. Phase 3's spans, attachments, ducts, slack loops, permissions and imported records also use random IDs. The engineer screens still make sequential IDs for equipment and cables (`POLE-07`), so two offline engineers can still collide. **Since Phase 8** an edit to a record someone else changed meanwhile is refused by the server and both versions are kept for a person to choose, so an edit is never silently lost; alarms, faults and work orders now use random ids too. A clash of two new records with the same sequential id is still possible |
| 17 | Phone use failed at 360 px | **Fixed for the map screen** (tested at 360 x 740 by script, not on a real phone) |
| 18 | At the default zoom a cable could not join by tapping beside a pin, and saved with a blank end | **Fixed.** Tapping the pin joins at any zoom; a blank end needs an explicit "Save without connecting" |
| 19 | The OLT pop-up moves the map about 190 px, and a box's card can hide a customer's pin (tested) | **Open** |
| 16 | The saved network has customers pointing to house wires that do not exist: 24 in the data checked by `fibergis-map-check` | **Open** (data, not code). Traces now name each such gap |

Marked as read from code but not run: the splicing screen crash when no closures exist. That screen was rewritten in Phase 4 and opens with "Choose a closure" when none exist.

## 8. Security

- **No login.** The role is a menu choice stored in the browser, and the audit log's "user" is that choice.
- `/reset` and `/restore` can overwrite the whole network and are unauthenticated.
- No rate limits. CORS allow-list and default host `127.0.0.1` are sound.
- `npm audit --omit=dev` reports 5 vulnerabilities: 1 critical, 1 high, 3 moderate. Not yet reviewed in detail.

Do not expose the server beyond a trusted network until login exists.

## 9. Ease of use for field staff

**Phase 2 added a separate phone flow at `/capture`** (big picture tiles, camera first, automatic GPS, picture questions, dBm pad, danger report, sync chip, Telugu and Kannada drafts, offline shell). See the Phase 2 table in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). **Phase 8 added the technician's jobs at `/jobs`** in the same style (one action per screen, photos before and after, steps, material count pad, check by field light reading or photo, Undo after each save) and the "Someone else changed this" choice; see the Phase 8 table. Neither has been tried by a technician or on a real phone. Its Telugu and Kannada words are unreviewed drafts ([LANGUAGE_REVIEW.md](LANGUAGE_REVIEW.md)), no audio is recorded, and it has not been tried by a worker or on a real phone. The points below describe the engineer screens, which were left as they were.

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
