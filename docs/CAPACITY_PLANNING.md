# Capacity planning

This document covers capacity worked out from the records for planning: how full each splitter, PON port, OLT card, ODF, cable, duct, pole and rack is; spare and shortage per zone; customers waiting against free outputs; planned records kept apart from built ones; and expansion scenarios that model planned additions without touching the network. It describes the code as of Phase 18 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 11 November 2026 (Module 23 of the [feature matrix](NETWORK_MAPPING_FEATURE_MATRIX.md)).

It builds on:
- [OLT and PON engineering](OLT_PON_ENGINEERING.md): ONT counts per PON port from records (`ponPortUsage`), the chassis, shelves, slots and cards.
- [Splitter management](SPLITTER_MANAGEMENT.md): output use (`splitterOutputUse`), the walk up to the PON port (`splitterChain`) and the split product.
- [ODF and patch management](ODF_PATCH_MANAGEMENT.md): adapter states, patches, sites, racks and rack units (`rackElevation`).
- [Outside plant engineering](OSP_ENGINEERING.md): duct ways, conditions and fill (`ductPlaces`, `placeFill`), poles, spans and attachments.
- [Fibre core management](FIBRE_CORE_MANAGEMENT.md): fibre use per cable (`coreUtilization`).
- [Field mapping guide](FIELD_MAPPING_GUIDE.md): captures that wait for office review.

Code:
- Worked out from the records: `packages/shared/src/domain/capacityPlanning.ts` (`capacityLines`, `capacityTotals`, `oltCardCapacity`, `cablesOnPoles`, `boxDemand`, `planCounts`, `zonesOfLine`, `pointInZone`, `equipmentPlanState`, `cablePlanState`, `structurePlanState`, `isWaitingCustomer`)
- Warning levels: `packages/shared/src/domain/capacitySettings.ts` (`CAPACITY_SETTING_DEFS`, `resolveCapacitySettings`, `capacitySettingSources`)
- Scenarios: `packages/shared/src/model/planningSchemas.ts` (collection `planningScenarios`), `packages/shared/src/domain/planningScenarios.ts` (`createScenario`, `saveScenario`, `deleteScenario`, `evaluateScenario`, `describeScenarioItem`)
- Reports: `packages/shared/src/domain/capacityReports.ts` (`capacityPlanningReports`), added to `buildReports` in `reports.ts`
- Pole allowance: `attachmentCapacity` and `attachmentCapacitySource` on equipment (`schemas.ts`), edited in Pole details (`apps/web/src/features/inspector/osp/StructureSections.tsx`)
- Screens: `apps/web/src/features/reports/CapacityDashboardModal.tsx`, `ScenarioPanel.tsx`, `ReportsModal.tsx`; store actions in `apps/web/src/stores/planningActions.ts`

## The rule behind every figure

1. **From the records only.** Nothing is counted from position, from a cable passing near a pole, or from a stored counter.
2. **Not recorded is never free.** A splitter output with no port record, an ODF adapter with the state "not known", a duct way counted on the duct but not described, a card port not listed: each is "Not recorded", in its own column.
3. **No capacity, no answer.** An element whose capacity nobody recorded (a PON port with no ONU limit, a pole with no allowance, a rack with no height, an ODF with no panels) is "Not known". Its free room is never assumed.
4. **Planned is kept apart from built.** See the next section.
5. **Warnings only.** "Nearly full", "Full" and "Over capacity" never block anything.

## Built or planned

Every element has a `plan` state, and every figure keeps planned use apart from built use.

| Record | Not built when |
|---|---|
| Equipment (OLT, ODF, box, pole) | Status "Planned"; a field capture "Awaiting office review". A rejected capture is left out of every capacity figure |
| Splitter | It has no status of its own: it follows the box it sits in |
| Cable | Status "Planned", or route status "Proposed", "Planned" or "Under construction" |
| Span, duct | Status "proposed" or "planned" |
| Cable on a pole or span (attachment) | Status "planned" |
| Customer | Status "Pending Installation" (waiting to be connected) |

Two separate things follow from this:
- **A planned element's capacity is planned capacity.** The totals have a "Built" row and a "Planned, proposed or awaiting review" row per kind, and they are never added together. The zone report puts planned elements in "Planned capacity (not built)".
- **Use by planned records is "Held for planned", never "Used".** On a built splitter, an output whose only links are waiting customers, planned cables or a splitter in a planned box is held, not used. The same goes for a PON port's waiting customers, fibres given to a waiting customer, a duct way holding only planned cables, a planned cable on a pole, and units in a rack taken by planned equipment.

## Per element

`capacityLines` gives one line per element: capacity, used (built), held for planned, reserved, faulty, free, not recorded, a state, a plain summary ("2 of 8 outputs free, 1 held for planned work") and notes.

| Element | Capacity | Used | Reserved / faulty | Free | Not recorded |
|---|---|---|---|---|---|
| Splitter outputs | From the ratio | An active customer, a drop fibre or a cascade splitter on it (Phase 11) | As marked on the port | A port record with nothing on it | No port record and nothing linked |
| PON port (ONTs) | The vendor ONU limit, when recorded; else "Not known" | ONT records and active customers on the port (Phase 10), less waiting customers | A port marked faulty or reserved has no room counted as free | Limit minus ONTs on record | — |
| OLT card (PON ports) | The card's port count; if not recorded, the ports listed on it ("may have more") | ONTs or active customers on the port, a feeder, splitter or ODF patch linked to it, or marked Active | As marked | Marked Available with nothing on it | Ports on the card's face not described |
| ODF adapters | Adapters on the panels; no panels: "Not known" | Patched, or marked in use | Reserved; damaged counted as faulty | Available with nothing patched. The note says how many have a fibre behind them, ready to patch | State "not known" |
| Cable fibres | Fibre count | In use or spliced (Phase 7), less fibres given to waiting customers | Reserved; damaged | Available or dark | Unknown, unverified, under maintenance, retired |
| Duct ways | Sub-ducts described, plus ways counted but not described. A duct with no ways recorded is one way | A way with cables (in it or its microducts) | Blocked counted as faulty | Empty and not blocked. Ways never checked are free as recorded, with a note | Ways counted but not described. A duct with several ways and none described: all "not recorded", one taken if cables are recorded in it |
| Pole (cables on it) | `attachmentCapacity`, the number the owner allows, as written from the permission. Not recorded: "Not known" | Cables attached to the pole, or to a span ending at it (built attachment and built cable) | — | Allowed minus cables | — |
| Rack units | Rack height; not recorded: "Not known" | Units filled by built items | — | Units no recorded item fills | Items with no unit written are listed in a note; items with no height count as one unit, "more may be taken" |

Duct fill (how full each way is) comes from recorded diameters only, as in Phase 4. A way above its fill level (Poles and routes settings) makes the duct at least "Nearly full", with the figure in the notes. A way whose fill cannot be worked out is named in the notes.

### States and warning levels

| State | When |
|---|---|
| Over capacity | More taken (used + held + reserved + faulty) than the capacity |
| Full | No position recorded as free |
| Nearly full | The share not free (taken, or not recorded) is at or above the level for that kind |
| Not known | No capacity recorded |
| Room left | Otherwise |

The levels are settings, `capacity.<kind>.nearlyFullPercent`, edited on the Capacity dashboard under "Warning levels and where they come from" (the configure right; others see the values and their sources). Defaults:

| Kind | Default | Source |
|---|---|---|
| Splitter, PON port, OLT card, ODF, cable fibres, pole, rack | 80% | Proposed for Phase 18, not a standard. Building takes weeks, so planners often start the next build at about 80% taken |
| Duct ways | 75% | The same, lower because a way, once used, is hard to win back |

Every report that uses them says which values were used, and whether each is the default or the operator's setting.

## Spare and shortage per zone

Only zones with a drawn boundary (three points or more) count anything. An element is in a zone by its position: a box or OLT by its pin, a pole by its pin, a rack by its site's position. A cable or duct is in a zone only when every recorded point is inside; one that crosses an edge is in no zone and is counted in a note. An item not placed yet (`officeMustPlace`) or a site with no position is in no zone, also counted in a note. Overlapping zones both count the element. Elements in no zone are under "Outside every drawn zone".

Customers waiting are counted by their house position, against the free splitter outputs of the zone: "Spare N" or "Short by N".

## Customers waiting against free outputs

`boxDemand` groups customers with status Pending Installation by the box on their record:
- **Already hold an output:** a splitter on record and an output recorded on the customer.
- **Need an output:** the rest.
- **Free outputs:** recorded free on the splitters in that box (never the not-recorded ones).
- **Result:** enough (with spare), short by N, no splitter recorded, or box not recorded on the customer.

## Expansion scenarios

A scenario is a record in its own collection, `planningScenarios`. It holds planned lines:

| Line | What it says | What "if built" looks at |
|---|---|---|
| More customers | N customers on a splitter (on record, or planned earlier in the scenario), a box (any free output in it) or a PON port | Free outputs, then the ONT count on the PON port above (from the recorded fibres only: if the walk to the port stops, "Not known") against its ONU limit |
| New splitter | Ratio, box, and what feeds it: an output of a splitter (a given output or any free one), a PON port, or not decided | The parent's free outputs (a given output must be free as recorded); a PON port must be free; the split product down to it against the Optical settings limit (a warning) |
| New cable | Fibre count, duct, outside diameter, poles | A free way in the duct (never one an earlier line already took), its fill from recorded diameters; if no way is free, whether it can share one; each pole's cables against the allowed number |

Lines are worked out in order on top of the records as they are. Each result is Fits, Fits with a warning, Short (by how many), Not known (with what is missing), or Names a record not on file. Nothing is stored from the result, and the scenario never changes a network record.

**Kept apart from the network.** No count, trace, report, map layer or check of the built network reads `planningScenarios`. The only report that does is "Expansion scenarios: capacity if built (not on the network)". A test checks that the per-element figures are identical with and without a stored scenario.

**Who may write one.** Planners (Network Planner, `office`), engineers, Network Admin and Super Admin may add and change scenarios; planners may also delete them (their only delete besides documents). Field Technicians, NOC, Supervisors and Read-only accounts may look but not write (`access.ts`). The server applies the same rules on every write. Every write leaves a server audit entry and a browser audit line (asset type "Scenario").

**Checks.** The record is checked by its schema on the server and in the browser: a name, a status (open or closed), at most 200 lines, unique line ids, a whole number of customers from 1 to 1024, exactly one place for customers, a ratio from the list. A line that names a record not on file is not refused: it is reported as "Names a record not on file" and not counted, so deleting a box never has to wait for a plan.

## Reports

Added to Reports (`buildReports`), each with how it is worked out and what is missing, saved as CSV through the shared safe writer behind the export right:

| Id | Title |
|---|---|
| `capacity-use` | Capacity: used, planned and free, per element |
| `olt-chassis-capacity` | OLT chassis: cards, PON ports and empty slots |
| `capacity-zones` | Spare and shortage per zone |
| `capacity-demand` | Customers waiting against free outputs, per box |
| `planned-vs-built` | Records planned against built |
| `planned-vs-built-capacity` | Capacity planned against built |
| `capacity-scenarios` | Expansion scenarios: capacity if built (not on the network) |

The existing `cores`, `capacity` and `splitter-capacity` reports are unchanged. No report names customers: boxes and record ids only.

## The Capacity dashboard

Opened from the left bar, Capacity. At 390 px everything is one column, buttons are at least 44 px high, and the wide tables stay in Reports.
- Four tiles: splitter outputs free, fibres free, customers connected and waiting, items needing attention.
- By kind, built and planned kept apart (planned in a dashed violet card).
- Full or nearly full: the worst first, with mark and words (✕ Over, ■ Full, ! Nearly full), never colour alone.
- Customers waiting against free outputs: the boxes short first.
- Expansion scenarios: start one, add lines, see each line's result, close, reopen or delete.
- Warning levels and where they come from.
- A button to the full tables in Reports.

## Known gaps

- The PON port of a planned line is found only through recorded fibres. Where a box's customers sit under several PON ports, the ONT effect is "Not known".
- Pole load counts cables, not weight, wind load or clearance. The allowed number is what the owner wrote.
- Cable fibres count every fibre of a cable; fibres reserved for a planned splitter are counted only if someone reserved them on the Fibers screen.
- There is no forecast or investment figure: no demand growth or cost is recorded, so none is shown.
- Live ONU counts need a connection to the OLT; these figures are the records.
