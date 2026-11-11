# Physical connectivity

**Network mapping Phase 13, 11 November 2026.** One read-only list of every physical link FiberGIS knows about, and a record of who checked each link, how, when and with what evidence.

## What it is, and what it is not

Before this phase, links were fields spread over about eight record types (audit section 5): splices on closures, feeder fibres and patch cords on ODF ports, splitter inputs and outputs, customer and ONT fields, cable ends, logical ports, the older `connectedTo*` fields on fibres, and Cable TV links. Each kind had its own commands and rules, so a link could not show "checked" or "not checked" in one way.

The plan chose **not** to replace those fields. Instead the **connection index** (`packages/shared/src/domain/connectionIndex.ts`) reads them and lists every link in one shape. Nothing is stored by the index, no existing field or command changed, and everything that works today keeps working.

- A link appears only because a record says so. Nothing is worked out from position, from which cables end at a box, or from a trace.
- Each link says **where it is recorded** (collection, record, field, plain words), so a person can open the record that holds it.
- Who and when appear only when the record has them. Otherwise the screen says "Who and when: not recorded".
- **Unverified is a state of its own.** Every link shows a check state, and "Not checked" is always shown, never hidden.

## Link kinds

| Kind | From (OLT side) | To | Recorded in | Who / when from |
|---|---|---|---|---|
| `splice` | input fibre | output fibre | `closures[].splices[]` | `technician`, `date` |
| `closure_pigtail` | fibre | connector, with what it plugs into as text only | `closures[].terminations[]` | `technician`, `date` |
| `odf_rear` | ODF port (back) | feeder fibre | `equipment.odfPanels[].ports[].feederCore` | not recorded |
| `odf_patch` | OLT PON port | ODF port (front) | `...ports[].patch` | `patchedBy`, `patchedAt` |
| `pon_feeder` | OLT PON port | feeder fibre (no ODF) | `equipment.ponPorts[].feederCore` | not recorded |
| `pon_splitter` | OLT PON port | splitter, as written on the port | `ponPorts[].connectedSplitterId` | not recorded |
| `splitter_input` | fibre | splitter input | `splitters.inputPort` | `linkedBy`, `linkedAt` |
| `splitter_cascade` | output of another splitter | splitter input | `splitters.inputPort.connectedSplitterId` | `linkedBy`, `linkedAt` |
| `splitter_output` | splitter output | drop or lead fibre | `splitters.outputPorts[]` | `connectedAt` only |
| `splitter_customer` | splitter output | customer, as written on the splitter | `outputPorts[].connectedCustomerId` | `connectedAt` only |
| `splitter_equipment` | splitter output | box, as written on the splitter | `outputPorts[].connectedEquipmentId` | `connectedAt` only |
| `customer_drop` | drop fibre | customer | `customers.dropCableId`, `fiberCore` | not recorded |
| `customer_splitter` | splitter output | customer, as written on the customer | `customers.splitterId`, `splitterOutputPort` | not recorded |
| `customer_ont` | ONT | customer | `customers.ontId` | not recorded |
| `ont_drop`, `ont_splitter`, `ont_pon` | drop fibre, splitter output, OLT port | ONT | `onts` | not recorded |
| `cable_end` | cable From or To end | item (and the port name as written) | `cables.startEquipmentId`, `endEquipmentId` | not recorded |
| `logical_port` | a port stored on an item | item, splitter, fibre (or whole cable) or customer | `equipment.logicalPorts[]` (stored ports only, never ports made up from a count) | `assignedDate` only |
| `core_equipment` | fibre | item, as written on the fibre | `cables.cores[].connectedToEquipmentId` | not recorded |
| `core_splice_target` | fibre | another fibre, as written on the fibre (not a splice record) | `cables.cores[].spliceTargetCableId` | not recorded |
| `rf_link` | Cable TV OUT port | Cable TV IN port (and the fibre it runs in, when recorded) | `rfLinks` | `createdBy`, `createdAt` |

"As written" kinds are older or duplicate fields. They are listed so nothing is hidden, but the screen names them for what they are.

**States.** `current` (on record), `planned` (a splice recorded as Pending, a customer pending installation, a planned cable), `retired` (taken out, disconnected or removed: kept as history), `mistake` (a splice or pigtail struck out as entered by mistake). Retired and mistaken links stay in the index and show under "History".

**Ids.** Each link has a stable id made from the record and the field, such as `splice:CLO-1:SPC-2`, `odf-patch:ODF-1:P1:P1-3` or `customer-drop:CUST-7`. The same records always give the same ids. `connectionKindOfId` reads the kind back from an id.

**Lookups.** `connectionsForElement(index, id)` lists every link under a record: both ends, the box a splitter sits in, the closure and its map pin for a splice, the pin a Cable TV item sits at, and the cable a Cable TV fibre link runs in. `connectionsForCore(index, cableId, core)` lists the links of one fibre. Current links come first.

**Speed.** `buildConnectionIndex` makes one pass over the records (linear in their size) and builds maps by id, by element and by fibre. The screens share one build per change of the records it reads (`apps/web/src/features/connections/connectionsUi.ts`).

## Checks of links (`linkVerifications`)

A check names one link by its connection id and records:

| Field | Meaning |
|---|---|
| `method` | `otdr` (OTDR test), `vfl` (red light), `power_reading` (light meter), `visual` (looked at it), `continuity` |
| `result` | `pass` (the link works), `fail` (it does not), `inconclusive` (could not tell) |
| `checkedOn`, `technician` | The day and who did it, as the person gave them |
| `photoIds`, `otdrRef`, `readingDbm`, `wavelengthNm`, `instrument`, `notes` | Evidence. A reading is always measured in the field: a calculated value is never a check |
| `connectionLabel`, `endsKey` | What the link joined when it was checked, so the check still says what it was about if the link later changes or goes. Customers are named by id only here, because the label is stored and read by every role |
| `createdAt`, `createdBy` | When the record was saved, and by whom |

**Check state of a link** (`linkCheckSummary`): `not_checked`, `passed`, `failed`, `inconclusive`, or `changed_since_check` when the newest check was made on other ends (the link was edited after it was checked). A check made before a change never counts as a check of the link as it is now.

**A check of a link that is gone** is kept. It is listed under "Checks of links no longer on record" on the item or fibre its own id or ends name (`orphanChecksFor`), with the words saved at the time. It is never an error and never blocks other work: a phone may have recorded it offline before the office changed the link.

**Errors** (refused in the browser, on the server and in a restore): an id that names no kind of link, no day or a day in the future (one day of grace for phones in another time zone; restores do not judge the day), nobody named, no method, a light meter check with no reading, a photo id that is not a saved photo, more than 20 photos.

**Warnings** (the person may "Save anyway", and that is written to the audit trail as `WARNING_ACCEPTED`): no photo, OTDR reference or reading at all; an OTDR test with no file name and no photo; a link that is no longer on record.

**Who may record one.** Like inspections, a check is field evidence: a Field Technician may add one, and change or delete only their own (`access.ts`). Engineers, administrators and the office may add and change them; Read-only, NOC and Supervisor accounts cannot. `linkVerifications` is deliberately not one of the network collections in `permissions.ts`: recording a check connects nothing, so it needs only `create` or `edit`, never `connect`.

**Server.** `apps/server/src/lib/linkGuard.ts` runs `checkChangeSetLinkVerifications` on every write. It reads nothing stored (`LINK_VERIFICATION_READS` in `targetedReads.ts` is empty on purpose). The restore check has its own rule, "Checks of links".

## Connector and direction checks

Warnings on the link, never refusals. Existing rules are reused:

| Check | Applies to | Rule |
|---|---|---|
| Plug does not fit the adapter, or APC and UPC ends meet | ODF rear (pigtail) and ODF patch (cord at the ODF) | Phase 9 `connectorClash`. Only when both are recorded |
| Splice against the closure's recorded sides | splices | Phase 8 `spliceDirectionMismatch` (cable entries `in`/`out`; drawing direction is never used) |
| Cable TV link not from an OUT port to an IN port, or light into an RF port | Cable TV links | the Phase 6 port direction and signal. No PON rule is applied to Cable TV |
| Two links feed one fibre, or two go on from it | splices, ODF rear, OLT feeder, splitter outputs and inputs, customer drops | the same records the fibre index uses |
| Loop | a splitter fed by itself, or one fibre as both input and output of a splitter, a Cable TV item linked to itself | |
| End not on record | every kind | a cable, fibre number, item, port, splitter output, customer, ONT or Cable TV port that is not on record |

Connectors recorded on a link are shown as recorded; any not recorded say "not recorded". A PON port has no connector field, so the cord end at the OLT is shown but not compared.

## API

`GET /api/v1/connections?element=<id>` or `?cable=<id>&core=<n>` (see [API_DOCUMENTATION.md](API_DOCUMENTATION.md)). Read-only, for this organisation only (Phase 23b), built after the same personal-data hiding as `GET /network` (Phase 12 `redactForViewer`), so a role that may not see a customer's name gets "Hidden for your role" in the words. Checks are written through `POST /changes` as `linkVerifications` records.

## Screens

- **Item inspector, Connectivity tab:** a "Connections" section. It gives a count ("4 links on record: 1 checked good, 0 checked bad, 3 not checked"), then each link with its kind, both ends, where it is recorded, who and when (or not recorded), the place, connectors, warnings, its check state (mark and words, never colour alone) and a big "Record a check" button. History and checks of gone links are listed apart.
- **Cable, Fibers, one fibre opened:** the same list for that fibre.
- **Record a check:** one screen. How (5 big tiles), what was found (3 big tiles with ✓ ✕ ?), the meter reading as digits with a minus or plus chosen by the person (nothing preselected), the wavelength (tap one or leave it not recorded), day and name (today and the logged-in person, shown and changeable), OTDR file, meter used, notes and photos. Targets are at least 48 px; it works at 390 px wide.

## Files

| Part | Files |
|---|---|
| Index, checks of links, rules | `packages/shared/src/domain/connectionIndex.ts`, `packages/shared/src/domain/linkVerifications.ts` |
| Record type | `packages/shared/src/model/linkVerificationSchemas.ts` (collection `linkVerifications`) |
| Server | `apps/server/src/routes/connections.ts`, `apps/server/src/lib/linkGuard.ts`, `apps/server/src/lib/targetedReads.ts` |
| Screens | `apps/web/src/features/connections/ConnectionsPanel.tsx`, `connectionsUi.ts`, `apps/web/src/stores/linkCheckActions.ts` |
| Tests | `packages/shared/test/connectionIndex.test.ts`, `apps/server/test/phase13connections.test.ts`, `apps/web/src/features/connections/connections.test.tsx` |

## Known gaps

- Many kinds of link have no who or when on their record (ODF feeder fibres, OLT feeders, customer and ONT fields, cable ends). They say "not recorded". The server's audit trail (Phase 23a, the item's History tab) shows who last changed the record, but it is not copied into the link, because a change to a record is not proof of who made the link.
- The index does not compare the duplicate records of one link (the customer's splitter output against the splitter's, the ONT's fibre against the customer's). That is Phase 12's customer path check (`connectionRules.ts`); both copies are listed here so a disagreement is visible.
- Cable entries at closures (`cableEntries`) are not links and are not listed; they are used only for the splice direction check.
- The customer inspector and closure inspector have no Connections section yet; their links show on the box, cable and fibre screens.
- The trace engines (`trace.ts`, `fiberPath.ts`) do not use the index. Phase 15 built the single trace engine on it (`networkTrace.ts`, see [NETWORK_TRACE_GUIDE.md](NETWORK_TRACE_GUIDE.md)); the older engines stay for the loss budget and the cable-level route.
- The panel's words are English only, like the other engineer screens.
