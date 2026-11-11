# Asset management

This document covers how a deployed item (a pin on the map) is recorded and edited. It describes the code as of Phase 2 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 10 November 2026. The catalogue is described in [EQUIPMENT_CATALOGUE.md](EQUIPMENT_CATALOGUE.md).

## The record

Schema: `equipmentSchema` in `packages/shared/src/model/schemas.ts`.

| Group | Fields |
|---|---|
| Identity | `id` (random, never reused), `name`, `type`, `category`, `tagCode` (QR or barcode tag), `serialNumber` |
| Product | `manufacturer`, `model`, `catalogModelId` (link to a catalogue product model), `specOverrides` (spec lines changed or added for this one item) |
| Place | `lat`, `lng`, `locationMethod`, `locationAccuracyMeters`, `area`, `street`; `officeMustPlace` for a capture with no good GPS fix |
| State | `status`, `installedDate` (empty: not recorded) |
| Ports | `totalPorts`, `usedPorts`, `availablePorts`, port records; OLT PON ports; ODF panels |
| Other | `notes`, `images`, `photoIds`, `importInfo` (where an imported item came from) |

## What is never made up

**On creation** (`createEquipment` in `packages/shared/src/domain/equipment.ts`):
- No area, street, manufacturer or model.
- **No install date (Phase 2).** Placing a pin is not installing it. The date stays empty until someone records it. Before Phase 2 it was set to the day the pin was placed.
- **No notes (Phase 2).** Before, every new item said "Created via GIS visual mapping toolbar".

**When placed from the catalogue:**
- Only what is the same for every unit of that model: make, model, port count and specs.
- Never the catalogue name: each item gets its own name.

**On screen:**
- A missing value shows "Not recorded".
- The equipment list shows "8 ports · use not recorded" when the port use is not known, never an invented count.

**Existing records:** items saved before Phase 2 keep whatever install date they were saved with.

## Editing an item

Use **Inspector → Details → Edit details** (`features/inspector/AssetSections.tsx`). The fields are name, catalogue model, manufacturer, model, serial number, tag, status, install date, area, street and notes.

- **Choosing a catalogue model** fills in the make and model in the form, where the person sees them before saving. It does not touch the serial, tag, place or install date.
- **Ports are not changed here.** The port count stays as recorded on the item, because ports carry connections. Change them in the port manager.
- **Saving.** Saving is one undoable step with an audit line (`EQUIPMENT_UPDATED`), checked by the same server rules as every other write.

**Inspector → Specs** shows the item's spec lines with their origin. A line can be changed for this item only, set back to the model's value, or added.

## The equipment list

The list is at `features/inventory/EquipmentInventoryView.tsx`, with helpers in `inventoryRows.ts`.

- **Search** looks at the id, name, kind, area, street, manufacturer, model, serial number and tag.
- **Sort** by name, kind, make and model, status or install date. Numbers sort in order ("Box 2" before "Box 10"). Items with nothing recorded for the column go last in either direction.
- **Pages** show 50 items each. Export CSV takes every filtered item, not only the page, through the shared safe CSV writer.

## Not yet

| Gap | Phase |
|---|---|
| Place by typed coordinates; place at a structure; duplicate; bulk placement | Phase 3 |
| Warranty, maintenance and condition fields; inspector tabs; a history tab per item | Phase 3 |
| A server duplicate warning when placing | Phase 3 |
| Real per-layer attribute tables with bulk edit | Phase 16 |
