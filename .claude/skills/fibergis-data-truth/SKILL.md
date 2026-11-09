---
name: fibergis-data-truth
description: Rules that stop FiberGIS showing wrong or invented network data as fact. Use whenever you add or change anything in FiberGIS that creates, links, traces, calculates or displays network records, including cables, connections, splices, splitters, customers, ONT or optical readings, lengths, statuses, defaults, status badges, schemas or validators, even if the task sounds like a small UI change or a new form field.
---

# FiberGIS data truth

A line on the map is a claim, not a fact. Staff and customers act on what the screen says: a crew digs at a place, a fault gets blamed on a cable. A confident wrong answer costs more than an honest gap.

The goal here is that every value on screen can answer: where did this come from, and how sure are we?

## The five things to keep apart

| Keep separate | Why | In code |
|---|---|---|
| Structure, cable, connection | A cable between two points does not prove a path | Connections are explicit records, never worked out from position |
| Role, construction | Feeder and drop are roles. ADSS and armoured are builds | Separate fields. Never guess role from core count |
| Core number, color | Color schemes vary | Identity is tube and fiber number. Color comes from the cable's scheme |
| Drawn, sheath, optical length | They measure different things and legitimately differ | Separate fields. One never overwrites another |
| Value origin | Taps and splitters report nothing, so their levels are calculated | Every reading stores `designed`, `calculated`, `field_measured` or `device_reported`, with unit, source and date |

## Rules for any change

**Never invent a value.** If data is missing, show "Not recorded" and say what is missing. Do not fall back to a plausible number, the first item in a list, or a sample. Defaults are fine only for a user's real choice, shown before saving, such as a suggested cable type. They are not fine for facts: serial numbers, manufacturers, owners, locations, readings.

**Never show a calculated value as measured.** Label estimates "Estimated". Only a reading from a device or a meter may say "Measured". Only data with a real timestamp from a real integration may say "Live" or "Online". A reading is not proof of being online. With no integration, show "No live connection". Customer readings carry `rxSource` (`designed`, `calculated`, `field_measured`, `device_reported`) and `rxMeasuredAt`; show them through `rxReadingOf` (`packages/shared/src/domain/rxReading.ts`), never by reading `rxOpticalPowerDbm` directly. Records with no `rxSource` have unknown origin and show "Estimated", an old saved 0 dBm with no origin shows "Not recorded", and `isSampleData` records show "Sample data".

**Never connect things because they are near each other.** Snapping may help place a line, but it must not silently set a connection. Show the proposed connection and let the person confirm it. Since Phase 3 this also covers poles: a cable drawn past a pole is not attached to it. Attachments and spans are explicit records (`packages/shared/src/domain/outsidePlant.ts`); "Find poles near this line" only lists candidates, none ticked, and the order of a field walk only makes a `proposed` span. Use `polesSupportingCable` and `cablesOnStructure` to answer those questions, never distance.

**Report gaps honestly.** An incomplete trace shows the exact missing segment. It never fills the gap or looks complete.

**Grade severity.** Use a blocking error only for physical impossibilities and broken data, such as a splitter recording less loss than physics allows, or two services on one core. Everything else is a warning with a logged override, because a wrong rule must never stop field work.

**Lengths stay apart.** A cable's `lengthMeters` is the drawn line; sheath marks and the OTDR length are separate optional fields. Show them through `cableLengths`, which never merges them, and never copy one into another.

**Fiber links are checked on the server too (Phase 4).** `apps/server/src/lib/linkGuard.ts` runs `checkChangeSetFiber` (`packages/shared/src/domain/fiberRules.ts`), the same rules the browser commands use: two feeds or two continuations on one fiber, a fiber the cable does not have, two active assignments on one core, a splitter output beyond its ratio or below the loss physics allows, a second patch on one PON port, optics that do not fit the port technology. Problems already stored are not blamed on a new change. Warnings never block; in the browser they ask "Save anyway" and the acceptance is written to the audit trail. A cable with no colour scheme is "not known": show `coreIdentity`, never a stored colour name, and never assume TIA-598. A splitter input, a splice end, an ODF port and a patch are linked only to what a person chose.

**Customers and connections are history, not overwrites (Phase 5).** An ONT is its own record (`onts`), with the serial exactly as entered and the OLT's address for it as written; never generate either. A disconnect, a move and an ONT swap release what they free and keep the old link with its reason (`connectionHistory`, splitter port `history`, core assignment `releasedAt`, ONT `removed` with `replacedByOntId`); nothing is deleted. Services (`services`) keep a plan only as written; never fill in a plan or price. Use `disconnectCustomer`, `moveCustomer`, `swapOnt`, `attachCustomerToOnt` and `saveService` in `packages/shared/src/domain/connectionCommands.ts`, never edit the customer's link fields by hand. The logical view (`serviceTopology`) and building paths (`buildingUnitPaths`) are built only from recorded links and name each gap. Reconciliation (`reconcileCustomerRx`) compares a real reading only; a calculated value is "not measured", and without the PON port's recorded Tx the expected value is a range. The server runs `checkChangeSetConnections` (`connectionRules.ts`) on every change to these records.

**Faults are suspicions with evidence, and nothing closes without a check (Phase 8).** Alarms (`alarms`) come only from a person (`manual`), the field (`field_report`) or a clearly labelled TEST (`source: 'test'`, `isTest: true`, shown as "TEST · not real" everywhere and left out of reports and outage counts unless asked for). `device_adapter` alarms are made only by the Phase 7 monitoring path (`raiseMonitoringAlarms`) and must name their monitoring source and rows; any other device alarm is refused in the browser and on the server. Group alarms only with `correlateAlarms` (`faultCorrelation.ts`) and say who is affected only with `affectedByElement` (`faultImpact.ts`): both use recorded fiber paths (`traceCustomerCores`) and Phase 3 attachments for poles and spans, never distance. Word every result as "Suspected", give the evidence ("5 of 6 customers recorded on splitter SPL-2 are reported down (1 have no alarm)") and the confidence, lower it and name the gap when a link is missing, and say a customer with no alarm is not proven to be working. Keep customers whose path is incomplete apart as "may be affected, path not fully recorded". Thresholds live in `faultSettings.ts` (`fault.*`). A fault or work order is Verified or Closed only with a `verification`: a light reading `field_measured` with its meter photo, a photo, or an office check with a note (`verificationProblem` in `faultRules.ts`); the server refuses the rest (HTTP 409). Use the commands in `faultCommands.ts`; the phone writes only the work order (`applyJobEvent`), and the office moves and closes the fault.

**Live data comes only from a real source with a real time (Phase 7).** Readings (`onuReadings`) and ONU status history (`onuStatuses`) are stored only by the monitoring routes (file import, the push endpoint with a hashed per-source token, the TEST simulator), always through `planIngest` (`monitoringIngest.ts`), with origin `device_reported`, the source, the device time and the received time. Never write them from a command or an ordinary edit; the server refuses that even in setup mode (`monitoringRules.ts`). Match a row to an ONT only with `matchOnt`: the ONU address or serial exactly as written on one live ONT; anything else is kept as "not matched" with the reason and shown on nobody. Show values only through `showStatus` and `showReading` (`monitoringStatus.ts`): each has its age and source, a value older than `monitoring.statusStaleMinutes` or `monitoring.readingStaleMinutes` says "stale, last known", "Live" appears only for a real (not TEST) source inside the window (`liveSources`), and nothing at all is "No live connection". Count with `summarizeMonitoring`, which counts stale as stale and TEST apart. Use `withDeviceRx` to feed the newest real reading into `rxReadingOf` and `reconcileCustomerRx`; never a TEST one. A status says what the OLT reported, not why: never infer a fiber cut from offline alone.

**Offline edits never silently overwrite (Phase 8).** Each stored record has a version (the revision of its last write). The sync engine sends the version each edit started from (`expect` in the change set); if someone else changed the record, the server refuses it with `version_conflict` and the current record, and the browser keeps its own version, holds it, and saves both in a `syncConflicts` record for a person to choose ("Keep theirs", "Keep mine", "Office decides"). Never resolve a conflict by picking a side in code. Clients that send no versions keep last-write-wins, so older cached data still syncs.

**Links are checked on the server too.** Spans, attachments, duct occupancy, slack loops and permissions that point to a missing record are refused with HTTP 409 by `apps/server/src/lib/linkGuard.ts`, using the same `checkChangeSetLinks` as the browser. When you add a collection that refers to others, add it to `findBrokenLinks` and to the delete cascades (`ospCascadeForEquipment`, `ospCascadeForCable`).

**Put thresholds in data, not code.** A new limit arrives as an editable setting with its source and date. Most numbers in this domain are conventions, and a number in code outlives the excerpt it came from. Optical numbers live in one place, `packages/shared/src/domain/opticalSettings.ts` (each with a source note), and operators override them in the `settings` collection (Administration, Optical settings). Domain functions take the merged values (`ctx.optical` or a `settings` argument) and fall back to the defaults. Pole, route and length limits follow the same pattern in `ospSettings.ts` (`osp.*`, Administration, Poles and routes settings), and field capture limits in `fieldCapture.ts` (`field.*`).

**Track confidence.** Prefer `status` (planned, built, verified) and a basis (OTDR, VFL, power reading, inspected, imported), and show it so people stop trusting unverified data.

## Known violations in this codebase

Fix these when you touch the area, and never copy their pattern. Line numbers may have moved, so re-check them.

Phase 4 fixed: the splice form that preselected the nearest parent and invented ports (now "Connect what feeds this": nothing chosen for the person, only real ports), the splitter input taken from the first cable ending at the box, TIA-598 colours stored on every new cable, and cable-only customer traces. Phase 1 (November 2026) fixed the earlier list: the inventing trace, "Measured" estimates, fallback readings, "Live" labels, the three Rx limits, the three loss calculations, ODF-by-distance, silent snapping of cable ends, invented makers, owners, serials, IPs and house positions, swallowed storage errors and the fake photo upload. These remain:

| Location | Problem |
|---|---|
| `packages/shared/src/domain/trace.ts` `findUpstreamChain` / `walkUpstreamCables` | Fixed November 2026 (audit): when several cables end at a box and none is on record the walk stops and names the gap instead of taking the first. It is only the fallback picture for a path whose fibers are not recorded; provisioning and "Link to OLT" no longer store anything from it, and no Rx is given for it. Keep it that way |
| `opticalPathTrace.ts`, `trace.ts` (equipment and cable targets) | Still cable level: only customer traces follow fibers (`traceCustomerCores`). Connector pairs on the cable-level picture are counted one per equipment; on the fiber path they are counted from its ports. Both are labelled estimated |
| `packages/shared/src/domain/opticalSettings.ts` `opticsClassForTechnology` | Used only when a PON port has no optics class recorded (Phase 4 stores it per port); the trace says which class it assumed |
| `apps/web/src/features/cable-tv/CableTVView.tsx`, `EquipmentInspector.tsx` node, splice and slack sections, `TerminalBoxModal.tsx` maintenance tab | Fixed example values. Labelled "Example values, not your network"; replace with records in the Cable TV phase |
| `packages/shared/src/domain/provisioning.ts` `distributionCableId` | With a single cable to the box, the feeder is also stored as the distribution cable |
| `apps/web/src/features/cables/CableWizardModal.tsx` | Route status still starts as "Existing / installed" under More details |
| Restore from backup | Fiber rules are not applied to a restore, so an older backup still loads even if two splices claim one fiber. The map check reports it |
| Older splice records | Have a loss but no origin: shown as "origin not recorded", never as measured |
| `apps/web/src/stores/networkStore.ts` | The whole collection is still rewritten to `localStorage` on each change; failures are now reported. Field capture (Phase 2) keeps its photos in IndexedDB and on the server as files, referenced by id, but photos added from the engineer screens still live inside the equipment list |
| `apps/web/src/lib/kml.ts` (KML export) | Leaves out spans, ducts and slack loops, so an exported KML shows less than the app knows. Import (Phase 3) keeps everything as written and never infers links |
| `packages/shared/src/domain/kmlImport.ts` | Only tried with sample files made for the test. A real operator's KML may use structures (MultiGeometry, Tracks, nested styles) that are skipped; each skip has a reason, but check them |
| `packages/shared/src/domain/provisioning.ts` `provisionCustomer` | Always makes a new two-fiber drop cable, so a customer cannot be added on an existing drop or on a shared (MDU) ONT with no drop of their own. Phase 5 moves and reconnects can use an existing fiber |
| Older customers (before Phase 5) | Their ONT is only the `ontSerialNumber` on their record, shown as "written on the customer record". "Make ONT record" adopts it on request; nothing is migrated automatically |
| `.claude/skills/fibergis-map-check/scripts/check_network.mjs` | The older customer rules print customer names; the Phase 5 rules use ids. Treat the report as internal |
| Restore from backup (connections) | Connection rules (ONTs, services, buildings) are not applied to a restore, like the fiber rules |
| Field capture with no GPS fix | Stored at a placeholder point (the previous capture, else the network anchor) with `locationMethod: 'not_placed'` and `officeMustPlace`, never as accurate, and listed under Operations, Field captures. The engineer map still draws it at that point with a normal pin |
| `packages/shared/src/domain/operations.ts` `reportFault`, `customersAffectedBy` | Older, cable level (`collectDownstream` follows cable ends). No screen uses them since Phase 8; use `openFault` and `affectedByElement`. `resolveFault` now refuses a fault with no check |
| Correlation with no live monitoring (Phase 8) | "Down" means "has an open alarm" and "no alarm" is not "working": the share behind an element is only as good as what people report. Customer-level groups use LOS, offline and low-light alarms; damage reports and PON or OLT alarms are listed per element. No maintenance windows or suppression yet |
| Faults opened from an element with no position | Placed at the network anchor with `officeMustPlace`, like a danger report with no fix |
| No real OLT connected (Phase 7) | The monitoring framework has only a file import, a push endpoint and a TEST simulator. There is no vendor SNMP, CLI, TR-069 or NMS adapter (decision 7, `docs/MONITORING_ADAPTERS.md`), so every real screen still says "No live connection" until the owner sends data |
| Monitoring history (Phase 7) | Kept in the records like any collection, so the browser's offline copy grows with every row; a frequent feed needs trimming or archiving first. Restore from backup does not run the monitoring rules; the map check reports them |
| Monitoring alarms (Phase 7) | A later "online" does not clear an LOS or offline alarm; the office clears it. Dying gasp raises nothing. The OLT upstream level has no receive band, so it is shown with "No band set" |
| Older "No live connection" labels | Reports, port manager, OLT rack, ONU fleet, topology and the PON port panel still say "No live connection" for their own counts; only Live status, the customer panel and the fault center read the monitoring rows |
| Conflicts (Phase 8) | Checked per record, not per field: two people changing different fields of one work order still get a choice. Version checks are only on `POST /changes` (the app's path); `PUT /<collection>/<id>` still writes last-write-wins |

Full list: `docs/AUDIT_REPORT.md`.

## Before calling a change finished

- Change a record so its data is missing. Does the screen say so, or does it invent something?
- Is a new number on screen labelled with where it came from?
- Could a new link appear without a person choosing it?
- Add a test for the missing-data case, not only the happy path.

## Related skills

- Fiber rules: `fibergis-ftth-mapping`
- Cable TV rules: `fibergis-cable-tv-mapping`
- Poles, ducts, GPS, length: `fibergis-osp-mapping`
- Checking existing data: `fibergis-map-check`

Evidence and sources: `reports/ISP and cable TV mapping rules.md`.
