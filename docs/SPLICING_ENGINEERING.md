# Splicing and closure management

This document covers how splices, trays, cassettes, positions and pigtails are recorded in a closure, which rules apply, how a splice entered by mistake is struck out without losing history, the splice picture and the printable splice report. It describes the code as of Phase 8 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 10 November 2026.

Code:
- Schemas: `packages/shared/src/model/schemas.ts` (`spliceRecordSchema`, `fiberTerminationSchema`, `spliceTraySchema`, `jointClosureSchema`)
- Splice commands: `packages/shared/src/domain/fiberCommands.ts` (`recordSplice`, `retireSplice`, `resplice`, `saveClosureDetails`)
- Phase 8 commands: `packages/shared/src/domain/closureSplicing.ts` (`markSpliceEnteredByMistake`, `recordTermination`, `takeTerminationOut`, `setTrayCapacity`)
- Tray helpers: `packages/shared/src/domain/closureTrays.ts` (`trayUsage`, `takenPositions`, `spliceDirectionMismatch`)
- Older commands: `packages/shared/src/domain/splices.ts` (`addSplice`, `removeSplice`, now a soft delete)
- Rules: `packages/shared/src/domain/fiberRules.ts`
- Screen: `apps/web/src/features/splicing/` (`SplicingModal.tsx`, `SpliceDiagram.tsx`, `spliceDiagramLayout.ts`, `spliceReport.ts`, `spliceWords.ts`, `SplicePhotos.tsx`)

## Where the records live

Everything is JSON inside the closure record (`closures` collection). No table or column change.

| Field | On | What it holds |
|---|---|---|
| `trays[].capacity` | closure | Splice positions printed on the tray. Optional: blank means not recorded |
| `splices[].cassette`, `splices[].position` | splice | Cassette (or sub-tray) and position on the tray, as printed. Optional |
| `splices[].lossMeter` | splice | The meter, OTDR or splicer the loss was read on (make, model or serial), as written |
| `splices[].reportRef` | splice | Splice report or job sheet number, as written |
| `splices[].notes`, `splices[].photoIds` | splice | Already in the schema; the form now fills them |
| `splices[].enteredInError` | splice | True when the splice was struck out as entered by mistake. `retiredAt`, `retiredBy` and `retiredReason` say when, who and why |
| `terminations[]` | closure | Fibers ending on a pigtail (a connector) in the closure: cable, fiber, connector type, pigtail label, what it plugs into (text only), tray, cassette, position, technician, date, notes, photos, and the same out-of-service and mistake fields |

Missing values stay missing. The form never fills a cassette, position, connector type, meter or report number. Two existing defaults are kept and said on screen: an empty technician saves the signed-in person ("Left empty: your name is saved") and an empty date saves today ("Left empty: today is saved"). The splice type starts on Fusion, a visible choice the person can change before saving.

## Rules

Errors are refused in the browser and on the server (HTTP 409). Warnings ask "Please check … Save anyway?" in the browser; saving anyway writes `WARNING_ACCEPTED` to the audit trail. The server never blocks on a warning.

| Code | Severity | When |
|---|---|---|
| `tray_position_taken` | Error | Two active splices or pigtails recorded in the same tray, same cassette and same position. One position physically holds one. Two items with no cassette share the tray's own positions; one with a cassette and one without are not compared |
| `tray_over_capacity` | Warning | A tray holds more active splices and pigtails than its recorded capacity. The count is part of the warning key, so every extra splice is warned about again |
| `tray_position_beyond_capacity` | Warning | A position number larger than the tray's recorded capacity |
| `splice_direction` | Warning | The OLT-side fiber is on a cable recorded at this closure as "Out (towards customers)", or the customer-side fiber is on a cable recorded as "In (from the OLT side)". Only the closure's cable entries are used. "Passes through" and unrecorded cables say nothing, and the direction a cable was drawn on the map is never used |
| `termination_missing_cable`, `termination_missing_core` | Error | A pigtail on a cable or fiber that is not on record |
| `termination_twice` | Warning | The same fiber on two active pigtails in one closure (only right if the fiber is cut there and both ends used) |
| `termination_and_splice` | Warning | A fiber both spliced and on a pigtail in the same closure |
| `termination_missing_tray`, `termination_damaged_core`, `termination_cable_not_at_closure` | Warning | As for splices |

Earlier splice rules (`splice_missing_core`, `core_two_sources`, `core_two_continuations`, `splice_color_mismatch`, `splice_high_loss`, `splice_damaged_core` …) are unchanged.

Removing a tray is refused while an active splice or pigtail is on it.

## Entered by mistake

Before Phase 8 the "Entered by mistake" button hard-deleted the splice. Now it is a soft delete:

- `markSpliceEnteredByMistake(data, closureId, spliceId, reason, ctx)` needs a reason. It sets `retiredAt`, `retiredBy`, `retiredReason` and `enteredInError: true`. Audit: `SPLICE_ENTERED_BY_MISTAKE`.
- `removeSplice` in `splices.ts` now calls it (default reason "Entered by mistake").
- A splice already out of service cannot be struck out again; it stays in the history as it is.
- If the struck-out splice had replaced an older one (re-splice), the notice says the older one stays out of service and should be recorded again if it is still joined. Nothing is brought back automatically.

Because the struck-out splice has `retiredAt`, everything that already ignored splices out of service ignores it too: the fiber index (`isSpliceActive`), so core traces, PON trees and the fiber rules; tray counts; the closure screens; and the permission check (striking out counts as a "disconnect"). Phase 8 also made the two older cable-level traces ignore splices out of service or entered by mistake (`opticalPathTrace.ts` `addRecordedSplices`, `trace.ts` `addClosuresOn`); before, they counted them.

History still shows them: the closure's History list (struck-through name, "✕ Entered by mistake, struck out" with date, who and reason), the fiber's splice history (`coreSpliceHistory`, shown in "History of this fiber"), and the splice report.

Pigtails work the same way: `takeTerminationOut(…, { mistake: true })` needs a reason and sets `enteredInError`; without `mistake` it is "taken out" (cut off, spliced instead), reason optional.

## Pigtails (a fiber ending on a connector)

`recordTermination(data, closureId, draft, ctx)`. A pigtail is not a splice. It is not in the fiber index, so a trace does not continue from it and does not end there either; what the connector plugs into is free text (`connectsTo`), never a link. The connector type comes from the editable connector list (Administration, Lists and rules) or is "Not known". It occupies its tray position like a splice and counts towards the tray capacity.

## Tray capacity

`setTrayCapacity(data, closureId, trayId, capacity | undefined, ctx)`: 1 to 144, or cleared to "not recorded". Lowering it below what the tray holds is a warning, not a block. Audit: `TRAY_CAPACITY_SET`.

## Screen

Map, closure pin, Splices (the splice screen). On phones every button, choice and field is at least 48 px tall; it works at 390 px wide.

- **Tray tabs.** All trays, each tray, No tray. The chosen tab has a dot as well as a colour.
- **Splice picture** (`SpliceDiagram.tsx`). SVG. Fibers towards the OLT on the left, towards customers on the right, grouped by cable, one line per splice. A fiber is filled with its colour only when the cable's colour scheme (and its tube layout) is known; otherwise it is a white dashed circle with its number. The state is the line's shape: solid (done), solid with ✓ (tested), dashed (planned), with ✕ (failed or damaged), dotted (not used). A pigtail is a line to a square with a plug, labelled with the connector type or "Connector ?". The key under the picture says this in words.
- **Download splice report (PDF).** See below.
- **Trays and positions.** Each tray: "N used of M", or "positions not recorded", with ⚠ for more than its positions and ✕ for a position recorded twice. "Set positions" edits the capacity.
- **Splices in service.** Each row: both fibers, the line, place (tray, cassette, position), type, state, loss with its unit and origin, meter, OTDR and report references, technician, date, notes and photos. Buttons: Out of service (optional reason), Re-splice, Entered by mistake (reason required; the button says "Strike out: entered by mistake"; "Keep it" cancels).
- **Pigtails in service**, with Take out and Entered by mistake.
- **What to record:** "Joined to another fiber" or "Ends on a pigtail".
- **Splice form.** Tray, cassette, position (it lists the positions already taken and says when the chosen one is taken or the tray is full; it never picks a position), from and to fibers, a direction note when the sides disagree with the closure's records, type, state, "Loss in dB" with a dB unit, loss origin, meter or splicer, OTDR reference, report number, technician, date, notes, and photos (sent to the office first; with no connection the photo is not kept and the screen says so).
- **History.** Splices and pigtails out of service or entered by mistake, with when, who and why.

## Printable splice report

`buildSpliceReport(closure, cables, schemes, generatedAt)` (pure) and `downloadSpliceReport(report, fileName)` (jsPDF, already a dependency; A4 landscape). Contents: closure facts (position as recorded, or "Not recorded" for 0,0; area, installed date and by, seal, condition, cables and their sides, counts), trays (positions, used, notes), splices in service (place, both fibers with colour or "colour not known", type, state, loss with origin, meter, OTDR, report, by and date, notes and photo count), pigtails, and splice history. Every missing value is "Not recorded". The footer gives the time it was made and says positions are as recorded, not a survey.

## Tests

- Shared `packages/shared/test/splicing.test.ts`: tray overflow is a warning (logged, warned again for each extra splice, never refused by the server); retired and struck-out splices not counted; capacity set and cleared; same position refused (browser and server), other cassette allowed, position free again after retiring; position beyond capacity warned; new fields stored and nothing stored when not entered; direction mismatch is a warning, silent where not recorded; entered by mistake keeps who, when and why, leaves the fiber index and tray counts, lets the fiber and position be reused with no error, and still shows in the fiber's splice history; pigtails recorded, take a tray position, warn when also spliced, block tray removal, kept as history when taken out, need a reason for a mistake, missing fiber refused by the server.
- Shared `packages/shared/test/splices.test.ts`: `removeSplice` now keeps the splice, struck out.
- Web `apps/web/src/features/splicing/splicing.test.ts`: picture sides, colour only for a known scheme, state by shape, struck-out splices left out, pigtail connectors, empty tray; report "Not recorded" values and history wording; no default loss.
- Server `apps/server/test/phase8splicing.test.ts`: two splices in one position refused (409), a full tray accepted; a struck-out splice and a pigtail stored and returned with their fields; a pigtail on a fiber that does not exist refused (409).

## Known gaps

- The server does not refuse an upsert that drops a splice from a closure's list (a hard delete straight through the API). The app no longer does it, but deleting a cable still removes its splices from closures (`cables.ts`), which is Phase 5's area.
- Pigtails are not in the fiber index, so traces and fault impact do not show "ends on a pigtail here", and the optical budget does not count the pigtail's splice or connector.
- Direction is only checked against the closure's recorded cable entries. A closure with no entries, or a cable "passing through", gives no direction check.
- Connector types used by pigtails are not counted by `usedListValues`, so the owner can hide or remove a custom connector type that pigtails use (records keep their value).
- The PDF uses the built-in Helvetica font: Telugu or Kannada names, and symbols such as →, print wrongly. The SVG picture is not in the PDF.
- Cassettes are free text on each splice; there is no cassette record with its own capacity.
- No browser walkthrough has been run for these screens; they are checked by unit and server tests only.
