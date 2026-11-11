# Outside plant engineering (Phase 4)

**Date:** 10 November 2026
**Scope:** spans, ducts, buildings, chambers, moving poles, inspections and the underground trace.
**Related:** [GIS_ARCHITECTURE.md](GIS_ARCHITECTURE.md), the `fibergis-osp-mapping` and `fibergis-data-truth` skills.

Everything here follows the project rules:

- No value is ever invented. Missing means "Not recorded".
- Nothing is linked because it is near something else.
- Only a physical impossibility is an error. Everything else is a warning, and saving anyway is written to the audit trail.
- Limits are settings, each with a source.

## What a person can do now

| Area | What it does | Where |
|---|---|---|
| Span line | Draw the bends of a span (sag or detour) between its two poles, or set it back to a straight line. The two ends are never stored: they always follow the poles, so moving a pole moves the end of the line | Span panel: **Draw the line (bends, sag)**, **Make it a straight line** |
| Span condition | Good, Fair or Poor, as a person set it, with the time. Absent means "Not recorded" | Span panel |
| Duct details | Depth seen, depth in the permit, owner, material, outside size, inside diameter, number laid together, and where each end enters its chamber | Duct form when it is saved; duct panel **Edit depth, owner and sizes** |
| Ways and microducts | Each sub-duct (way) and each microduct inside a way can be marked Clear, Damaged or Blocked, with a note and the time. A blocked duct blocks every way inside it; a blocked way blocks its microducts | Duct panel, under each way, **Mark its condition or add a microduct** |
| Capacity | Ways laid together, described, in use, free, blocked, damaged and not checked; microducts in use and free. From the record only | Duct panel, **Capacity** |
| Fill | Cable area over the inside area of the way, from recorded diameters only. A missing inside diameter or cable diameter gives no number and names what is missing | Duct panel, under each way |
| Cable diameter | The cable's outside diameter (new optional field), entered on the duct panel when fill needs it | Duct panel; shown on the cable's **Ducts** section |
| Building outline | Draw the outline of a building (3 or more corners) on the map, in addition to its point. Remove it again; the point stays | Building section on the Building Entry Point pin |
| Chamber entries and exits | For every duct recorded as starting or ending at a manhole, handhole or chamber: where it comes in, as written ("north wall, hole 2") | Chamber panel, **Ducts, entries and exits** |
| Moving a pole or chamber | After **Move this item** and a drag, anything else at the old place is listed with nothing ticked: cable line points, slack loops recorded there, duct ends recorded there. Only what is ticked moves, in the same undoable step. **Do not move** leaves everything where it was | Map, dialog **Move ...?** |
| Inspections | Record an inspection of a pole, chamber, span or duct: day, who, condition, what was seen, photos. Listed newest first. Technicians may add them from the field | Pole, chamber, span and duct panels, **Record an inspection** |
| Underground trace | From one duct, every duct recorded as ending at the same structure, and on from those. The result is a list with the place each duct was reached through, every gap named, and **Show on map** (the ducts turn amber until **Clear from map**) | Duct panel, **Underground trace** |

## Rules

### Errors (refused, in the browser and on the server)

1. **A new cable in a blocked way.**
   - Covers a blocked duct, sub-duct or microduct, including one blocked because the duct around it is blocked.
   - The message says to mark it clear first if it has been cleared.
   - A cable recorded before the way was found blocked is never blamed on a later change.
   - Code: `ductOccupancyIssues` in `ospDucts.ts`, used by `updateDuct` and by `checkChangeSetLinks` (server, HTTP 409).
2. **An inspection of a record that does not exist.**
   - Deleting a pole, span or duct takes its inspections with it, and the confirmation says so.
   - Deleting it alone through the API is refused.
   - Code: `findBrokenLinks`, `ospCascadeForEquipment`, `deleteSpan`, `deleteDuct`.
3. **A building outline of fewer than 3 corners.**
   - Refused by the schema and by `setBuildingFootprint`.
   - Corners in a line are refused too.
4. **An inspection that cannot be true:**
   - a day in the future (one day of grace for time zones);
   - no person or no condition;
   - a pole inspection of something that is not a pole;
   - a photo id that is not a stored photo.
5. **A pole move whose ticked choice no longer matches the records.**
   - Examples: the point is gone, or the slack loop or duct end is no longer recorded at that structure.
   - The whole move is refused, so nothing moves that the person did not see.

### Warnings (the person may save anyway; it is logged as `WARNING_ACCEPTED`)

- A new cable in a way recorded as damaged.
- A fill above the setting for that number of cables.

### Settings (Administration, Poles and routes settings)

| Setting | Default | Source |
|---|---|---|
| `osp.duct.fillOneCablePercent` | 53% | NFPA 70 (NEC) Chapter 9, Table 1 conduit fill |
| `osp.duct.fillTwoCablesPercent` | 31% | Same |
| `osp.duct.fillManyCablesPercent` | 40% (3 or more cables) | Same |
| `osp.poleMove.vertexMeters` | 2 m | Proposed. A snapped point sits exactly on the pin; 2 m allows for rounding in imported files |

The NEC figures were written for building wiring. They are used here only as a starting point; replace them with the figure from your duct maker or your contract. They warn only and never block.

## Data (no SQL change)

| Record | New optional fields |
|---|---|
| `spans` | `routePoints` (the bends only, up to 200), `condition`, `conditionAt` |
| `ducts` | `innerDiameterMm`, `startEntry`, `endEntry`, `condition`, `conditionNote`, `conditionAt`. Depth and owner existed already and can now be edited |
| `ducts.subducts[]` | `innerDiameterMm`, `microducts[]`, `condition`, `conditionNote`, `conditionAt` |
| `ducts.subducts[].microducts[]` | New: `id`, `label`, `innerDiameterMm`, `cableIds`, `condition`, `conditionNote`, `conditionAt` |
| `buildings` | `footprint` (3 to 500 corners) |
| `cables` | `outerDiameterMm` |
| **`inspections`** (new collection, in the `records` table) | `targetType` (pole, chamber, span, duct), `targetId`, `inspectedOn` (YYYY-MM-DD), `inspectedBy`, `condition` (good, fair, poor), `findings`, `photoIds`, `createdAt`, `createdBy` |

**Who may write inspections:**

- Engineers and administrators may do anything with them.
- Office staff may add and change them, but not delete them.
- Technicians may add them, and change or delete only their own.

The server knows who first stored each one. Rules are in `access.ts`.

## Code

| File | What it holds |
|---|---|
| `packages/shared/src/domain/ospDucts.ts` | Places in a duct (`ductPlaces`), conditions passed down, `placeFill`, `fillLimit`, `ductCapacity`, `ductOccupancyIssues`, `withCableIn`, `withoutCable`, `withWayCondition`, `undergroundTrace` |
| `packages/shared/src/domain/ospGeometry.ts` | `setSpanRoute`, `setBuildingFootprint`, `footprintProblem`, `structureMovePreview`, `applyMoveChoices`, `choicesFromOffers` |
| `packages/shared/src/domain/ospInspections.ts` | `createInspection`, `deleteInspection`, `inspectionProblem`, `inspectionsFor`, `latestInspection`, `inspectionTargetOf` |
| `packages/shared/src/domain/outsidePlant.ts` | `spanLine`; microducts counted in `ductCableIds` and `ductsForCable`; the blocked-way rule in `updateDuct` and `checkChangeSetLinks`; inspections in link checks and cascades |
| `packages/shared/src/domain/equipment.ts` | `moveEquipment` takes the ticked `MoveChoices` |
| `apps/web/src/stores/ospActions.ts` | `moveStructureChecked`, `saveDuct` (with "Save anyway"), `setSpanRoute`, `setBuildingFootprint`, `saveInspection`, `deleteInspection` |
| `apps/web/src/stores/ospUiStore.ts` | Drawing in progress, traced ducts, the open pole-move question |
| `apps/web/src/features/inspector/osp/` | `OspInspectors.tsx` (span and duct panels), `StructureSections.tsx` (entries and exits; pole and chamber inspections), `InspectionSection.tsx`, `PoleMoveDialog.tsx`, `OspDrawing.tsx` |
| `apps/web/src/features/map/layers/OspLayer.tsx` | Spans along their drawn line, traced ducts in amber, building outlines |

## Known gaps

- **Not tried by a person.** No browser walkthrough was run in this phase (not allowed for this helper), so Workflow C has not been checked in a browser. Only unit and server tests cover it.
- **Inspection photos need a connection.** They go straight to the office, like closure photos. With no connection the photo is not saved and the screen says so. Inspections are not part of the offline `/capture` flow yet.
- **Inspections never change a condition.** The span's and the way's condition stay what a person set; an inspection is shown beside them.
- **Microduct outside size is not recorded.** So the fill of a way that holds microducts is not worked out; only each microduct's own fill is.
- **Building outlines have no layer switch.** They use a `buildings` layer key that is on by default; the layer panel does not list it yet.
- **The underground trace is read only.** It does not trace a single cable through its ducts, and it is not a fault impact.
- **KML export** still leaves out spans, ducts, outlines and inspections.
- **Moving a structure only offers.** It offers cable points within the setting, its slack loops and its duct ends. Span lines need no offer because their ends follow the poles. A span's drawn bends near the pole are not offered.
- **The map-check script** (`.claude/skills/fibergis-map-check`) does not check inspections, blocked ways or fill yet.
