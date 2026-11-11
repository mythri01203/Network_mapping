# Equipment catalogue

This document covers what the catalogue holds and how items placed from it get their details. It describes the code as of Phase 2 of the [network mapping plan](NETWORK_MAPPING_IMPLEMENTATION_PLAN.md), 10 November 2026.

## Three kinds of entry

| Kind | Where it lives | What it is |
|---|---|---|
| Built-in kind | Code: `apps/web/src/features/catalog/componentCatalog.ts`, toolbox and toolbar lists | A generic kind of equipment ("FAT", "Telecom Pole") with a typical port count. Read-only. Not stored in the database |
| Plain custom kind | `catalog` collection, no manufacturer or model | A kind the operator added, such as "Weather Station" |
| Product model | `catalog` collection, with **both** a manufacturer and a model | A real product, such as "Acme FAT-16". Items placed from it link to it |

**Why the built-in kinds stay in code.** The plan said to write them into the database as sample records. They stay in code instead, because seeding would write records into the owner's real database on start-up, and they are generic kinds, not products.

## Product model fields

Schema: `catalogComponentSchema` in `packages/shared/src/model/schemas.ts`. Every field except the first few is optional. A blank field is saved as absent, which means "not recorded", never a default.

| Field | Meaning |
|---|---|
| `name`, `type`, `category` | What it is called in the catalogue, the kind and the group |
| `manufacturer`, `model` | Both or neither |
| `productCode` | The maker's product or order code |
| `defaultPorts` | Port count of the product |
| `connectorType` | Such as SC/APC |
| `lifecycle` | `active` (in production), `end_of_sale`, `end_of_life` |
| `specs` | Lines of what, value and unit, such as "Operating temperature: -40 to 85 °C". One line per key |
| `specSource` | Where the specs came from, such as "Datasheet rev 3, March 2025" |
| `datasheetDocumentId` | A document record holding the datasheet |
| `createdAt`, `updatedAt` | When the entry was made and last changed |

Older entries (type, name and port count only) are still valid. No migration is needed.

## Rules

All in `packages/shared/src/domain/catalog.ts`.

**Validation** (`validateCatalogEntry`), applied by the browser before saving:
- A name and a kind are required.
- Manufacturer and model come both or neither.
- The port count is 0 to 4096.
- No spec key appears twice.
- No second entry for the same manufacturer and model, ignoring case and spaces.

**What placing an entry fills in** (`catalogPlacementTemplate`):

| Fills in | Never fills in |
|---|---|
| The kind, the group and the port count | A name: each item gets its own, such as "FAT-02", or the next pole number |
| For a product model, its manufacturer, model and the `catalogModelId` link | A serial number, tag, owner, place, install date or notes |

**Specs on an item** (`effectiveSpecs`). Each line shows where it came from:

| Origin | Meaning |
|---|---|
| From the model | The model's line, unchanged |
| Changed for this item | The item's `specOverrides` replaces the model's line; the model's value is shown beside it |
| This item only | A line the model does not have |

**Server rules.** These run on every write (`apps/server/src/lib/linkGuard.ts`) and every restore (`restoreCheck.ts`). Problems already stored are not blamed on later changes.
- An item's `catalogModelId` must name a catalogue entry that exists.
- A model that items still use cannot be deleted.

**Who may change the catalogue.** Engineers and the administrator, the same people who change settings. Office staff, technicians and viewers cannot. The browser says so before trying (`catalogAllowed` in `networkStore.ts`), and the server refuses it (`roleCan` in `packages/shared/src/domain/access.ts`).

**Audit trail.** Adding, changing and removing an entry writes an audit line (`CATALOG_ADDED`, `CATALOG_UPDATED`, `CATALOG_REMOVED`).

## Screens

| Screen | What it does | Code |
|---|---|---|
| Equipment catalogue, "Place on map" | Search by name, kind, make, model or code; tap or drag to place | `features/catalog/ComponentCatalogModal.tsx` |
| Equipment catalogue, "Product models and kinds" | Add, change and remove entries. Each entry shows how many items on the map use it | same file |
| Equipment toolbox and toolbar picker | Place using the same template, so no item takes the catalogue name | `features/map/EquipmentToolbox.tsx`, `features/map/MapToolbar.tsx`, `features/map/placement.ts` |
| Inspector, Specs | The item's lines with their origin. Change a line for this item, use the model value again, or add a line | `features/inspector/AssetSections.tsx` |

## Not yet

| Gap | Phase |
|---|---|
| Editable lists of equipment kinds, statuses and connection types | Phase 23 |
| Chassis, shelf, slot and card models for OLTs | Phase 10 |
| Racks and sites | Phase 9 |
| Uploading the datasheet file itself (documents store metadata only) | Later |
| A placed item's port count comes from the model when placed, then is the item's own. Changing the model later does not change existing items' ports | By design |
