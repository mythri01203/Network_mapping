# OLT and PON engineering

This document covers the OLT record: its shelves, slots and cards, any PON port count, the ONT, customer and service counts per PON port, PON port capacity, and how the OLT setup screen now proposes splitters instead of creating them. It describes the code as of Phase 10 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 11 November 2026. It builds on [ODF and patch management](ODF_PATCH_MANAGEMENT.md) (Phase 9: an OLT chassis sits in a rack), the [equipment catalogue](EQUIPMENT_CATALOGUE.md) and [fibre core management](FIBRE_CORE_MANAGEMENT.md).

Code:
- Schemas: `packages/shared/src/model/schemas.ts` (`oltCardSchema`, `oltSlotSchema`, `oltShelfSchema`, `oltChassisSchema`, `OLT_CARD_KINDS`, equipment `chassis`), types in `types.ts` (`OltCard`, `OltSlot`, `OltShelf`, `OltChassis`)
- Chassis checks, port limits and helpers: `packages/shared/src/domain/oltConfig.ts` (`oltChassisProblems`, `ponPortPlace`, `chassisAsWritten`, `ponPortsOnNoCard`, `MAX_OLT_PON_PORTS`, `MAX_CARD_PON_PORTS`, `validateOltConfig`)
- Save command: `packages/shared/src/domain/oltCommands.ts` (`saveOltChassis`)
- Counts from records: `packages/shared/src/domain/ponUsage.ts` (`ponPortUsage`, `oltPonUsage`, `customersOnPonPort`, `ponCapacityText`, `recountPonCustomers`)
- Rules: `packages/shared/src/domain/fiberRules.ts` runs `oltChassisProblems` for every OLT, so the browser and the server (`apps/server/src/lib/linkGuard.ts`, fiber guard) refuse the same broken chassis data
- Counter writers changed: `connectionCommands.ts` (`disconnectCustomer`, `moveCustomer`), `provisioning.ts` (`provisionCustomer`, `relinkCustomer`)
- Counter readers changed: `reports.ts` (capacity report), `trace.ts` (PON step text)
- Screens: `apps/web/src/features/olt-rack/OltChassisSection.tsx` (new), `OLTRackView.tsx`, `apps/web/src/features/fiber/PlantSections.tsx` (PON port section), `apps/web/src/features/inspector/OltSection.tsx`, `apps/web/src/features/equipment/OltConfigModal.tsx`, store action `saveChassis` in `apps/web/src/stores/fiberActions.ts`

## Where the records live

| Record | Stored as | Holds |
|---|---|---|
| Equipment (OLT) | Existing record, new optional `chassis` | `model` (as printed), `shelves[]`, `notes` |
| Shelf | Inside `chassis.shelves` | `id`, `label` as the OLT names it ("0", "1"), `slots[]` (up to 64) |
| Slot | Inside a shelf | `id`, `label` as the OLT names it ("5", "1/5"), optional `card`. No card: the slot is empty, as recorded |
| Card | Inside a slot | Optional `model` (as printed, such as "GPHF"), `kind` (`pon`, `uplink`, `control`, `power`, `other`), `serialNumber`, `portCount` (1 to 128), `ponPortIds` (the OLT's `ponPorts` ids on this card), `notes` |
| PON port | Inside the OLT's `ponPorts` (as before) | Unchanged. `connectedCustomersCount` stays, as a cache (see below) |

No SQL change: equipment is stored as JSON. Up to 16 shelves per chassis. Old records have no `chassis` and keep working.

### Why the chassis sits on the OLT and the PON ports stay where they are

The PON ports are the records everything else points to: ODF patches (`patch.ponPortId`), customers (`ponPort`), ONTs (`ponPortId`), core assignments, faults, monitoring. Moving them under cards would change every one of those links. So the PON ports stay in `ponPorts`, and a card only names which of them it holds. One port sits on at most one card.

### The older free-text fields

`rackNumber`, `shelfNumber`, `slotNumber` (strings) and `ponCardsCount` (a number) stay exactly as they are and are never changed by the chassis screen. When no chassis is recorded, the chassis section shows them with "(as written)". The inspector's details line is now called "Rack position (as written)". Where the OLT stands in a rack is the Phase 9 site and rack record (`siteId`, `rackId`, `rackUnit`, `rackUnits`); the chassis is what is inside the OLT.

## Rules for the chassis

Checked by `oltChassisProblems`, inside the fiber rules, so the browser asks first and the server refuses the same errors. Problems already stored are not blamed on a later change.

| Check | Level |
|---|---|
| A shelf or slot with no name | Error |
| Two shelves with one name, or two slots with one name in one shelf (case and spaces ignored) | Error |
| A card names a PON port the OLT does not have | Error |
| A PON port listed on two cards, or twice on one card | Error |
| A card lists more PON ports than its recorded port count | Error |
| A card port count outside 1 to 128 | Error (the schema also refuses it) |
| An uplink, control or power card lists PON ports | Error |
| Some PON ports are on no card, once at least one card holds ports | Warning (recording a chassis is often done a card at a time) |

A card with fewer ports listed than its port count is normal while recording and is shown as "3 of 16".

Shrinking the OLT's port count on the setup screen is refused while a port that would go is still on a card, still feeds a cable, or still has customers recorded on it.

## Any PON port count

The setup screen asks "How many PON ports does this OLT have?" with one number field. The 4, 8, 16 and 32 buttons are gone. Any whole number from 1 to `MAX_OLT_PON_PORTS` (1024) is accepted, such as 12. 1024 is far above any single chassis (a 17-slot chassis of 16-port cards is 272), so a larger number is treated as a typing mistake. A card takes 1 to 128 ports.

A new OLT no longer starts at 8 ports. The count is empty ("Not recorded") until a person enters it, and saving asks for it in plain words: "Enter how many PON ports the OLT has (count them on its front), at least 1."

The port list on the setup screen shows each port's recorded status and ONU limit ("limit not recorded" when blank), not "Available" for every port and not "1:128" or "1:64" claims from the technology.

### Make (vendor) is free text

The make is a free text field ("as on the OLT label"). While typing, it offers common names and every make already written on an OLT in this network; nothing is chosen for the person and "Other" is gone. There is no Phase 23 editable list for makes (`EDITABLE_LIST_KEYS` has none), so none is used. The splitter ratio picker on the same screen now uses the Phase 23 `splitterRatios` list, so the owner's names for ratios show there. The made-up loss figures next to each ratio (3.5 dB, 7.2 dB, and so on) are gone; the ratio shows its output count only.

## Counts per PON port, from the records

`ponPortUsage(data, oltId, ponPortId, { trace })` works out, every time it is asked:

| Count | From |
|---|---|
| Customers on record | Active customers (not Disconnected, not Cable TV) whose record names this OLT and port (`oltId`, `ponPort`) |
| ONTs | Live ONT records on the port (`oltId`, `ponPortId`), plus the ONT records those customers use. A customer with no ONT record (only a serial on the customer, Phase 5) counts as one ONT, and the screen says how many were counted that way |
| Services running | Live services of those customers, or on those ONTs |
| Reached by the fibers (with `trace`) | `tracePonTree`: the active customers and splitters the recorded fibers reach from the port |
| Capacity | The vendor ONU limit (`maxOnu`) against the counted ONTs: "12 of 64 ONTs (52 free)", or "12 ONT(s) · ONU limit not recorded" |

Differences are notes in plain words, never errors and never changed automatically:
- a customer names the port but the recorded fibers do not reach them yet;
- the fibers reach a customer whose record names another port or none;
- a customer's ONT record names a different port from the customer;
- more ONTs than the recorded limit (also a warning in the PON tree check, as before).

Online, offline and LOS counts still need a live OLT connection (Phase 7) and are not shown.

Where the counts show:
- **Inspector, Connectivity tab, PON ports section:** choose a port to see customers, ONTs, services, capacity, the card it sits on, and what the fibers reach.
- **Inspector, Details tab:** the OLT summary ("N customers on record") and the Subs column.
- **OLT Rack screen, OLT PON ports:** each port tile, and for the chosen port customers, ONTs, services, capacity, optics class and card.
- **Reports, Splitter and PON port capacity:** PON port "Used" is the counted ONTs; "Free" is limit minus used, or "Not known".
- **Trace:** the PON step says "N customer(s) on record".

## The old `connectedCustomersCount` counter

Before Phase 10 the counter was moved up and down by one (`connectionCommands.ts` on disconnect and move, `provisioning.ts` on connect and relink), so it could drift: a relink to another port never lowered the old port, and imported or sample values were never checked.

**Choice: keep it as a cache, set from the records.** The field stays in the schema (it is required, and older phones and backups send it). It is no longer added to or taken from. After each command that changes which customers are on a port (connect, relink, disconnect, move, reconnect), `recountPonCustomers` sets every port of the OLTs involved to the number of active customers recorded on that port. Screens and reports do not show it as the count; the PON port section mentions it only when it differs ("An older saved count said 16. It is not used; the counts above come from the records.").

Why this is the least risky:
1. **Older readers keep working.** `ports.ts` (logical port remarks) and any older client still read the field, and now get a number that matches the records after every change.
2. **No migration.** Stored values that drifted are corrected the next time a customer on that OLT changes; nothing is rewritten in bulk.
3. **Nothing new to keep in step.** The cache is a pure function of the customer records, so it cannot drift again through these commands.

A plain `updateEquipment` (such as the setup screen) does not recount; `buildOltPonPorts` keeps each existing port's value and starts a new port at 0.

## The setup screen proposes splitters

Before Phase 10, saving the OLT setup screen created a splitter record, as a side effect, for every planned splitter that had a box chosen. Now:

- **Propose a splitter** adds it to the OLT's splitter plan (`oltConfig.splitters`) only. The toast says it is not a record yet.
- Each plan line says **Proposed only** or **Splitter record exists**, and which box it is for ("Not decided" when none).
- **Create splitter record** on a line asks first ("Create the splitter record? … Its input fiber is not linked …"). Only after the person confirms is the record made, through the same `createSplitter` command and fiber checks as anywhere else. The input fiber is never guessed; it is linked on the splitter in the box.
- **Save Configuration** never creates splitters. Its message counts the proposals that are not records yet.
- When the plan is first built from splitters already cabled to the OLT, the PON port is the cable's recorded start port, or "PON port not recorded". It used to be made up from the list order (first splitter on PON-01, second on PON-02). The output count comes from the ratio, not a default of 8.

Other fixes on the same screen, found while doing the above:
- Saving no longer overwrites the OLT's own notes with the generated description. The description is kept in `oltConfig.description` and shown on the Description tab.
- A cable with no recorded start port shows "port not recorded", not "PON-01". The generated description writes "Cable Type: Not recorded" instead of "Single Mode Feeder Fiber", and "Output Ports: Not recorded" instead of 8, when nothing was given; its splitter heading is "Splitter Plan (proposed)".
- "Reset Draft" returns to the recorded port count, not 8.

## Recording a chassis (how to)

1. Select the OLT. Connectivity tab, **Chassis: shelves, slots and cards**, **Record shelves and cards**.
2. **Add a shelf**. Write its name as the OLT shows it (often 0 or 1).
3. **Add a slot to shelf …**. Write the slot number. Choose what is in it: **Empty slot**, a card kind, or **A card (kind not known)**.
4. For a card: write the model as printed and count the ports on its face. Tick the PON ports that sit on it. **Tick the next N free port(s)** fills the next free ports in order; check them before saving.
5. **Save chassis**. A broken entry (a port on two cards) is shown in red and cannot be saved. Ports on no card are shown as a check and asked about once.

All buttons are at least 48 px tall on phones and the section fits a 390 px wide screen.

## Tests

- `packages/shared/test/oltPon.test.ts`: an OLT with 12 PON ports can be recorded (the phase acceptance); impossible port counts refused; card limits; chassis errors and the loose-port warning; `saveOltChassis` refuses errors, asks on the warning, keeps the older fields; the server rules see the same errors; counts and the cached counter match the records after connect, move across PON ports, disconnect and reconnect; a drifted counter is not shown and is corrected by the next change; ONT, service and capacity counts with and without a recorded limit; record and fiber disagreements named; capacity report uses counted ONTs.
- `apps/web/src/features/olt-rack/oltPon.test.tsx`: the chassis section shows "(as written)" fields or the recorded shelves and cards; saving through the store, and refusing a port on two cards; a disconnect through the store sets the cached count from the records.
- Existing tests in `connections.test.ts` and `provisioning.test.ts` that check the counter after connect and disconnect still pass unchanged, because the cache now equals the record count.

## Known gaps

- No card catalogue: card models are free text. Phase 2 catalogue models describe the OLT as a whole, not its cards.
- The chassis is not drawn as a picture; it is a list of shelves and slots.
- Live counts (online ONUs, LOS) need an OLT connection (Phase 7 adapters).
- Vendor port addresses (`vendorAddress`, `addressParts`, Phase 4) are not checked against the card and slot. They are kept as the vendor writes them.
- The setup screen still saves with `updateEquipment`, which runs no browser-side fiber check; the server's fiber guard checks the result. Shrinking the port count is checked on the screen (cards, cables and customers on the ports that would go).
- Cached counters that drifted before Phase 10 are corrected only when a customer on that OLT next changes.
