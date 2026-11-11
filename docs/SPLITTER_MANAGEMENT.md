# Splitter management

This document covers a splitter's place in the PON tree (its level, and whether the tree is centralised or distributed), the split product down to each splitter, the splitter capacity report, and faulty and reserved splitter outputs. It describes the code as of Phase 11 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 11 November 2026. It builds on [OLT and PON engineering](OLT_PON_ENGINEERING.md) (Phase 10: PON counts from records, `tracePonTree`), [ODF and patch management](ODF_PATCH_MANAGEMENT.md) (Phase 9: faulty and reserved ODF ports, which splitter outputs now copy) and [fibre core management](FIBRE_CORE_MANAGEMENT.md).

Code:
- Worked out from the records: `packages/shared/src/domain/splitterManagement.ts` (`splitterFeed`, `splitterChain`, `splittersBelow`, `splitterPlace`, `splitterPlaces`, `ponTreeSplits`, `splitterOutputUse`, `splitterOutputSummary`, `splitterOutputReason`, `SPLITTER_ARCHITECTURE_LABELS`, `SPLITTER_OUTPUT_MARKS`)
- Commands: `packages/shared/src/domain/fiberCommands.ts` (`markSplitterOutput`, `recordSplitterArchitecture`; `connectSplitterOutput` and `linkSplitterInput` changed)
- Rule: `packages/shared/src/domain/fiberRules.ts` (`splitter_output_faulty_connected`), run in the browser and on the server (`apps/server/src/lib/linkGuard.ts`)
- Schema: `packages/shared/src/model/schemas.ts` (`splitterSchema.architecture`, `splitterPortSchema.override`), `enums.ts` (`SPLITTER_ARCHITECTURES`)
- Report: `packages/shared/src/domain/reports.ts` (`splitter-capacity`, and the splitter rows of `capacity`)
- Screens: `apps/web/src/features/fiber/PlantSections.tsx` (splitter card, PON port tree line), `apps/web/src/features/fiber/SplitterParts.tsx` (new), `apps/web/src/features/reports/CapacityDashboardModal.tsx`, `ReportsModal.tsx`; store actions `markSplitterPort`, `saveSplitterArchitecture` in `apps/web/src/stores/fiberActions.ts`

## Where a splitter sits

`splitterChain` walks up from a splitter's input to its PON port, following recorded links only:

| From | To |
|---|---|
| Input linked to another splitter's output in the same box (`inputPort.connectedSplitterId`) | That splitter |
| Input linked to a fiber (`inputPort.connectedCableId` and `connectedCore`) | What feeds that fiber: a splice (followed to its input fiber), a splitter output, an ODF port (and its patch to a PON port), or a PON port straight onto the fiber |

It stops and names the gap, in plain words, when:
- the input is not linked, or names a cable but not which fiber;
- nothing is recorded feeding a fiber;
- a fiber has two feeds recorded (the fiber rules already refuse this);
- an ODF port has no patch to a PON port;
- the links loop.

`splittersBelow` walks down from each output the same way: a splitter cascaded from the output in the same box, or a splitter whose input is on the fiber leaving the output (through splices).

Nothing is ever worked out from where things are on the map, or from which cable ends at which box.

## Level and arrangement: a suggestion

`splitterPlace` gives, for one splitter:

| Item | How |
|---|---|
| Level | 1 + the number of splitters above it, only when the walk reached a PON port. Otherwise "Not known", or "Not known (at least N)" when splitters were found above before the gap |
| Arrangement | **Distributed (cascaded)** when any splitter is recorded above or below it. **Centralised** when the walk reached the PON port and no splitter is recorded above or below. **Not known** when neither is true (the fiber to the PON port is not recorded and nothing is cascaded) |
| How it was worked out | One line per fact: the PON port it is fed from (and the ODF), the splitters from the PON port down, the gap and where the walk stopped, the splitters below it, and how many outputs have nothing recorded on them (a splitter there would not be seen) |

The screen says "Suggested from the records". A centralised answer is only "as far as recorded".

### What a person may record instead

**Record what you know** on the splitter card stores `Splitter.architecture`: centralised or distributed, an optional level (1 to 20), and a reason (required, such as "Seen on site" or "As-built drawing AB-7"), with who and when. It is never filled in by the app.

- A centralised answer with a level above 1 is refused: it cannot be true.
- When the answer differs from the records, the person is asked first ("The records show it as distributed … Your answer is kept beside it, with your reason."). Saving anyway is written to the audit trail.
- The screen shows both: the worked-out suggestion and the recorded answer, in amber with "This differs from the records above; check the links or the site."
- **Remove recorded answer** clears it; the history line stays.

## Split product

The equal-split ratios from the first splitter down to this one, multiplied (`splitterPlace().split`): 1:4 then 1:8 is 1:32. An unequal coupler (90/10) is not multiplied in, the same as the loss trace (`fiberPath.ts`), and the screen says so. When the fiber above is not recorded, it is "at least 1:N".

It is compared with `optical.limits.splitProduct` (Administration, Optical settings, "Warn when the splits on one path multiply above"; default 64, a proposed value). Above the limit is a **warning only**: "Check: the splits multiply to 1:128, above the limit of 64 in Optical settings. Customers here may get too little light." It never blocks.

### On the PON tree

`ponTreeSplits(data, oltId, ponPortId)` takes every splitter whose walk up reaches that port and gives the deepest level, the tree's arrangement (centralised at level 1, distributed at 2 or more), the highest split product and the ratios that make it, and the splitters whose recorded answer differs. It is shown under the PON port in the inspector (Connectivity tab, PON ports): "Splitter levels: 2 (distributed, cascaded). Splits multiply up to 1:32 (1:4 × 1:8); limit 64 in Optical settings." The existing `split_product` warning in the full tree check (`findFiberProblems` with `trees`) is unchanged.

## Output use, from the records

`splitterOutputUse(data, splitter)` looks at each output from 1 to the ratio's count:

| State | When |
|---|---|
| In use | An active customer's record names the output (`splitterId`, `splitterOutputPort`), the port names a customer, a drop or lead fiber is on the port, or a splitter is cascaded from it in the box. A port marked "Occupied" with nothing linked is also in use, and counted apart ("marked in use, but nothing linked is recorded") |
| Faulty | The port is marked faulty, whatever is on it. Faulty outputs that still carry something are counted apart |
| Reserved | The port is marked reserved and nothing is on it |
| Free | A port record with nothing on it |
| Not recorded | No port record and nothing linked. Never counted as free |

For faulty and reserved outputs the reason comes from the port history: "No light (2026-11-10, Ravi)", or "reason not recorded".

Where it shows:
- **Splitter card** (inspector, the box's Splitters and ports): "8 outputs: 3 in use, 4 free, 1 reserved, 0 faulty", and one tile per output with a mark (● in use, ✕ faulty, R reserved, ? not recorded, blank free), so the state is never told by colour alone.
- **Reports, Splitter outputs: used, free, reserved, faulty** (`splitter-capacity`, new): one row per splitter with box, ratio, level, arrangement (worked out, and the recorded answer if any), split to here (with "(above limit)"), outputs, used, and how many used outputs carry customers, drop fibers and cascade splitters, free, reserved, faulty, not recorded. Ids only; no customer names. Notes say how many outputs are not recorded, faulty but in use, or marked in use with nothing linked.
- **Reports, Splitter and PON port capacity** (`capacity`): its splitter rows now use the same counts. Before Phase 11 "free" was the ratio minus the status words, so an output with no record counted as free; now it says "6 (2 not recorded)".
- **Capacity dashboard**: the splitter tile counts from the records, and a new "Splitter outputs (from records)" table lists each splitter's used, free, reserved, faulty and not recorded outputs.

## Faulty and reserved outputs

Open an output on the splitter card.

| Action | Rule |
|---|---|
| **Mark faulty** | Needs "What is wrong?". What is on the output stays recorded (it may have gone bad in service); the message names it so the customers can be checked |
| **Mark repaired** | Needs "What was done?". The output goes back to in use (something is on it) or free |
| **Reserve** | Needs "What is it kept for?". Refused when anything is on the output or it is faulty |
| **End reservation** | Reason optional |

Each mark is a line in the output's history (`MARKED_FAULTY`, `MARKED_REPAIRED`, `MARKED_RESERVED`, `RESERVATION_ENDED`, the same words as ODF ports) and an audit entry (`SPLITTER_OUTPUT_FAULTY`, …). Nothing is deleted. An output with no port record gets one when it is first marked or connected.

### Connecting a faulty or reserved output

| Connection | Faulty output | Reserved output |
|---|---|---|
| Drop or lead fiber (`connectSplitterOutput`) | Refused unless the person says why ("This output is marked faulty. Why connect it anyway?"). The reason, who and when are kept on the port (`override`), in its history and in the audit trail (`SPLITTER_OUTPUT_OVERRIDE`). The output stays marked faulty | Asks first ("… is reserved (Tower link …). Connecting it ends the reservation."), then ends the reservation in the history |
| Cascade splitter in the same box (`linkSplitterInput`) | The same, with the reason on the parent's output | The same |
| Customer (`provisionCustomer`, `moveCustomer`) | Refused outright, as before (those commands belong to the customer work, Phase 12) | Not checked by provisioning; see Known gaps |

Freeing a faulty output keeps it faulty; the faulty-use reason goes with the connection. Deleting a cable that leaves a faulty output keeps the output faulty.

**On the server:** the fiber rule `splitter_output_faulty_connected` (an error) refuses an output marked faulty that has a fiber or cascade splitter connected **after** the fault was marked, with no reason recorded. A connection made before the output was marked faulty is not blamed. Without a `MARKED_FAULTY` history line the order cannot be known, so nothing is refused.

## Also changed

- Re-linking a cascade from one output to another output of the same splitter now frees the old output (it stayed "Occupied").
- Linking a cascade onto an output that a customer's own record names, or that already carries a drop fiber, is refused with the name, instead of only failing the later rule.
- The "Add a splitter" ratio picker uses the Phase 23 `splitterRatios` list, so the owner's names for ratios show there (the ratios themselves are a fixed list).
- Splitter card controls are at least 48 px tall on phones and the card fits a 390 px wide screen.

## Tests

- `packages/shared/test/splitterManagement.test.ts`: centralised level 1 from the links, through the ODF patch (the phase acceptance: worked out from the cascade, a suggestion only, nothing written onto the record); a cascade in one box and along a fiber gives levels 1 and 2, distributed, with split 1:32; no level guessed when the fiber above is not recorded; PON tree levels and split product against a stricter limit; recording a different answer (reason required, the impossible refused, asks when it differs, both kept, removal kept in history); output counts with "not recorded"; marking faulty, reserved and repaired with history; faulty output refused without a reason and kept with one; reserved output asks and ends the reservation; cascade onto a faulty output; the server rule, and a fault after the connection not blamed; the new report, with no customer names, and the capacity table's "not recorded".
- `apps/web/src/features/fiber/splitterSection.test.tsx`: the place block shows "Not known (at least 2)", "Distributed (cascaded)" and "at least 1:32 (1:4 × 1:8)"; marking faulty and connecting with and without a reason through the store; the output detail asks why and shows the reason.
- `apps/server/test/phase11splitters.test.ts`: a fiber written onto a faulty output with no reason is refused (409), and stored with one; a recorded arrangement is kept with its reason.

## Known gaps

- Customer provisioning and moves (`provisioning.ts`, `connectionCommands.ts`) still refuse a faulty output outright, with no override, and provisioning does not check a reserved output. Those files belong to the customer work (Phase 12).
- The older `SplitterPortModal.tsx` (Fiber Splitter & Port Matrix) and `TerminalBoxModal.tsx` port tab still show the stored status words only; the splitter card and reports are the record-based view.
- The walk up follows the first and only feed of each fiber; a fiber with two feeds is a gap (the fiber rules refuse it anyway). Dual-input (2:N) splitters are still only a flag.
- A centralised suggestion is only as good as the records below the splitter: an output with nothing recorded on it could hide a splitter. The "How this was worked out" lines say how many outputs have nothing recorded.
- The level and arrangement are not used by the optical budget; the budget follows each customer's own fiber path as before.
