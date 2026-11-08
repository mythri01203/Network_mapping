# FiberGIS implementation plan

**Status: approved. Phases 1 and 2 are committed on branch `feature/easy-mapping` (commit `7cc0d7b`). Phases 3, 4, 5 and 8 are committed (commit `e45bd5c`) and Phase 9 is built on the same branch. Phase 6 waits for the operator interviews and Phase 7 for OLT vendor access.** Phase 9 was checked by unit tests and by scripts in desktop Chrome at 1500 and 360 px on test servers; nobody has logged in on a real phone, so it is built but **not accepted**. Phase 8 was checked by unit tests and by a script in desktop Chrome at 1500 and 360 px on a test server, with a TEST event and a fake camera; no technician or office user has used it and no real outage was handled, so it is built but **not accepted**. Phase 5 was checked by unit tests and by a script in desktop Chrome at 1500 and 360 px on a test server; no office user has tried disconnect, move, ONT swap or buildings, and no real MDU was recorded, so it is built but **not accepted**. Phase 2 was checked only by scripts in desktop Chrome at phone size, with a fake camera and simulated GPS. Its acceptance test, 12 to 16 workers on a real street, has not been run, so Phase 2 is built but **not accepted**. Phase 3 was checked by unit tests and by scripts in desktop Chrome at 1500 and 360 px with sample files; it has not been tried with an engineer or with a real operator's KML, so it is built but **not accepted**. Phase 4 was checked by unit tests and by a script in desktop Chrome at 1500 and 360 px on a test server; no splicer or engineer has used it and no real drum sheet or OLT export was entered, so it is built but **not accepted**. It covers items 8 to 12 of section 31 of `FiberGIS_Final_Master_Prompt.md`, based on [AUDIT_REPORT.md](AUDIT_REPORT.md) and `reports/ISP and cable TV mapping rules.md`.

## Decisions needed from you

| # | Decision | Recommendation |
|---|---|---|
| 1 | Approve the order below, which differs from the prompt's by doing honesty and easy capture first | Yes. Your staff get value soonest, and later phases build on correct data |
| 2 | Field languages first | Telugu and Kannada, since the sample network is in Bengaluru and your prompt names Telugu. Please confirm where your crews work |
| 3 | Keep SQLite or move to PostgreSQL with PostGIS | Keep SQLite until about 50,000 records or several servers are needed. It is a large change with no benefit today |
| 4 | Map tiles | Replace undocumented Google URLs with a licensed or OpenStreetMap source before selling this |
| 5 | Interview 5 to 10 cable operators before building Cable TV | Yes. Today's picture of Indian LCO plant rests on seller listings and could be wrong |
| 6 | Who reviews safety wording | A qualified safety person, before any safety text reaches staff |
| 7 | Real OLT integration | Need the vendor and model of your OLTs, and access to one, before Phase 7 can start |

## Phases

The prompt lists 14 phases. These group them by what field staff and engineers need first. Each phase ends with its tests passing and existing features rechecked.

### Phase 1: Stop wrong data (first)

**Why first:** everything later depends on it. Small and low risk.

- Rewrite the main trace to report gaps instead of inventing them
- Stop saving estimates as measured. Add origin (`designed`, `calculated`, `field_measured`, `device_reported`) to readings, and show "Not recorded" or "Estimated"
- Remove fake fallbacks and "Live" labels
- Use one loss calculation and one editable settings table
- Stop saving invented serials, owners and locations
- Fix: clicking pins while drawing, unintended pin dragging, "Drop Pole Here" position, sync blocking after one rejected record

**Accept when:** a cable joins at any zoom level; a customer with a missing link shows the exact gap; the budget calculator reproduces the worked examples in `fibergis-ftth-mapping`; no screen says Measured or Live without a real source; a cable can be finished by tapping the box.

### Phase 2: Easy field capture

A separate phone flow alongside the engineer screens, which stay as they are.

**Build these first, or the flow can lose data:** photos in IndexedDB with an upload queue instead of `localStorage`, reported storage failures, unique IDs so two offline phones cannot overwrite each other, https, and a service worker.

- Large picture tiles, camera first, automatic GPS with accuracy stored, a "same pole?" check, photo choices, summary card
- Continuous pole placement and "next pole" linking
- QR scanning of pre-printed tags
- Number pad with no typed minus sign or decimal
- "Saved on phone", "Sending", "Sent to office"
- Telugu and Kannada framework with a crew-tested glossary, then recorded audio
- Service worker so the app opens offline

**Accept when:** the targets in `fibergis-easy-field-ux` are met on a real street with 12 to 16 workers, with zero lost data.

**Built (November 2026), not yet accepted:**

| Item | State |
|---|---|
| Photos in IndexedDB, compressed; separate upload queue with retries; `/api/v1/photos/<id>` on the server | Built, unit and script tested |
| Random capture IDs, idempotent save, display names kept apart | Built, unit tested |
| Storage failures reported ("Not saved on phone") | Built, unit tested |
| Service worker and manifest; app opens offline after one visit | Built, script tested on localhost. Needs https on phones; see `DEPLOYMENT_GUIDE.md` |
| Tiles, camera first, averaged GPS, "same one?", QR with "No tag", picture questions, summary, Next, Undo, Finished | Built, script tested. QR decoding is unit tested; scanning a real printed tag with a real camera is not |
| "Next pole" | Records order only (`previousAssetId`). Spans are Phase 3 |
| dBm pad, light reading stored as `field_measured` with meter photo | Built, script tested |
| Report danger as an unsafe Safety Hazard fault | Built. Safety wording is draft until decision 6 |
| Sync chip: Saved on phone, Sending, Sent to office | Built, script tested offline and back online |
| Telugu and Kannada | Framework and draft strings only. **No string reviewed**, glossary untested; see `LANGUAGE_REVIEW.md` |
| Recorded audio | Mechanism only. **No clips recorded** |
| Office list of captures to place or check | Built (Operations, Field captures). Hazards with no GPS fix cannot be moved on the map yet |
| Library choices | Own i18n, IndexedDB wrapper and service worker instead of i18next, Dexie and vite-plugin-pwa; zxing-wasm for QR (maintained; jsQR has had no release since 2021) |

### Phase 3: Real poles and routes

Attachments, aerial spans, slack loops as points, ducts as lines with occupancy, manholes, type-specific details, owner and permission on each pole, separate drawn, sheath and optical lengths, duplicate check before creating, KML and KMZ import.

**Accept when:** an engineer can answer "which poles support this route?" and "which cables are on this pole?", and a real KML file imports without assumptions.

**Built (November 2026), not yet accepted:**

| Item | State |
|---|---|
| Spans (`spans`): two end structures, status `proposed`, `planned`, `built`, `verified`, and a basis | Built, unit and script tested. A span is a structure, never a cable |
| "Next pole" in field capture | Now also records a **proposed** span with basis `field_sequence`, drawn dashed, which the office confirms ("Yes, built", "Yes, planned", "Not a span") in the span panel or in Operations, Field captures. Undo removes it with the pole |
| Attachments (`attachments`): one cable on one pole or one span, confirmed by a person | Built. "Find poles near this line" lists poles within the corridor setting; none is ticked and nothing is saved until a person ticks each and chooses how sure. Never made from nearness alone |
| Ducts (`ducts`) as lines, with sub-ducts and occupancy (which cables are in the duct or each sub-duct) | Built. Drawn with "Start duct here" on a manhole, handhole, chamber or building entry; the end is chosen from a list, never taken from the nearest pin. A cable listed twice in one duct is refused |
| Manholes and handholes | Already points; now show the ducts that start or end there |
| Slack loops (`slackLoops`) as points on a cable, at a chosen pole or chamber, with a length entered or worked out from the cable marks | Built, unit tested; not in the walkthrough |
| Pole details: material, height, owner as written (BESCOM, Own, BBMP...), owner's painted number, our number, QR tag | Built. Blank shows "Not recorded"; nothing is filled in |
| Permissions (`permissions`): authority, kind, permit number, dates, rent and terms as typed | Built. No rate table or countdown, as `india-rules.md` requires |
| Lengths kept apart: drawn (worked out geodesically from the line), sheath (marks at both ends, metres or feet), optical (OTDR, with date and note) | Built. None overwrites another. Differences beyond the settings are shown in plain words |
| "Same one?" before creating a pole, chamber or box on the engineer map | Built. Same kind within the setting (default 5 m): shows the existing item and its photo, "Same one: show it" or "No, add a new one". Never blocks; "new" is written to the audit trail. Field capture keeps its own Phase 2 check |
| Settings with source (`osp.*` in the `settings` collection; Administration, Poles and routes settings) | Duplicate radius, pole suggestion corridor, three length-difference limits |
| KML and KMZ import (Administration, Backup & KML; or the data menu) | Built. Preview first; the person says what each folder and style group is (or "Do not import") and whether it exists or is planned; names, descriptions, folders, styles and ExtendedData are kept as written; altitude dropped; KML lengths ignored; positions marked imported with unknown accuracy; swapped, 0,0, out-of-range, multi-part and area features skipped with a reason; points that look like existing items are held back unless ticked; nothing is connected; one undo removes the import. **Tried only with sample files made for the test, not a real operator's KML** |
| Engineer answers | Cable panel: "Poles supporting this route", in order along the line, from attachments and spans. Pole panel: "Cables on this pole". Both say plainly when nothing is recorded. Script tested |
| Server link checks | Built. Spans, attachments, duct occupancy, slack loops and permissions must point to existing records, in the store or the same change set; deleting a pole or cable that a remaining record names is refused; a restore that would leave broken links is refused. Plain message, HTTP 409, nothing written. The same rules (`findBrokenLinks`) run in the browser commands. Deleting a pole or cable in the app removes or updates the records that name it, and says so before deleting |
| Existing records | Keep working: every new field is optional and the new collections start empty, so no database migration was needed |
| `fibergis-map-check` | New rules for spans, attachments, ducts, slack loops, permissions and same-kind duplicates; 26 checker tests. A bug that ignored the first command-line argument was fixed |
| Library choices | `@tmcw/togeojson` 7.1.3 (KML to GeoJSON with folders) and `fflate` 0.8.3 (KMZ unzip), pinned, no dependencies of their own; `npm audit` unchanged at 14 (5 in production). Own small distance-to-line helper instead of Turf |

**Not done in Phase 3:** KML export does not yet include spans, ducts or slack loops. Spans and attachments cannot be imported (by design: they are never inferred). The engineer screens still make sequential IDs for equipment and cables (`POLE-07`); the new outside-plant records use random IDs. Pole-to-pole span length is shown from the map and an entered measurement only; no sag or clearance checks.

### Phase 4: Real fiber path

Per-cable color scheme and tube size, core allocation and release, closure creation, trays, splice validation with history, ODF panels and patches, one splitter model with cascades, and trace following actual cores through splices. Includes the validators in `fibergis-ftth-mapping`.

**Accept when:** end-to-end example A in the prompt traces core by core; conflicting splices and allocations are rejected; a 96F cable with a non-TIA scheme works.

**Built (November 2026), not yet accepted:**

| Item | State |
|---|---|
| Colour schemes as data | TIA-598, IEC 60304 (only its first three colours are confirmed by the research; the rest is the commonly published DIN order, flagged in its source note), "Not known", and operator schemes typed from a drum sheet (Administration, Optical settings, Fiber colour schemes; stored as `fiber.scheme.<key>`) |
| Per-cable layout | `colorScheme`, `tubeColorScheme`, `fibersPerTube`, `tubeCount`, `layoutSource` on the cable. Identity is the fiber number, `(tube − 1) × fibers per tube + fiber`; tube colour is separate from fiber colour. A layout that does not divide the count is refused. Older cables and new ones are "Not known": no colour shown, "Blue may not be fiber 1. Check the drum." New cables no longer store TIA-598 colours. Status is a separate badge and mark; it never changes the colour |
| Core assignment and release | Kind (in use or reserved), use, source, destination, dates; release keeps the record as history. A second active assignment is refused in the browser and on the server. Used, reserved, free and damaged counts are worked out from the records |
| Customer setup marks its fibers | The drop fiber is given to the customer. When the splitter input is linked to a fiber recorded back to a PON port, the feeder and street fibers on that path are marked in use for that PON, and the customer is linked to that OLT port even through an ODF patch no cable shows. When the path is not recorded, nothing is guessed: the notice names the first missing link |
| Closures | Set up from a closure, FDT, FDMS or box pin, with trays, cables in and out, photos, condition, seal and dates. A closure photo is sent straight to the office; with no connection it is not saved and the screen says so (no offline queue here, unlike field capture) |
| Splices | Closure, tray, from and to fiber (both chosen by the person; nothing preselected), fusion or mechanical, loss optional with its origin, OTDR reference, technician, date, planned or done. "Out of service" and "Re-splice" keep the old splice as history; "Entered by mistake" deletes. Tray diagram shows each fiber pair with its colour (when known) and a line between |
| ODF panels, ports and patches | Panels with numbered adapters; the feeder fiber behind each port and the patch cord in front to an OLT PON port, each with history. A patch is not a splice. A second patch on one PON port is refused |
| PON ports | Vendor address kept exactly as typed, the vendor's own levels (no fixed chassis/slot shape), technology, optics class per port and how it is known, vendor budget kept apart from the class, ONU limit, optional direct feeder fiber. A class that does not fit the technology is refused. Counts and readings say "No live connection" (Phase 7) |
| One splitter model | A splitter pin placed with a ratio gets its port records; otherwise the box offers "Add splitter". Input linked to an exact fiber or to another splitter's output (cascade); outputs connected to an exact fiber with history; an output beyond the ratio is refused; unequal couplers (such as 90/10) carry a loss per output; a loss below `10·log10(N)` is refused. The splitter input is no longer taken from the first cable that ends at the box |
| Core-level trace | `traceCustomerCores` follows the drop fiber back through splitter outputs, cascades, splices, ODF port and patch to the PON port, and names the exact missing link (such as "Fiber 3 (Green, in tube 1) of Street B has no recorded link on its OLT side"). Down and up are worked out per wavelength by `calculateOpticalLossBudget`, against the port's recorded class, with the four verdicts and the vendor budget shown apart. The customer traces use it when complete; otherwise they show the cable route, marked incomplete with the fiber gap. Cable-level totals now also go through `calculateOpticalLossBudget`, so there is one loss calculation |
| Validators | `fiberRules.ts` (`findFiberProblems`, `newFiberProblems`): errors for two feeds or two continuations on a fiber, fibers that do not exist, two assignments on a core, tube layout, splitter overflow and impossible loss, cascade loops, two OLT ports on one tree, two patches on one PON port, class against technology. Warnings (colour mismatch at a splice when both cables share a scheme, splice loss above the redo level, cable not recorded at the closure, damaged fiber, split product, ONU limit, PON spread, path budget) ask "Save anyway" and the acceptance goes into the audit trail. Errors are refused on the server too (`apps/server/src/lib/linkGuard.ts`), HTTP 409, nothing written; problems already stored are not blamed on a new change |
| Settings with source | New "Path checks" group: splice redo level 0.2 dB, split product 64, PON spread 15 dB and 20 km |
| Map check | 14 new rules for fibers, splices, splitters, ODF and PON ports (9 must fix, 5 good to know); 32 checker tests |
| Existing data | Every new field is optional and no collection was added, so no migration was needed. Older cables are "Not known" scheme. A restore from backup is not checked against the fiber rules, so an older backup still loads |
| Library choices | None added. `npm audit` unchanged |
| How it was checked | 273 shared, 34 server and 212 web unit tests (worked example 12 km, 1:4 + 1:16: 25.6 dB down, 26.8 dB up, reproduced core by core). A browser script on a test server (`fiber-walk.mjs`, outside the repo) builds example A through the screens (PON port, layouts, ODF panel, feeder fiber and patch, closure with trays and a photo, splice, splitter, customer), traces it core by core, takes the splice out and checks the exact gap is named, re-splices, tries a conflicting splice and a second assignment (both refused, in the browser and on the server), and checks a 96F IEC cable and an unknown-scheme cable: 43 of 43 checks at 1500 x 950 and at 360 x 740, no browser errors |

**Not done in Phase 4:** splice photos are a field on the record with no button yet, and closure photos have no offline queue; no splice import from a splicer or OTDR file; dual-input (2:N) splitters are only a flag; a fiber cut mid-span inside an express closure is not modelled; loss values for 1577 and 1270 nm are not in settings, so XGS-PON uses the 1550 and 1310 nm values and says so; the trace for equipment and cable targets is still cable level; customer disconnect and reassign (which would release fibers) are Phase 5. The engineer screens for fibers are in English only and were designed for office staff, not field crews.

### Phase 5: Customers and connections

Disconnect and reassign, ONT records separate from customers, multiple services per building, buildings with entry, riser and floor, logical and physical views, reconciliation (predicted against measured Rx, drawn against sheath length).

**Accept when:** a disconnect frees the fiber and output with history and a reason; a move onto a used output or fiber is refused; an ONT swap keeps the old ONT as history; every unit of an MDU shows its path or the exact missing link; the logical view names every missing link; a measured reading far from the prediction is flagged with a next action.

**Built (November 2026), not yet accepted:**

| Item | State |
|---|---|
| ONT records (`onts`) | Serial exactly as entered (never generated), vendor, model, technology, firmware, the OLT's address for the ONU as written, PON port, splitter output and drop fiber it uses, status with who said it (`person`, `device_reported`, `customer_record`), history. "One customer" or "shared (MDU unit)" is recorded per ONT, not assumed. One serial on two live ONTs, and a second customer on a one-customer ONT, are refused. Screen says "No live connection to the OLT, so online status is not known" |
| Older customers | Keep working: their ONT is read from the embedded `ontSerialNumber`. "Make ONT record" creates a record from it on request (vendor and model left blank, only links that exist copied). No stored data was migrated, so no backup was needed. The customer's `ontSerialNumber` is kept in step with its ONT record, so older screens and the trace still show the right serial |
| ONT swap and move | "Swap ONT" keeps the old ONT as `removed` with the reason and what replaced it; customers and services on it move to the new one. "Use another ONT" moves a customer to an ONT in stock or a shared one; the old ONT goes back in stock with its link in its history |
| Disconnect | Needs a reason. Releases the drop fiber (assignment kept with `releasedAt` and the reason), frees the splitter output (history line), the box port and the PON count, unlinks the ONT (back in stock unless shared), ends the services, and keeps the whole old connection in the customer's `connectionHistory`. The drop cable record stays. A fiber given to someone else is left alone and named |
| Move and reconnect | One command for both. The new output must be free (not used, cascaded, faulty or reserved) and the fiber must not be given to anyone else, in the browser and on the server (same rules). The same drop fiber is re-plugged when the new splitter is in the same box; otherwise the person chooses the fiber. The fiber is released and given again, so its history shows the move. The OLT link is worked out again from the recorded fibers (`traceCustomerCores`); when they do not reach a PON port the customer shows as not linked and the gap is named. An earlier reading is cleared and noted, because it was for the old connection |
| Services (`services`) | Internet, IPTV, TV on the same fiber (1550 nm overlay), phone, other; status; plan only as written (blank stays "not recorded", no tariff); the ONT and ONT port as written. Ended services stay as history. The screen says when two services share one drop fiber |
| Buildings (`buildings`) | Set up from a Building Entry Point pin: name, kind (house, apartment block, shops, office, industrial, campus, other), floors, entry point, riser cable, floor boxes (with their pin and splitter), units (flat or shop, floor, floor box). Footprint is a point. A customer is placed in a unit from their panel. Each unit shows its path, OLT to entry to riser to floor box to drop to ONT to customer, with each missing link named ("Riser cable not recorded", "No floor box recorded for 303"). A house skips riser and floor box |
| Logical view | Topology, "Service tree (from records)": OLT → PON port (vendor address) → splitter stages → output → ONT → customer → services, walked downstream from each PON port through patches, ODF ports, splices and splitters only. A fiber that leads nowhere is shown in red with its name; customers and splitters not reached from any PON port are listed apart with their first missing link. Cycle protected. No graph library. The older "Equipment by type" view is kept and labelled as not showing connections. The physical view is the map plus the Phase 4 core-level trace |
| Reconciliation | Topology, "Readings and lengths", and "Reading against the records" on each customer. Only a meter or OLT reading counts as measured; a calculated value says so and asks for a reading. With the PON port's recorded launch power the expected Rx is a value; without it, a range from the class, and a gap is flagged only outside the whole range, otherwise "record the real launch power". Limits: the existing "Measured below expected" (3 dB) and a new "Measured above expected" (3 dB, proposed, with source note) in Optical settings. Lengths: drawn, sheath and OTDR compared with the Phase 3 limits. Every result ends in a plain next action ("Clean and check the connector at the box…", "Check the OTDR test was on this cable…") |
| Server link checks | `apps/server/src/lib/linkGuard.ts` runs `checkChangeSetConnections` (`packages/shared/src/domain/connectionRules.ts`), the same rules the browser commands use: ONTs, services, buildings and customers must name records that exist; one serial per live ONT; one customer on a one-customer ONT. Deleting a pin or cable a building or live ONT names is refused, in the app (plain message) and on the server (HTTP 409). Removed ONTs and ended services are history and not checked. Customers on one shared ONT may use one drop fiber without a fiber error |
| Map check | 22 new rules for ONTs, services, buildings, units and disconnects (10 must fix, 7 to check, 5 good to know); disconnected customers no longer raise path warnings; 38 checker tests. The new rules name customers by id only |
| Field staff | Nothing field-facing changed. Disconnect, move, ONT swap and buildings are office screens, in English. Recording a disconnect or an ONT swap in the field (`/capture`, scan the new ONT's label) is not built |
| Library choices | None added. `npm audit` unchanged |
| How it was checked | 292 shared, 38 server and 212 web unit tests. A browser script on a test server (`customer-walk.mjs`, outside the repo) builds example A, adds two customers through the wizard, makes an ONT record, adds two services, sets up an MDU with a floor box and two units and checks each unit's path, disconnects one customer and checks every release and history line, moves the other and checks a used fiber is refused (and two refusals sent straight to the server), swaps an ONT, shows the logical view, takes a splice out to check the gap is named, and flags a measured reading far from the prediction |

**Not done in Phase 5:** no field capture for disconnect or ONT swap; no customer import; no customer-to-unit step in the customer wizard (it is a separate step on the customer panel); a customer on a shared ONT with no drop of their own cannot be added through the wizard, which always provisions a splitter output; alarms, tickets and status history from a device need Phase 7 and 8; the logical view is a list, not a drawing; a restore from backup is not checked against the connection rules; personal data is not yet protected by permissions (Phase 9), and the older map-check customer rules still print names.

### Phase 6: Cable TV

**After the operator interviews.** Replace mock screens with real records. Directional RF tree, powered and passive nodes, taps, unit-safe levels with test point offset, separate customer flow, overlay on shared fiber, switchable level profiles.

**Accept when:** end-to-end example D works, and no value on the Cable TV page is hard-coded.

### Phase 7: Live monitoring

**Blocked until decision 7.** Adapter for your actual OLT, readings with source and time, stale data handling, online/offline/LOS history. Until then the app says "No live connection".

### Phase 8: Faults and field operations

Evidence-based correlation worded as "suspected", affected customers from real paths, full alarm lifecycle, work order photos and verification, conflict handling for offline edits.

**Accept when:** end-to-end example C works with a clearly labelled TEST event; a fault or work order cannot close without a check; example E keeps both versions and lets a person choose; a technician finishes a real job on a real phone with no help.

**Built (November 2026), not yet accepted:**

| Item | State |
|---|---|
| Alarms (`alarms`) | One record per alarm on one element (customer, ONT, splitter, PON port, OLT, cable, one fiber, closure, pin, span), with kind (LOS, ONT offline, low light, PON port fault, OLT not reachable, damage, danger, other), severity, first and last seen, a count when reported again while open (no duplicate), note, who, acknowledged and cleared with history. Sources: `manual` (office), `field_report`, `test`, and `device_adapter`, which is refused in the browser and on the server until Phase 7. Screens say "No live connection" |
| TEST events | Office, Faults and field work, Make a TEST event: choose a splitter, tick its customers (only customers on recorded paths are listed), or choose any element. Marked "TEST · not real" on alarms, faults, work orders, the map pin, Bike Mode and the phone; not counted in the menu bar, sidebar or dashboard; left out of the fault report unless "Include TEST events" is ticked. TEST and real alarms are never grouped together; a fault mixing them is refused |
| Fault lifecycle | Raised → Acknowledged → Assigned → In repair → Repaired → Verified → Closed, with On hold (returns to the step it left). Each step keeps who, when and a note in the fault's history. Verified and Closed need a check; closing clears the fault's alarms and closes its verified jobs. Older statuses still load; "Resolved" (written before checks existed) is shown as such and can no longer be written. A closed fault does not reopen: open a new one |
| Suspected causes (`faultCorrelation.ts`) | Open alarms are grouped within a time window and by the element their recorded fiber paths share (`traceCustomerCores`), real and TEST apart. Shown as "Suspected: splitter Splitter 2 (SPL-2)" with evidence ("5 of 6 customers recorded on splitter … are reported down (1 have no alarm), 83%", the paths, the timing, "a customer with no alarm is not proven to be working"), a confidence (low, medium, high) and checks to do first. A missing link lowers the confidence one step and is named ("1 more customer may be on …: no drop cable recorded"). Elements that carry exactly the same customers are named on one suspicion instead of listed again. One customer down alone points at their own house. Several PON ports on one OLT, an OLT not reachable, and damage reports are listed per element. Always "not proof of a physical cut" |
| Settings with source | Administration, Fault checks settings (`fault.*`): window 15 min, at least 2 customers, high 80%, medium 50%, 2 PON ports for an OLT. All proposals, with reasons |
| Who is affected (`faultImpact.ts`) | For a cable, one fiber, a closure, a splitter, a box, a PON port, an OLT, a pole or a span: customers whose recorded path passes through it, with their live services. Poles and spans use Phase 3 attachments only; a pole with none says nobody can be listed. Customers whose path is incomplete are listed apart as "May be affected: path not fully recorded", with the record that names the element and the first missing link. Nothing from distance. Names and ids only, as the office screens already show |
| Work orders | Made from a fault (title, technician, steps from the suspected checks) or on their own (Operations, Create Work Order), random ids. New, assigned, accepted, in progress, on hold, repair done, verified, closed, cancelled; each move in the history. Before and after photos, a step list, materials as entered, field notes and the check are on the record. The office can assign, record an office check, and move or close it; Verified and Closed are refused without a check. The invented technician phone number on the old form is gone |
| Checks before closing | A light reading `field_measured` with its meter photo, a photo of the working service, or an office check with a note of what was checked, with who and when (`verificationProblem`). Refused otherwise in the browser and on the server (HTTP 409) |
| Repair, check and resolution history | The fault shows one timeline of its own history and its jobs', oldest first, each line saying where it is from |
| Technician's jobs (`/jobs`) | Built to `fibergis-easy-field-ux`: "Who are you?", job cards with a picture, one action per screen, 48 px or larger targets, Start job, photo before, tick steps, material (picture, then a digits-only count), optional note, Stop for now, photo after, Repair done, check (field light reading with the meter photo and the dBm pad, or a photo), "Saved" with Undo after each action, the same Saved on phone / Sending / Sent to office chip, TEST line. Each action is one job event saved first to the phone (IndexedDB) and its photos through the Phase 2 upload queue; a repeated save adds nothing. The phone changes only the work order; the office closes the fault. Show the way opens Bike Mode, which uses real GPS only. The old technician phone view (with "Mark Done" and a photo kept inside the equipment list) now opens `/jobs`, and Field Work no longer has a Complete button. Words in English with unreviewed Telugu and Kannada drafts |
| Offline conflicts (example E) | Every stored record has a version (a column added when the server starts; existing rows are version 0; the schema number stays 1, so an older server can still open the database). The browser sends the version each edit started from; the server refuses a stale one with `version_conflict` (HTTP 409) and the current record, writing nothing. The browser keeps its own version, holds it unsent, sends everything else, and saves both versions in a conflict record (`syncConflicts`). The phone (or office) shows "Someone else changed this" with Theirs and Mine and three answers: Keep theirs, Keep mine (sent over theirs, checked against the version shown), Office decides (the office chooses in Operations, Changed twice: Use the phone version or Keep the office version). Both versions stay whatever is chosen, and each choice is in the audit trail. When both sides already hold the same record there is nothing to choose. Clients that send no versions keep last-write-wins. New records with random ids never collide |
| Server checks (`linkGuard.ts` → `faultRules.ts`) | Same rules in the browser commands: no device alarm, TEST labelled TEST and only TEST, no TEST and real mix, alarms, faults and jobs must name records that exist (a fault a job still names cannot be deleted), nothing verified or closed without a complete check, "Resolved" not written again. Problems already stored are not blamed on a change |
| Map check | 13 new rules (6 must fix, 4 to check, 3 good to know): device alarm, TEST label, closed or verified without a check, incomplete check, TEST mix, alarm on a missing element, affected customers missing or on broken paths, open job on a closed fault, older "Resolved" faults, jobs waiting for a check, conflicts waiting; 44 checker tests. Ids only, never names |
| Library choices | None added. `npm audit` unchanged |
| How it was checked | 308 shared, 48 server and 223 web unit tests. A browser script on a test server (`fault-walk.mjs`, outside the repo; office and phone in separate browser contexts, fake camera) runs example C and example E at 1500 x 950 and at 360 x 740: 50 of 50 checks at each size, no browser errors. It checks the TEST alarms and labels, the suspicion and its evidence and confidence, the affected and may-be-affected lists, the refusal to close without a check on screen and by the server, the job on the phone (photos, step, material, field reading, Sent to office, photos on the server), the office closing it with the history, and in example E the conflict choice, both versions kept on the server, and the office using the phone version. The earlier walkthroughs still pass: main 56 and 53, capture 36, routes 52 and 52, fiber 43 and 43, customer 48 and 48. In one earlier phone run the fake camera did not start once and the app showed its "Open camera" fallback; the script now uses that fallback when needed and reports it (0 times in the final runs) |

**Not done in Phase 8:** no live alarms (Phase 7); no maintenance windows, alarm suppression or escalation; correlation does not weigh splitter ratios or loss budgets, and "no alarm" only means nobody reported one; conflicts are found per record, not per field, so two people changing different fields of one job still get a choice; `PUT /api/v1/<collection>/<id>` has no version check (the app does not use it); the office fault screens are English engineer screens with small controls; no field capture of a disconnect or ONT swap; the technician's identity is a choice on the phone, not a login (Phase 9); photos from the job flow are not in the JSON backup (they are files beside the database, like Phase 2). Nothing was tried with a technician, on a real phone, or with a real outage.

### Phase 9: Reports, security, production

Login and enforced roles, protected reset and restore, rate limits, https deployment, reviewing `npm audit` results, clustering and viewport loading, complete reports.

**Move login earlier if** the server will be reachable from outside a trusted network before Phase 9. It must not be exposed without it.

**Built (November 2026), not yet accepted:**

| Item | State |
|---|---|
| Login and roles (admin, engineer, office, technician, viewer), scrypt password hashes, httpOnly SameSite session cookie, logout, password change, user management | Built, unit and script tested. Roles are enforced on the server per collection and action and mirrored in the screens. The audit log names the real person |
| Setup mode | Login stays off until the first administrator account is made in the app (or `AUTH_REQUIRED=true`), so an existing server is not locked out. Unsent changes are kept when the server asks for a login and sent after it |
| `/jobs` technician | The logged-in technician, not a name picked on the phone |
| Reset and restore | Administrator only once login is on; a safety copy is saved first; a restore is checked against the link, fiber, connection and fault rules and refused with a list ("Nothing was restored…") unless the administrator accepts the problems. `GET /api/v1/backup?photos=1` gives a zip with the photos |
| Hardening | Login attempts limited (5 wrong in 15 minutes by default), general rate limit, small body limits on login routes, security headers including a Content-Security-Policy that allows the current map tiles, CORS only for `CORS_ORIGINS` |
| Version check on `PUT /api/v1/<collection>/<id>` | Built: `If-Match: <version>` gives the same 409 as `/changes` |
| Random IDs on engineer screens | New records get IDs such as `POLE-7K2M9XPQ4A`; the shown name stays "POLE-07". Existing records keep their IDs |
| npm audit | 14 → 10. The critical and high advisories went with jsPDF 2.5 → 4.2.1 (the agent-tracking PDF calls were checked). The 10 left are moderate and in ESLint tooling only; production has 0. See `AUDIT_REPORT.md` |
| Speed | Pins are grouped (supercluster 9.1.0) and only the visible area is drawn. With 50,043 points on a test server in desktop Chrome on a laptop: map with pins in 1.5 s (1500 px) and 1.3 s (360 px), 776 and 200 pin elements drawn, pans 0.2–0.8 s. Not measured on a low-cost phone |
| Reports | Inventory, fiber use, splitter and port capacity, customers by status, faults and repair times (TEST left out unless ticked), work orders, data quality from the map-check rules; saved as CSV or printed. Live monitoring reports say "No live connection" |
| https | Reverse proxy (recommended) or `HTTPS_CERT_FILE`/`HTTPS_KEY_FILE`; cookies are secure under https (`COOKIE_SECURE=auto`). See `DEPLOYMENT_GUIDE.md`. Map tile provider unchanged (decision 4 still open) |

Checked by unit tests and by browser scripts in desktop Chrome at 1500 and 360 px on test servers, including a login walkthrough (first administrator, technician refused a delete, viewer read-only, wrong-password limit, broken restore refused, reports, the login screen). **Not done in Phase 9:** no single sign-on or two-step login; no per-field permissions; nobody has used the login on a real phone; the speed numbers are from a laptop; the 10 moderate ESLint advisories need an ESLint major upgrade; the map tile licence (decision 4) is still open.

## Data and API changes

- **Keep the JSON record table and `/api/v1` conventions.** Add collections rather than replacing them: `poles` details on equipment, `spans`, `ducts`, `permissions`, `readings`, `inspections`, `settings`
- **Add server-side link checks,** which are missing today. The same domain rules should run on client and server. Done in Phase 3 for spans, attachments, ducts, slack loops and permissions, in Phase 4 for fiber links (cores, splices, splitter ports, ODF ports and patches, PON ports, assignments), in Phase 5 for ONTs, services, buildings and the customer's ONT, building and unit, and in Phase 8 for alarms, faults and work orders; cable ends and the customer's own path fields are still checked only in the browser
- **Per-record versions (Phase 8).** A `version` column is added at start, without changing the schema number, (the revision of the record's last write). `GET /network` returns `versions`; `POST /changes` accepts `expect` and refuses a stale record with `version_conflict` (HTTP 409) and the current record; results return the new versions. Two collections were added: `alarms` and `syncConflicts` (24 in all)
- **Add** a `readings` collection with origin, unit, source and timestamp, and migrate the existing Rx values to `calculated` or unknown, never `measured`
- **Add** lengths as separate fields, and method and accuracy on points
- **Existing records keep working.** Every change uses a migration and a backup first

## Libraries

Add only when the phase needs it. Check security and maintenance at that time.

| Library | Phase | Why |
|---|---|---|
| i18next with react-i18next | 2 | Telugu and Kannada; none exists |
| A JS or WASM QR scanner | 2 | `BarcodeDetector` is unreliable |
| vite-plugin-pwa or a hand-written service worker | 2 | App must open offline |
| IndexedDB (Dexie) | 2 | Photos overflow localStorage |
| Turf.js | 3 | Not added: a small own distance-to-line helper was enough. KML import uses `@tmcw/togeojson` 7.1.3 and `fflate` 0.8.3 |
| Supercluster | 9 | Marker clustering |
| Playwright | 1 | End-to-end tests; the current browser script is outside the repo |

**Not recommended now:** replacing Leaflet, PostGIS, TanStack Query, React Hook Form, ELK. No current need justifies them.

## Risks and outside dependencies

| Risk | What to do |
|---|---|
| Building on invented data | Phase 1 first |
| Field design assumptions come from old studies on old phones | Test on your own crews; targets are proposals |
| Indian LCO picture may be wrong | Interviews before Phase 6 |
| No TEC or BSNL color table, gazette unread, Indian STB levels dated | Keep editable, with source and date; get a legal and an RF review |
| Telugu and Kannada wording | Native speakers and crews must check it |
| Safety wording | Qualified reviewer |
| Real monitoring needs vendor access | Decision 7 |
| Google tile terms | Decision 4 |
| No login | Keep the server on a trusted network |

## Project skills that support this work

Stored in `.claude/skills/`:

| Skill | Use |
|---|---|
| `fibergis-data-truth` | Any change that creates or shows network data |
| `fibergis-ftth-mapping` | Fiber, GPON and EPON rules and values |
| `fibergis-cable-tv-mapping` | HFC and Cable TV rules and values |
| `fibergis-osp-mapping` | Poles, ducts, GPS, length, India rules, safety |
| `fibergis-easy-field-ux` | Any screen field staff touch |
| `fibergis-field-helper` | Plain-language help using today's app |
| `fibergis-map-check` | Read-only data health check |
