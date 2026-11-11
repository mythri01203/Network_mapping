# Fibre cable engineering (Phase 5)

**Date:** 10 November 2026
**Scope:** changing a cable's or duct's line, splitting and joining cables, turning a cable round, a new cable on the same route, the step-by-step cable form, how a cable is made, and the "same cable?" check.
**Related:** [GIS_ARCHITECTURE.md](GIS_ARCHITECTURE.md), [FIBRE_CORE_MANAGEMENT.md](FIBRE_CORE_MANAGEMENT.md), [OSP_ENGINEERING.md](OSP_ENGINEERING.md), the `fibergis-ftth-mapping`, `fibergis-osp-mapping`, `fibergis-data-truth` and `fibergis-easy-field-ux` skills.

Everything here follows the project rules:

- No value is ever invented. Missing means "Not recorded".
- Nothing is linked because it is near something else. Snapping only places a point on a pin.
- Only a physical impossibility or broken data is an error. Everything else is a warning, and saving anyway is written to the audit trail.
- Limits are settings, each with a source.
- Each change is one undo step.

## What a person can do now

| Area | What it does | Where |
|---|---|---|
| Change the line | **Move a point** (tap the point, then tap its new place), **Add a point** (tap where it goes; it joins the nearest part of the line), **Remove a point** (tap it), **Make longer** (choose the From or To end, tap the new points, Finish), **Cut off an end** (tap the point where the line should stop, then choose which side goes). Each action is saved at once as one undo step; **Undo last change** is on the same bar | Cable panel, **Change the route**, **Change the line**; duct panel, **Change the route** |
| Split | Tap the point where the cable is cut. Two questions follow: the second part's name, and whether a closure or box is at that point (nothing is chosen; "No box here" is the starting answer). Then a summary says what moves to which part before anything is saved | Cable panel, **Split into two cables** (or **Split here** on the bar) |
| Join | Lists only cables whose end meets an end of this one, each with the reason it cannot be joined, if any | Cable panel, **Join with another cable** |
| Turn round | From becomes To. The line is reversed; the ends, their ports and the sheath marks read at each end swap with them | Cable panel, **Turn round**; duct panel, **Turn round** |
| New cable on the same route | Opens the cable form with a copy of the line and the same fibre count. The ends are not copied: the form proposes what the line touches, and the person confirms | Cable panel, **New cable on the same route** |
| Cable form | Seven steps: kind, fibres and tubes, ends, route, poles or duct, slack, check. Each step can be tapped back to. The whole cable (with its tubes, poles, duct and slack loops) is saved as one change | **Draw cable**, then **Finish**; or **New cable** |
| How it is made | Fibre standard, mode, outer jacket (sheath), outside diameter and how it is installed. Each blank is "Not recorded" | Cable panel, **How it is made**; cable form, step 1 |
| "Same cable?" | A new cable with the same two ends as another, whose line runs along it, asks "Is this the same cable?". "No, it is a different cable" saves and is written to the audit trail | Cable form, on Save; the server too |

No action needs a drag, a long press or a hover. Points are 44 px targets on the map; every button is at least 48 px high on a phone.

## What changes and what never does

### A line edit (move, add, remove, make longer, cut off)

| Changes | Never changes |
|---|---|
| The drawn points | The two ends (`startEquipmentId`, `endEquipmentId`) and their ports |
| The drawn length (`lengthMeters`), worked out again from the line | The sheath marks (`sheathMarkStart`, `sheathMarkEnd`) and the OTDR length (`opticalLengthMeters`) |
| | Fibres, assignments, splices, attachments, ducts, slack loops |

Drawing a connected end away from its equipment asks first: "The To end will no longer be drawn at FAT-1, but the cable stays recorded as connected to it. Nothing is disconnected." Moving an end onto its own equipment does not ask. A route edit is a "move" for the action permissions (Phase 23a).

### Splitting

The first part keeps the id; the second gets a new one. The id is made when the split questions open, so the summary names the id that is saved.

| Record | Goes to |
|---|---|
| Fibres | Both parts, with the same numbers, states and history |
| Uses given to a fibre (assignments) | Both parts: the fibre carries the use through. The second part's copy has its own id and a note "Kept from CBL-X when it was split" |
| Ends | The first part keeps the From end; the second keeps the To end. The new ends are the chosen closure or box, or not connected |
| ODF feeder fibres, PON port links, splitter inputs and outputs, splices and pigtails in a closure, building riser | The part at the place where that record sits: an end of the cable, or a place on its line |
| Customer feeder, distribution and drop fields | The part that leads to the customer: the drop part touching the customer, the distribution part touching their box, the feeder part away from their OLT |
| Live ONT on the drop | With its customer |
| Pole attachment | The part at that pole. A pole at the split point carries both parts |
| Span attachment | The part on that span. A span across the split point carries both |
| Slack loop | The part where it lies |
| Duct | The part inside it. A duct whose ends are on different parts holds both (same way) |
| Permission | Both parts |
| Documents, jobs, faults, alarms | Stay with the first part, which keeps the id. The summary says so |
| Sheath marks | Each stays with the end where it was read; the new ends have none recorded |
| OTDR length | It measured the whole cable, so neither part has it as its length. It is kept in the remarks of both |
| Drawn length | Worked out again for each part |

Where a record sits is read from the record: its equipment at an end of the cable first, otherwise its position projected onto the line (within the "Poles near this line" setting, `osp.attachment.corridorMeters`). A record within the "pole move" setting (`osp.poleMove.vertexMeters`) of the split point is "at the split point".

**Refused, with the reason, and nothing changed:**

1. A closure, ODF or splitter box at the split point that has records of this cable: FiberGIS cannot tell which side each fibre is on.
2. A record that names the cable but whose place is not on the cable's line.
3. A slack loop at the split point (it could belong to either part).
4. A duct whose ends are not on the cable's line.
5. A customer, ONT or older fibre link (`spliceTargetCableId`, `connectedToEquipmentId`) whose part cannot be told.
6. A Cable TV or other record that names the cable and that splitting does not handle yet.
7. The end of the line as the split point, or an id that is taken.

**Warning (Split anyway is logged):** fibres recorded on both sides of the point, such as an ODF port on the first part and a splitter input on the second. Splitting does not invent a joint, so those fibre paths show a gap at the split point until the joint is recorded in the splicing screen.

The result passes the same fibre, connection and link checks the server runs.

### Joining

The cable the person is on keeps its id; the other is removed, and every record that named it names the joined cable. Doubles are folded: two attachments on one pole become one, a duct listing both lists it once, a closure entry in and out becomes "through".

**Refused, with the reason:**

| Reason | Why |
|---|---|
| They do not meet end to end, or meet at both ends | An end of one must be at an end of the other (the same equipment, or within the pole-move setting with no different equipment) |
| Different kind, or fibre counts differ | One record has one type and one count |
| Different tube or colour records | The layout must be the same along the cable |
| Joined by splice records | Joining would lose those splices; they are a real joint |
| A fibre's state differs (In use on one, Available on the other), or it is given to different uses, or goes to different equipment | One fibre has one state and one use |
| They would start and end at the same place | |

The joined cable keeps the details (owner, make, dates) of the cable that keeps its id. The drawn length is worked out again; the sheath marks at the two far ends stay (if both are in the same unit); the marks read at the joint, the OTDR lengths of the parts and any per-part fibre loss go into the remarks, never added together.

### Turning round

The line is reversed; the ends, their ports and the sheath marks swap. Fibres, splices and everything else stay. When the cable starts at an OLT it asks first, because traces read a cable from its From end to its To end.

## How the cable is made (new optional fields)

| Field | Values | Notes |
|---|---|---|
| `fiberStandard` | G.652D, G.657A1, G.657A2, G.657B3, G.655, G.654E, OM1 to OM5, other | ITU-T single-mode recommendations; ISO/IEC 11801 multimode categories |
| `fiberMode` | single-mode, multimode | The form offers "G.657A2 is single-mode. Tap to record it." It is never filled in by itself |
| `sheath` | PE, HDPE, LSZH, PVC, armoured (steel tape, steel wire, glass rods), other | |
| `outerDiameterMm` | 0 to 200 mm | The Phase 4 field, now also on the cable panel and in the form |
| `installationType` | Aerial, Underground, Duct, Direct Buried, Facade | Unchanged field, separate from the cable type (what the cable is for) |

**Refused (browser and server, HTTP 409):** a G.65x fibre recorded as multimode, an OM fibre recorded as single-mode, and a fibre standard or mode on a coaxial cable. These contradict themselves. Code: `cableBuildProblem` (`packages/shared/src/domain/cables.ts`), `checkChangeSetCableBuild` (server, `linkGuard.ts`).

## The cable form

| Step | Asks | Kept from before |
|---|---|---|
| 1. Kind | Cable type, name, id; how it is made; manufacturer and owner (blank: not recorded) | Install method follows only a type that says it (Aerial, Underground) |
| 2. Fibres | Count (a typical count for the kind is shown first), reserved and damaged cores; fibre and tube colours ("Not known" until chosen, never TIA-598 by default); tubes not recorded, all the same size, or different sizes (Phase 7 tube records), and where that came from | Reserved and damaged cores from the top |
| 3. Ends | "Your line touches ... Connect?" (Yes, connect / No, leave blank); start, OLT PON port (or None), end | Proposed ends are never connected without "Yes, connect"; no PON port is preselected |
| 4. Route | The drawn line and its length, or the straight-line warning; **Draw the route on the map** keeps the ends and count and reopens the form after Finish; route status | Phase 0B: a straight line is announced and noted in the remarks. Route status now starts as "Not recorded" (it started as "Existing / installed") |
| 5. Poles / duct | Poles near the line, none ticked; if any is ticked, "Planned" or "Yes, it is on them" (no default); duct and way along the line, "Not in a duct" to start | Attachments are saved as "Pole near the drawn line, confirmed by a person" |
| 6. Slack | Slack loops at the ends or at poles near the line, with a length | |
| 7. Check | Summary, problems, remarks, **Save Cable** | The "not connected" and "straight line" questions; "same cable?" |

A refused part (tubes that do not add up, a blocked way, a slack loop with no length) refuses the whole save and says which part. A duct fill over the setting asks "Save anyway?" like the duct panel.

## "Same cable?"

Another cable with the same two ends (either way round) whose line runs along this one: the share of the shorter line within the corridor of the other. Cables with a blank end or no line are never compared.

| Setting | Default | Source |
|---|---|---|
| `osp.duplicateRoute.corridorMeters` | 10 m | Proposed for Phase 5: two hand-drawn lines along one street rarely sit closer than a few metres; allows for phone GPS and tapping |
| `osp.duplicateRoute.overlapPercent` | 80% | Proposed for Phase 5. Two cables between the same boxes can be real (a spare, a ring), so it only asks |

- **Browser:** the cable form asks "Is this the same cable?" before saving. "No, it is a different cable" saves and writes `POSSIBLE_DUPLICATE_ROUTE_KEPT`; "Go back" saves nothing.
- **Server:** `POST /changes` checks new cables and cables whose ends or line changed. It never refuses; it logs and returns `warnings: [{ rule: 'possible_duplicate_route', cableId, nearId, overlapPercent, overridden }]`, with `overridden` true when the same change carries the person's answer.

## Data (no SQL change)

| Collection | Change |
|---|---|
| `cables` | New optional JSON fields `fiberStandard`, `fiberMode`, `sheath` |
| `settings` | Two new editable settings (above). Nothing is stored until the operator changes them |
| `ChangeResult.warnings` | May now also hold `possible_duplicate_route` |

## Code

| What | Where |
|---|---|
| Line edits (pure) | `packages/shared/src/domain/routeGeometry.ts`: `applyRouteEdit`, `nearestSegmentIndex`, `routeOverlapRatio` |
| Cable and duct line commands, turn round, build, "same cable?", one-step save | `packages/shared/src/domain/cableRouteEdit.ts`: `editCableRoute`, `reverseCable`, `editDuctRoute`, `reverseDuct`, `saveCableBuild`, `findDuplicateRoutes`, `newDuplicateRouteWarnings`, `createCableWithSetup`, `polesNearLine`, `ductsAlongLine` |
| Split and join | `packages/shared/src/domain/cableSplitMerge.ts`: `splitPoint`, `splitCable`, `mergeCables`, `mergeCandidates`, `cablesMeeting` |
| Build check | `packages/shared/src/domain/cables.ts`: `cableBuildProblem`, `modeForStandard` |
| Server | `apps/server/src/lib/placementWarnings.ts` (duplicate route), `apps/server/src/lib/linkGuard.ts` (build check), `apps/server/src/routes/network.ts` (log line) |
| Map route tools | `apps/web/src/features/map/sketch/RouteEditor.tsx`, `routeEditStore.ts` (mounted from `SketchTools.tsx`) |
| Panels and form | `apps/web/src/features/cables/`: `CableRouteTools.tsx`, `SplitCableDialog.tsx`, `CableBuildSection.tsx`, `CableWizardModal.tsx`, `cableRouteActions.ts` |

## Tests

- Shared (`packages/shared/test/cableEngineering.test.ts`): each line edit and its refusals; drawn length worked out again with sheath and OTDR untouched; the end question; turning round swaps ends, ports and marks; duct edits; the split point; split keeps fibres and carries ODF, splitter, customer and pole links to the right part, keeps the use on both, passes the fibre checks; pole at the split point and a duct across it on both; refusals (records at the split point, slack loop there, a record off the line, taken id, an end); split then join gives the original back; join turns the other cable to fit; join refusals (counts, layout, kind, splices, apart, fibre states); "same cable?" either way round, not for another street or a blank end; server warnings, override and settings; build contradictions; build save; the one-step form save and a refused part.
- Web (`apps/web/src/features/cables/cableRouteActions.test.ts`): a line edit is one undo step; "no" to the end question changes nothing; turning round; split after the question and one undo puts it back; "same cable?" asks and never blocks; a new cable with a slack loop is one undo step; the route tool state.
- Server (`apps/server/test/phase5Cables.test.ts`): a duplicate route is saved with a warning; the override is marked; an unchanged save says nothing; a contradictory build is refused (409) and a sound one kept.

## Known gaps

| Gap | Why, or which phase |
|---|---|
| Splitting does not record the joint. Fibre paths through the split point show a gap until the splices are recorded in the closure | Never inventing splices is the rule; recording them is the splicing screen's job (Phase 8) |
| Split and join for ducts | Not in scope; ducts get the line tools and turn round only |
| A line edit that ends on another pin does not offer to connect it. The ends change only in the cable form | The point lands on the pin; nothing is connected |
| "Same cable?" is asked only in the cable form. A line edit that makes two cables match is reported by the server, logged, not asked in the browser | |
| The cable form starts afresh after **Draw the route on the map**; only the kind, ends, ports, count and line colour are kept | |
| Joining keeps the details of the cable that keeps its id; differing make or owner on the other is not compared | Listed in the summary ("details are kept from ...") |
| A technician cannot join a cable whose fibres carry uses the other lacks: that adds an allocation, which their role does not have | Phase 23a permissions, as designed |
| Cable segments (aerial for one stretch, duct for the next) | Built in network mapping Phase 6: see "Cable stretches" below |
| No browser walkthrough was run for this phase | Not allowed in this run; the workflow B walkthrough is still owed |

## Cable stretches (network mapping Phase 6, 11 November 2026)

A physical cable stays **one record**. A stretch (`cableSegments` collection) only describes part of it: how that part is installed, the duct (and way) or the aerial spans it runs in, a length a person measured, and how sure we are. A cable is never split into "fake" cables to show that it is aerial here and in a duct there.

**Fields** (all optional except the cable and the two ends; blank is "Not recorded"): `cableId`; each end is either a structure on the cable's line (`fromStructureId`, `toStructureId`) or a distance along the drawn line from the cable's From end (`fromMeters`, `toMeters`), never both; `installMethod` (the same five values as the cable's); `ductId` and `ductWayId` (a sub-duct or microduct of that duct); `spanIds`; `measuredLengthMeters` with `lengthNote`; `status` (proposed, planned, built, verified); notes and who made or changed it. Stretches have no map position of their own: they lie on their cable's line, so the map-area query and spatial index do not list them.

| Rule | Severity |
|---|---|
| An end beyond the drawn line, a structure farther from the line than the "Poles near this line" setting (`osp.attachment.corridorMeters`), or a cable with no line | Refused |
| Two stretches of one cable overlapping by more than the pole-move setting (`osp.poleMove.vertexMeters`); touching ends are fine | Refused |
| Start and end at the same place | Refused |
| A cable, structure, duct, way or span that is not on record; deleting a duct a stretch names in the same change without changing the stretch | Refused (link check, HTTP 409) |
| A stretch in a duct and on spans at once; "Aerial" in a duct; anything but "Aerial" on spans; "Direct Buried" or "Facade" in a duct | Refused: the record contradicts itself |
| Measured lengths of a cable's stretches adding up to more than the drawn length | Warning: the drawn line is an estimate (slack, sag, bends). "Save anyway" is written to the audit trail |
| A duct (or way) that does not list the cable; a span with no record of the cable on it | Warning: one of the two records may simply not be made yet |

The browser and the server run the same rules (`packages/shared/src/domain/cableSegments.ts`; server: `checkChangeSetSegments` in `linkGuard.ts`, with a narrowed read in `targetedReads.ts`). A stretch already stored is never blamed on a change that does not store it: a route edit that leaves a stretch beyond the new end is saved, and the cable panel shows the stretch as a problem to fix. A restore reports stretch errors under "Cable stretches".

**Deleting:** a cable takes its stretches with it; a structure takes the stretches that end at it and is forgotten by stretches on its spans; a duct or span is forgotten by the stretches that name it (the stretch stays). Each confirmation says so.

**Split and join** (`cableSplitMerge.ts`): splitting gives each stretch to the part it lies on; distances on the second part are counted again from the split point, and an end within the pole-move setting of the point is set exactly on it. A stretch **across** the split point is refused with the reason ("change it to end at the split point, or delete it, first"): its measured length cannot be divided without inventing numbers. Joining counts distances again along the joined line (turning the other cable's stretches round with it when it was turned round to fit); structure ends need no change. Split then join gives the stretches back.

**Traces and fault impact** never read stretches: they are descriptive. Fibre traces, optical paths, "who is affected" and the underground trace give the same answer with or without them.

**Map layers:** without stretches a cable is in the install layer of its own method, as before. When its stretches record methods, the cable is in the layer of each of them and of its own method, so a cable on poles for one stretch and in a duct for the next is listed and counted in both "aerial" and "underground". It stays on the map while either of those layers is on (hiding both, or its role layer, hides it). The line is still drawn whole, once, in the cable's colour; its line transparency still follows the cable's own layers. The stretches themselves are listed in the cable panel, and **Show on map** draws one stretch over the line.

| Where | What |
|---|---|
| Cable panel, **Stretches (how each part runs)** | The list in order along the cable: ends, method, duct and way or spans, length on the drawn line, measured length, how sure, and any problem. How much of the line the stretches cover ("the rest is not recorded"). **Add a stretch**, **Change**, **Delete**, **Show on map** |
| The stretch form | **Tap two points on the map** (a see-through layer takes each tap; a tap off the cable is refused with "Tap on the purple line"; on a phone the panel closes and opens again after the second tap), or choose two poles, chambers or boxes on the line from a list in order along it. Method, runs in (a duct, poles, not recorded), duct (those listing the cable first) and way, spans (those carrying the cable first), measured length and how measured, how sure, notes |
| Duct panel and span panel, **Corridor** | Read only: every cable recorded in this duct or on this span, from the duct's or span's own records and from stretches, each with the record that puts it there, and "please check" when only one of them says so |

**Permissions:** a stretch is a network record (`NETWORK_COLLECTIONS`): naming a duct, way or end structure is a connect or disconnect. Engineers and administrators may add, change and delete; Network Planners may add and change; technicians, NOC operators, supervisors and read-only accounts may not (as for spans' cable records).

**Tests:** shared `packages/shared/test/cableSegments.test.ts` (the mixed aerial and duct cable; traces, cable trace and fault impact unchanged; every refusal; the length warning and its audit; order of ends; server check and restore; delete cascades; split, split across a stretch, split then join, join with a turned cable; corridor lists); web `apps/web/src/features/cables/cableSegments.test.ts` (one undo step, refusal, "Save anyway", delete, the two taps, mixed layers); server `apps/server/test/cableSegments.test.ts` (stored, overlap, off the line, contradiction and malformed refused; missing duct and orphaning delete refused; a stretch on a cable in the same change; a route edit not blamed).

**Known gaps:** a duct change that removes a way a stretch names is not refused (the stretch then shows the way as missing); the KML export and the map-check script do not include stretches; no browser walkthrough has been run.
