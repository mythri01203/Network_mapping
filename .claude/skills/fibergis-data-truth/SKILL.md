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

**Never connect things because they are near each other.** Snapping may help place a line, but it must not silently set a connection. Show the proposed connection and let the person confirm it.

**Report gaps honestly.** An incomplete trace shows the exact missing segment. It never fills the gap or looks complete.

**Grade severity.** Use a blocking error only for physical impossibilities and broken data, such as a splitter recording less loss than physics allows, or two services on one core. Everything else is a warning with a logged override, because a wrong rule must never stop field work.

**Put thresholds in data, not code.** A new limit arrives as an editable setting with its source and date. Most numbers in this domain are conventions, and a number in code outlives the excerpt it came from. Optical numbers live in one place, `packages/shared/src/domain/opticalSettings.ts` (each with a source note), and operators override them in the `settings` collection (Administration, Optical settings). Domain functions take the merged values (`ctx.optical` or a `settings` argument) and fall back to the defaults.

**Track confidence.** Prefer `status` (planned, built, verified) and a basis (OTDR, VFL, power reading, inspected, imported), and show it so people stop trusting unverified data.

## Known violations in this codebase

Fix these when you touch the area, and never copy their pattern. Line numbers may have moved, so re-check them.

Phase 1 (November 2026) fixed the earlier list: the inventing trace, "Measured" estimates, fallback readings, "Live" labels, the three Rx limits, the three loss calculations, ODF-by-distance, silent snapping of cable ends, invented makers, owners, serials, IPs and house positions, swallowed storage errors and the fake photo upload. These remain:

| Location | Problem |
|---|---|
| `packages/shared/src/domain/trace.ts` `findUpstreamChain` | Follows the first cable that ends at a box. Traces now warn when two cables could serve it, but the chain still guesses which one |
| `opticalPathTrace.ts`, `trace.ts` | Cable level only: no core is followed through splices, so a complete trace still does not prove light reaches the house. Connector pairs are counted one per equipment on the path, labelled as estimated, not recorded |
| `packages/shared/src/domain/opticalSettings.ts` `opticsClassForTechnology` | No optics class per PON port, so a GPON port is checked against B+ and the trace says so in its notes |
| `apps/web/src/features/cable-tv/CableTVView.tsx`, `EquipmentInspector.tsx` node, splice and slack sections, `TerminalBoxModal.tsx` maintenance tab | Fixed example values. Labelled "Example values, not your network"; replace with records in the Cable TV phase |
| `apps/web/src/features/splicing/SpliceModal.tsx` | Nearest parent is still preselected, and its customer path always fails (audit defect 9, not in Phase 1) |
| `packages/shared/src/domain/provisioning.ts` `distributionCableId` | With a single cable to the box, the feeder is also stored as the distribution cable |
| `apps/web/src/features/cables/CableWizardModal.tsx` | Route status still starts as "Existing / installed" under More details |
| `apps/web/src/stores/networkStore.ts` | The whole collection is still rewritten to `localStorage` on each change; failures are now reported. Field capture (Phase 2) keeps its photos in IndexedDB and on the server as files, referenced by id, but photos added from the engineer screens still live inside the equipment list |
| Field capture with no GPS fix | Stored at a placeholder point (the previous capture, else the network anchor) with `locationMethod: 'not_placed'` and `officeMustPlace`, never as accurate, and listed under Operations, Field captures. The engineer map still draws it at that point with a normal pin |

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
