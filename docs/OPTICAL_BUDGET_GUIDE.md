# Optical budget guide

**Network mapping Phase 17, 11 November 2026.** What the optical budget measures and what it only estimates, the formula, the settings it uses, where each input comes from, when it gives no pass or fail, and stored budget runs.

## In one paragraph

The budget adds up the light lost along one recorded fibre path, from the OLT's PON port to the customer's ONT, for each direction. **It is always an estimate.** It is worked out from your records and from settings, never read from a device. A meter or device reading is the real check. Every number in the budget says where it came from, so you can see which parts are your network and which parts are assumptions.

## Where to find it

Open **Route Trace** in the left bar and pick a customer. When the customer's fibres are recorded end to end, the **Optical budget** panel sits under "Fiber by fiber". It shows:

1. **The answer**, in one line. One of: "Fits with margin", "Fits, but under the repair margin", "Too little loss (too much light)", "Over budget", or, when no pass or fail can be given, "Estimated with default class", "Splitter loss not known" or "No budget".
2. **Down and up**, each with its loss in dB, the room left, the room left after the repair margin, and the expected receive level (downstream).
3. **"N inputs are not from your records"**: every input that is a setting, a built-in default, the drawn line on the map, or not recorded. Fix these first if you want a better answer.
4. **Every input and where it came from** (folded): each input with its value, a label and a sentence saying exactly where it came from, with the setting id where there is one.
5. **How it was worked out** (folded): the sum for each direction, written out with the numbers used.
6. **Store this budget run**, with an optional note, and the runs already stored for this path.

The panel stacks into one column on a phone (390 px wide).

## What is measured and what is estimated

| Value | Measured or estimated | Where it comes from |
|---|---|---|
| Path loss (dB), each direction | **Estimated** | Added up from the inputs below |
| Expected receive level (dBm) | **Estimated** | OLT launch minus path loss. A single number only when the port's real launch power is recorded; otherwise a range from the class launch settings |
| Receive level at the ONT | **Measured**, only when it is a meter reading taken on site or a reading reported by the device | The customer's reading (`rxReadingOf`). An estimated or designed value is never compared with the budget |
| Splice loss | **Measured** only when the splice record says "measured on site" or "reported by a device" | The splice record. Otherwise it is a design value, a calculated value, an older value whose origin is not written, or the splice setting |
| Lengths | Recorded only when an OTDR length or sheath marks are on the cable record | Otherwise the length of the line drawn on the map |
| Everything else (fibre loss per km, connector loss, class limits, margin) | **Settings** | Administration, Optical settings. A built-in default until you set your own |

The word "Measured" appears only for a real meter or device reading. The budget itself is always labelled "Estimated, not measured".

## The formula

For each direction, at its own wavelength:

```
Path loss (dB)        = length (km) × fibre loss (dB/km)
                      + the loss of each splitter
                      + the loss of each splice
                      + connector pairs × loss per connector pair
Room left (dB)        = the class highest loss − path loss
After margin (dB)     = room left − repair margin
Expected receive (dBm) = OLT launch (dBm) − path loss
```

- **Down** is 1490 nm and **up** is 1310 nm for GPON and EPON. XGS-PON, XG-PON and 10G-EPON use 1577 and 1270 nm, which the settings hold no loss for, so the 1550 and 1310 nm values are used and the budget says so.
- **Too little loss is also a fault.** When the path loss is below the class lowest loss (13 dB for GPON B+), the receiver can overload: "Too little loss (too much light)".
- **The repair margin is kept apart.** "Fits, but under the repair margin" means the light fits the class, but one later repair could push it over.
- **No launch recorded:** the expected receive level is a range, from the class launch low and high settings.

The written-out sum for one direction looks like this:

> Loss at 1490 nm = fibre 4.620 km × 0.25 dB/km (1.16 dB) + splitters 10.4 (10.40 dB) + splices 0.05 (0.05 dB) + 4 connector pairs × 0.3 dB (1.20 dB) = 12.81 dB. Room left = GPON B+ highest 28 dB − 12.81 dB = 15.19 dB; after the 3 dB repair margin 12.19 dB. Lowest allowed loss 13 dB. Expected receive = launch 3 dBm (recorded) − 12.81 dB = −9.8 dBm.

## Where each input comes from

Every input carries one of five labels:

| Label | Meaning |
|---|---|
| **From the record** | A value someone recorded for this network: the optics class on the PON port, the launch power, an OTDR length, sheath marks, a splice loss, a splitter loss, the count of connector pairs from the ports on the path |
| **Drawn line on the map** | A cable length taken from the line drawn on the map, because no OTDR length or sheath marks are recorded. The real fibre is often longer (slack, bends, risers) |
| **Your setting** | An optical setting your team changed. The budget names the setting and shows the source you wrote with it |
| **Default, not your network** | A built-in default nobody has changed, named with its setting id and the source of the default. Also an optics class assumed from the technology, and a splitter loss that was copied from the settings when the splitter was added ("Settings default (proposed). Replace with the datasheet value.") |
| **Not recorded** | Nothing is on record: no launch power, no reading, or a splitter with no loss |

The inputs, one by one:

| Input | From the record when | Otherwise |
|---|---|---|
| Optics class | The PON port records it | **Assumed from the technology** (GPON → GPON B+, EPON → EPON PX20+, XGS-PON and 10G-EPON → XG-PON N1). Then no pass or fail is given |
| Class lowest and highest loss | (always a setting) | `optical.class.<class>.minLossDb` and `.maxLossDb` |
| Vendor budget | The port records one | Not shown. Shown apart from the class, never instead of it |
| OLT launch power | The port records `txPowerDbm` | Not recorded: the expected receive level is a range from `optical.class.<class>.launchMinDbm` and `.launchMaxDbm` |
| Fibre loss per km | (always a setting) | `optical.fiber.1490` (down) and `optical.fiber.1310` (up) |
| Each cable's length | OTDR length, else sheath marks | The drawn line on the map |
| Each splitter's loss | The output's own loss (unequal couplers), else the splitter's insertion loss | **Unknown.** Never guessed. The fibre path stops there, so there is no budget until it is recorded |
| Each splice's loss | The splice record has a loss | `optical.splice.fusion` or `optical.splice.mechanical`, by the splice type |
| Connector pairs | Counted from the ports on the path: the PON port, each ODF port, the box output adapter and the ONT | |
| Loss per connector pair | (always a setting) | `optical.connector.pair` |
| Repair margin | (always a setting) | `optical.margin` |
| Receive level at the ONT | A meter reading taken on site, or a reading reported by the device | Not used |

## When there is no pass or fail

The budget gives **no pass or fail** in three cases. The losses are still shown, labelled estimated.

1. **The optics class is not recorded on the PON port.** The budget assumes a class from the technology and says **"Estimated with default class"**. A class on a label is often wrong ("PX20" parts with PX20+ sensitivity, "B+" optics that claim 29.5 dB), so a guessed class must not decide whether a link works. Record the class on the PON port (OLT screen, PON port) and trace again.
2. **A splitter's loss is not known.** On the fibre path a splitter with no loss on record is a missing link: the panel shows the splitter as **"Unknown"** and says "No budget". On the cable-level estimate (the other half of the Route Trace screen), a splitter ratio no setting knows is listed as "Splitter loss not known" and no pass or fail is given, because the total would be too low.
3. **The fibre path is not recorded end to end.** The panel says "No budget" and names the first missing link.

The map check follows the same rule: a customer on a port with no recorded class gets no "over the optical budget" warning, because that would be a verdict on a guess.

## Stored budget runs

**Store this budget run** keeps what the budget says now, as history. Engineers, network admins, planners and the administrator can store runs. Field technicians, NOC operators, supervisors and look-only accounts cannot.

A run holds:

| Field | What it is |
|---|---|
| `ranAt`, `ranBy` | When it was run, and who ran it |
| `target` | The customer, **by id only**. A run is read by every role, so customer names are replaced by their id everywhere in it |
| `oltId`, `ponPortId` | The PON port the path reaches |
| `opticsClass`, `opticsClassRecorded` | The class used, and whether it was recorded or assumed |
| `inputs` | Every input with its value, label (from the record, drawn line, setting, default, not recorded), source sentence and setting id |
| `directions` | Per direction: each part of the loss, the total, the class range, room left, margin, the result, the expected receive level, a real reading if there was one, and the sum written out |
| `formula`, `method` | The general formula in words, and which code did the sum |
| `note` | What the person wrote, if anything |

Rules, checked in the browser and on the server:

- **A run never changes a network record.** It is stored in its own collection, `opticalBudgetRuns`, in the existing records table (no new SQL table). No trace, count, report or check reads it.
- **A run is never changed or deleted.** It says what the budget said at that moment. To get a newer answer, run the budget again; the new run is stored beside the old one. The server refuses a changed run or a delete with "Nothing was saved", even with login off.
- **A run with an assumed class cannot carry a pass or fail.** The server refuses it.
- **Only a complete fibre path is stored.** An incomplete one has no budget, so there is nothing to keep.

## Settings used

All optical numbers live in one place, `packages/shared/src/domain/opticalSettings.ts`, each with a source note. Change them in **Administration, Optical settings**; write where your value came from (a datasheet, an acceptance test) in the source box, and the budget shows it.

| Setting | Default | Source of the default |
|---|---|---|
| `optical.fiber.1310` | 0.35 dB/km | Proposed. 0.34 cabled maximum (Bharti spec); 0.4 planning (FOA) |
| `optical.fiber.1490` | 0.25 dB/km | Proposed, no direct source. Also try 0.30 before signing off |
| `optical.fiber.1550` | 0.25 dB/km | Proposed. 0.20 cabled maximum (operator); 0.25 (FOA) |
| `optical.splice.fusion` | 0.1 dB | Handbook and FOA. Redo above 0.2 |
| `optical.splice.mechanical` | 0.5 dB | Handbook |
| `optical.connector.pair` | 0.3 dB | FOA. Reject above 0.5 |
| `optical.splitter.1:2` … `1:64` | 3.8, 7.1, 10.4, 13.5, 17.0, 20.5 dB | Proposed. Used only when a splitter is added, and then labelled "Default, not your network" until the datasheet value replaces it |
| `optical.class.GPON B+.*` | 13 to 28 dB, launch 1.5 to 5 dBm | Standard, G.984.2 |
| `optical.class.GPON C+.*` | 17 to 32 dB, launch 3 to 7 dBm | Standard, G.984.2, assumes FEC |
| `optical.class.EPON PX20.*` | up to 24 dB, launch 2 to 7 dBm | Vendor table |
| `optical.class.EPON PX20+.*` | up to 28 dB, launch 2.5 to 7 dBm | Vendor table |
| `optical.class.XG-PON N1.*` | 14 to 29 dB | Search excerpt of G.987.2 |
| `optical.margin` | 3 dB | One vendor recommends 3 to 5 dB. Not a standard |
| `optical.measuredGap` | 3 dB | Proposed. A real reading this far below expected suggests a dirty connector, a bend or the wrong path. Needs the real launch power |

Most of these are conventions, not facts about your network. "Fits" is only as good as them: before signing off a design, also try the conservative values, and get the installed splitter's datasheet.

## Which calculation, and why

The codebase had four places that touch optical loss: `lossEngine.ts`, `fiberPath.ts`, `trace.ts` and `opticalPathTrace.ts`. Only one of them adds up loss:

- **The calculation is `calculateOpticalLossBudget` in `packages/shared/src/domain/lossEngine.ts`.** It is the only code that sums fibre, splitter, splice and connector loss and compares the total with the class. `fiberPath.ts`, `trace.ts`, `opticalPathTrace.ts` and the 3D view all call it.
- **The path it is fed from is `traceCustomerCores` in `packages/shared/src/domain/fiberPath.ts`.** It follows one fibre at a time through recorded splices, splitter ports, ODF ports and patches, and counts the parts of that exact path (lengths with their basis, each splice's loss and origin, each splitter output's loss, the connector pairs from the ports). It already works out both directions with `calculateOpticalLossBudget`.
- **The Phase 17 code (`packages/shared/src/domain/opticalBudget.ts`) adds no calculation.** It takes the fibre path's own per-direction results and labels each input with its origin, writes the sum out, and stores runs.

Why this pair:

1. `lossEngine.ts` was already the one sum every screen used, with its numbers from the one settings file. A fourth calculation would let two screens disagree.
2. `fiberPath.ts` is the only path that follows real fibres. `trace.ts` and `opticalPathTrace.ts` follow cables when the fibres are not recorded, which is only a picture of where the light may come from; they stay as the "Cables only" estimate. The Phase 15 trace engine (`networkTrace.ts`) gives the same fibres as `fiberPath.ts` (a test proves it) but gives no loss, so it was not given a second copy of the sum.

## What changed in Phase 17

| Where | Change |
|---|---|
| `lossEngine.ts` | New input `opticsClassRecorded`. When it is `false`: "Estimated with default class", no pass or fail. A splitter whose loss no record or setting gives now stops the pass or fail ("Splitter loss not known") instead of being left out of the total silently. New result fields `opticsClassRecorded` and `verdictWithheld` |
| `fiberPath.ts` | Passes whether the port records its class. `verdict` is left empty with an assumed class. Each splice and splitter step carries where its loss came from (`partLoss`) |
| `opticalPathTrace.ts` | The cable-level estimate now uses the class recorded on the port (it used the technology's class even when one was recorded), gives no pass or fail with an assumed class, and names the setting when it stands in for a splitter loss nobody recorded |
| `opticalBudget.ts`, `opticalBudgetSchemas.ts` | The labelled inputs, the written-out sum, stored runs and their server rule |
| Route Trace screen | The Optical budget panel |

## Known gaps

- The budget is shown for **customer** paths. A single fibre traced upward stops before a customer, so it gives "loss so far" on the cable-level estimate only.
- Stored runs are listed on the Route Trace screen for the path you are looking at. There is no report of all runs yet.
- Runs are kept in the records like any collection, so the browser's offline copy grows with each run. Undo of "Store this budget run" in the browser tries to remove it, and the server refuses that (runs are never deleted), as with map check findings.
- `ranBy` is the name the browser sends. The server's audit trail records the real account for every write.
- The 3D view's budget (`features/view3d`) still passes its class without saying whether it was assumed; it was not changed in this phase.
- No loss values for 1577 and 1270 nm; the 1550 and 1310 nm settings are used, and the budget says so.
- The upstream budget is not compared with the OLT's per-ONU upstream reading.
