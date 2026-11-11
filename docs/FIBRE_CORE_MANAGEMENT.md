# Fibre tube and core management

This document covers how a cable's tubes and fibres are recorded, how a fibre is marked faulty, repaired or retired, how a damaged or faulty fibre can still be used with a recorded reason, how to find a fibre, a fibre's splice history, and the cable picture. It describes the code as of Phase 7 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 10 November 2026.

Code:
- Schemas: `packages/shared/src/model/schemas.ts`, `enums.ts`
- Identity and tubes: `packages/shared/src/fiber/colors.ts`
- Commands: `packages/shared/src/domain/fiberCommands.ts`
- Rules: `packages/shared/src/domain/fiberRules.ts`
- Search, splice history, picture data: `packages/shared/src/domain/coreManagement.ts`
- Screens: `apps/web/src/features/fiber/` (`CoreSection.tsx`, `CoreConditionPanel.tsx`, `CoreFinder.tsx`, `CoreCrossSection.tsx`, `crossSectionLayout.ts`) and the bottom panel's fibre table (`apps/web/src/features/map/BottomInfoPanel.tsx`)

## Where the records live

Tubes and cores are kept inside the cable record, as JSON. This needs no table or column change.

| Field | On | What it holds |
|---|---|---|
| `tubes` | cable | Optional. One entry per buffer tube: `number` (1, 2, 3 ...), `fiberCount`, and `colorName` only if the drum sheet gives it |
| `fibersPerTube`, `tubeCount` | cable | Older way: all tubes the same size. Still used when `tubes` is absent |
| `cores[].status` | cable | The fibre's state. `Faulty` and `Retired` are new. All older values stay valid |
| `cores[].history` | cable | Condition changes: marked faulty, repaired, retired, back in use. Each one has when, who, from and to, the reason, and optional evidence (`otdrRef`, `photoIds`). Never deleted |
| `cores[].assignments[].override` | cable | Set when a damaged or faulty fibre was given anyway: the state it had, the reason, when, and who |

## Tubes

A fibre's identity is its cable-wide number. Tube and position in the tube come from the cable's recorded layout (`tubeSpans` in `colors.ts`):

1. If the cable has `tubes`, they decide. Tubes may hold different numbers of fibres. Fibre numbers run through tube 1 first, then tube 2, and so on. For tubes of 12 and 6, fibre 14 is tube 2, fibre 2.
2. Otherwise `fibersPerTube` is used, as before. Older cables keep working with no change.
3. Otherwise, or if the recorded tubes do not add up, no tube is given. The fibre is shown by number only. The app never guesses 12 per tube.

**Rule (error, browser and server):** `tube_sizes`. The tube numbers must run 1, 2, 3 ... with no gap or repeat, each tube must hold at least one fibre, and the sizes must add up to the cable's fibre count. If `tubeCount` or `fibersPerTube` is also stored, it must agree. Tubes that do not add up are a broken record, so they are refused on the server (HTTP 409).

**Colours.** A fibre colour is shown only when the cable's colour scheme is known. It is looked up by the fibre's position in its tube. A tube colour comes from the tube record when the person wrote it from the drum sheet, otherwise from the tube colour scheme, otherwise it is "not known". There is no default scheme.

**Screen.** Fibers, then "Fiber layout and colours". Choose "All tubes the same size" (the old fibres-per-tube box) or "Tubes of different sizes". The second gives one row per tube: fibres in it and its colour on the drum, if known. It shows whether the rows add up to the cable's fibre count. The rows start from what is recorded, never from a guess. Saving all tubes the same size also keeps `fibersPerTube`, so older screens still read it.

## Fibre states

| State | Meaning | Can be given a service |
|---|---|---|
| Damaged | Older mark, still valid | Only with a reason (override) |
| Faulty | Found bad by a test or a fault. The reason is in the history | Only with a reason (override) |
| Retired | Taken out of use for good | No. Bring it back into use first |

These three states stay on the fibre while it is given, released or given again. Releasing a service does not repair the glass. Only "Mark repaired" or "Bring back into use" clears them. The fibre's shown state (`effectiveCoreStatus`) puts them first, even while a service is still recorded on the fibre, because that is what the next person must know.

### Commands

All need a reason. Evidence is optional: an OTDR test or file name, and photo ids. Each change is added to `cores[].history` and to the audit trail.

| Command | Allowed when | Moves to |
|---|---|---|
| `markCoreFaulty` | Not already faulty, not retired | Faulty. A service on it stays recorded, and the person is told that service may be affected |
| `markCoreRepaired` | Damaged or faulty | In Use or Reserved while a service is on it; otherwise the state before the fault, if recorded; otherwise "Not known". Nobody has said whether it is free |
| `retireCore` | No service on it (release first) | Retired |
| `returnCoreToService` | Retired | The state before retiring, if recorded; otherwise "Not known" |

A fibre that was In Use or Reserved before its fault is not put back to In Use after repair, because that service is no longer recorded on it. It becomes "Not known".

**Screen.** Tap a fibre in Fibers. The buttons offered depend on its state: Mark faulty, Mark repaired, Retire (out of use), Bring back into use. Each opens a short form: the reason (required), the OTDR test or file, and photo numbers. The Save button names the outcome ("Save: fiber is faulty").

## Using a damaged or faulty fibre anyway (override)

`assignCore` refuses a damaged or faulty fibre unless the person gives a reason (`overrideReason`). With a reason:

- The assignment stores `override`: the state, the reason, when, and who.
- The fibre stays marked damaged or faulty, because nobody has said it is repaired.
- The audit trail gets a `CORE_OVERRIDE` entry: "given while marked Faulty, by (person) at (time). Reason: ...". The server stamps the signed-in person on every audit entry.
- No second "Save anyway" question appears. The reason is the acceptance.

A retired fibre is refused with or without a reason.

**On the server** (project rule: only physical impossibilities and broken data are refused):
- A damaged or faulty fibre given a service with no override reason is a **warning**, `core_faulty_assigned`. It is not a block, because the mark may be out of date. The browser's "Please check" shows it before saving, and saving anyway is written to the audit trail. A fibre that went faulty *after* it was given its service is not blamed: the warning compares the time of the last fault with the time the assignment was made.
- A retired fibre that still has an active service is a warning, `core_retired_assigned`.
- An override with an empty reason, or a state that does not exist, is not a valid record and is refused (HTTP 400).
- A splice on a faulty or retired fibre is warned about, like a damaged one (`splice_damaged_core`).

**Screen.** In the fibre's form, a damaged or faulty fibre shows an amber box: "This fiber is marked faulty. Choose another fiber, mark it repaired, or say why it is used anyway." Save stays off until "Why use it anyway" is filled. It then reads "Save: use it anyway". A fibre given this way shows "Given while marked faulty by (person) on (date). Reason: ...".

Other places that give a fibre follow the same marks:
- Customer connections (`giveCustomerFiber`) refuse a damaged, faulty or retired drop fibre.
- Disconnects and moves keep the mark when they release a fibre.
- Customer setup marking the serving fibres (`markServingCores`) keeps the mark, so the warning above shows.
- Traces name a faulty or retired fibre on the path.

## Find a fibre

`searchCores(cables, query, { cableId?, schemes?, limit? })` in `coreManagement.ts`. Every word of the query must match. Words it understands:

| Type | Matches |
|---|---|
| `13`, `F13`, `fiber 13`, `core 13` | Fibre number 13. A bare number also matches a cable name or a use containing it |
| `T2`, `tube 2` | Any fibre in tube 2. Cables with no tube layout never match |
| `T2/3` | Tube 2, fibre 3 in that tube |
| Any other word | Cable name or id, the state ("faulty", "reserved"), a colour (only on cables whose scheme is known), or what the fibre is or was used for: use, from, to, customer, notes, override reason. Released uses are found too and marked "(released)" |

The list shows up to 30 fibres and says how many match in all.

**Screen.** Fibers, then "Find a fiber". Search "This cable" or "All cables". Tapping a fibre on another cable opens that cable with the fibre selected.

## Splice history of a fibre

`coreSpliceHistory(closures, cableId, coreNumber)` lists every splice on that fibre from the closures' splice records: as the OLT side or as the customer side, in service or retired. The oldest come first. Nothing is stored for it; it is worked out each time.

**Screen.** The fibre's "History of this fiber" shows three lists:
- **Condition:** faulty, repaired, retired and back in use, with the reason and evidence.
- **Uses:** released uses, and any use given with an override.
- **Splices:** closure, the other fibre, direction, loss with its origin (measured, estimated, design value, or "origin not recorded"), OTDR reference, and in service or out of service since a date with the reason.

## Cable picture (cross-section)

`coreCrossSection(cable, schemes)` (shared) gives the tubes and fibres. `layoutCrossSection` (web) places them in a 300 × 300 drawing. `CoreCrossSection.tsx` draws it as SVG.

- **Tubes** are rings. A tube's ring is drawn in its colour only when that colour is known. Otherwise the ring is grey and dashed. The tube number is written inside when there is room.
- **Fibres** are filled with their colour only when the cable's scheme is known. Otherwise they are white with a dashed edge and their number.
- **State is a separate mark** on each fibre, never colour alone: a dot for in use or spliced, a dashed ring for reserved, a cross for damaged or faulty, a slash for retired. A key under the picture explains the marks.
- With no tube layout recorded, all fibres are drawn in one group, by number, and the picture says "Tubes not recorded".
- Tapping a fibre in the picture selects it, like tapping its button. The fibre buttons stay the main way to choose. They are at least 48 px on phones and carry text marks (● in use, ◐ reserved, ✕ damaged, ! faulty, — retired).

**Screen.** Fibers, then "Show cable picture".

## Bottom panel fibre table

The older fibre table under the map now lists every fibre of the cable. Fibres with no record yet show as Available. Each shows its state with the new labels. The filter has Faulty and Retired. A missing tube says "Not recorded". The counts use the shown state.

## Tests

- Shared (`packages/shared/test/coreManagement.test.ts`):
  - Tubes of different sizes: numbering, colours, refused sizes, the server rule.
  - Faulty, damaged and retired fibres: refused without an override, the override stored with who, why and when, and history kept after release.
  - Repaired and back-in-use states.
  - The non-blocking warning.
  - Search, splice history and the picture data.
- Web (`apps/web/src/features/fiber/crossSection.test.tsx`):
  - Every fibre stays inside its tube and every tube inside the cable, for 12 to 288 fibres.
  - A mark for each state.
  - No colour drawn for an unknown scheme.
- Server (`apps/server/test/fiberCores.test.ts`):
  - Tubes stored, and sizes that do not add up refused (409).
  - A faulty fibre given with no override is accepted, as a warning.
  - An override is kept.
  - An override with no reason is refused (400).

## Known gaps

- Photo evidence is typed as photo ids. There is no photo picker in this form yet.
- A fibre cut part-way inside an express closure is still not modelled.
- Tube records do not carry a tube's own status (a damaged tube). Mark its fibres instead.
- Fault impact (Phase 20, `impactDownstream`) lists fibres below a failed item that are already marked Faulty, Retired or Damaged apart, and does not count them as newly lost. Which customers are affected is still worked out from the recorded paths, whatever the fibre's state.
- The map check script under `.claude/skills/fibergis-map-check` does not list the new warnings yet. The server logs nothing for a warning. A fibre given straight through the API with no override is only found by `findFiberProblems`, which no report screen lists yet. Tube sizes that do not add up are an error, so a restore check lists them.
- No browser walkthrough has been run for these screens. They are checked by unit tests only.
